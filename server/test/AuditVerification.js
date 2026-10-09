const { expect } = require("chai");
const { ethers } = require("hardhat");
const { hashAuditPayload, verifyAnchors } = require("../blockchainLogger");

describe("Audit trail verification", function () {
  async function anchorSession() {
    const Tracker = await ethers.getContractFactory("IRCPTracker");
    const tracker = await Tracker.deploy();

    const events = [
      ["ROOM_CREATED", { code: "ROOM1", mode: "supervised" }],
      ["AI_ANTI_CHEAT_ALERT", { participant: "Alice", message: "Phone detected", timestamp: "10:00:01" }],
      ["USER_LEFT", { role: "controller", email: "alice@test.com" }],
    ];

    const anchors = [];
    for (const [eventType, data] of events) {
      const { payload, dataHash } = hashAuditPayload(data);
      const tx = await tracker.logEvent("ROOM1", "", "", eventType, dataHash);
      anchors.push({ eventType, payload, dataHash, txHash: tx.hash });
    }

    const chainLogs = (await tracker.queryFilter(tracker.filters.EventLogged("ROOM1"))).map(ev => ({
      txHash: ev.transactionHash,
      blockNumber: Number(ev.blockNumber),
      eventType: String(ev.args.eventType),
      dataHash: String(ev.args.dataHash),
    }));

    return { anchors, chainLogs };
  }

  it("verifies an untouched audit trail", async function () {
    const { anchors, chainLogs } = await anchorSession();
    const report = verifyAnchors(anchors, chainLogs);
    expect(report.intact).to.equal(true);
    expect(report.summary.verified).to.equal(3);
  });

  it("detects an edited payload even if the stored hash is left alone", async function () {
    const { anchors, chainLogs } = await anchorSession();
    anchors[1].payload = anchors[1].payload.replace("Phone detected", "Nothing detected");
    const report = verifyAnchors(anchors, chainLogs);
    expect(report.intact).to.equal(false);
    expect(report.results[1].status).to.equal("tampered");
  });

  it("detects a locally deleted record", async function () {
    const { anchors, chainLogs } = await anchorSession();
    anchors.splice(1, 1);
    const report = verifyAnchors(anchors, chainLogs);
    expect(report.intact).to.equal(false);
    expect(report.summary.missing_local).to.equal(1);
    expect(report.results.find(r => r.status === "missing_local").eventType).to.equal("AI_ANTI_CHEAT_ALERT");
  });

  it("matches by hash when the tx hash is unavailable", async function () {
    const { anchors, chainLogs } = await anchorSession();
    anchors.forEach(anchor => { anchor.txHash = null; });
    const report = verifyAnchors(anchors, chainLogs.map(log => ({ ...log, txHash: "Archived / Unavailable" })));
    expect(report.summary.verified).to.equal(3);
  });
});
