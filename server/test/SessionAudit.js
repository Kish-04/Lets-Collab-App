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

  it("Should reject writes from unauthorised accounts", async function () {
    const [, outsider] = await ethers.getSigners();
    const tracker = await (await ethers.getContractFactory("IRCPTracker")).deploy();

    await expect(tracker.connect(outsider).logEvent("ROOM1", "", "", "FAKE_EVENT", "0x00"))
      .to.be.revertedWithCustomError(tracker, "NotWriter");
    expect(await tracker.getGlobalLogCount()).to.equal(0);
  });

  it("Should let only the owner authorise and revoke writers", async function () {
    const [owner, backend, outsider] = await ethers.getSigners();
    const tracker = await (await ethers.getContractFactory("IRCPTracker")).deploy();

    await expect(tracker.connect(outsider).setWriter(outsider.address, true))
      .to.be.revertedWithCustomError(tracker, "NotOwner");

    await expect(tracker.connect(owner).setWriter(backend.address, true))
      .to.emit(tracker, "WriterUpdated").withArgs(backend.address, true);
    await tracker.connect(backend).logEvent("ROOM2", "", "", "SESSION_START", "0x01");
    expect((await tracker.getSessionLogs("ROOM2")).length).to.equal(1);

    await tracker.connect(owner).setWriter(backend.address, false);
    await expect(tracker.connect(backend).logEvent("ROOM2", "", "", "SESSION_END", "0x02"))
      .to.be.revertedWithCustomError(tracker, "NotWriter");
  });
});
