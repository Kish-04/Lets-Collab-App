const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IRCPTracker", function () {
  it("Should log an event and retrieve it", async function () {
    const Tracker = await ethers.getContractFactory("IRCPTracker");
    const tracker = await Tracker.deploy();
    
    await tracker.logEvent("ROOM1", "host@test.com", "controller@test.com", "TEST_EVENT", "Test payload");
    
    const logs = await tracker.getSessionLogs("ROOM1");
    expect(logs.length).to.equal(1);
    expect(logs[0].eventType).to.equal("TEST_EVENT");
  });
});
