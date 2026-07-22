const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  const Tracker = await hre.ethers.getContractFactory("IRCPTracker");
  const tracker = await Tracker.deploy();

  await tracker.waitForDeployment();
  const address = await tracker.getAddress();
  
  const receipt = await tracker.deploymentTransaction().wait();
  const block = receipt.blockNumber;

  console.log(`IRCPTracker deployed to ${address} at block ${block}`);
  
  // Save address for backend to use
  fs.writeFileSync(
    path.join(__dirname, '..', 'contracts', 'address.json'),
    JSON.stringify({ address, block }, null, 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
