const hre = require("hardhat");
const fs = require('fs');
const path = require('path');
const { getChainInfo } = require('../chains');

// Usage: npx hardhat run scripts/deploy.js --network amoy|polygon|sepolia|localhost
// Optional: AUDIT_WRITER_ADDRESS authorises the backend's wallet when it differs from the deployer.
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const { chainId } = await hre.ethers.provider.getNetwork();
  const chain = getChainInfo(chainId);
  console.log(`Deploying IRCPTracker to ${chain.name} (${chain.chainId}) from ${deployer.address}`);

  const Tracker = await hre.ethers.getContractFactory("IRCPTracker");
  const tracker = await Tracker.deploy();
  await tracker.waitForDeployment();
  const address = await tracker.getAddress();
  const receipt = await tracker.deploymentTransaction().wait();
  const block = receipt.blockNumber;
  console.log(`IRCPTracker deployed to ${address} at block ${block}`);
  if (chain.explorerTxBaseUrl) console.log(`${chain.explorerTxBaseUrl}${receipt.hash}`);

  const writer = process.env.AUDIT_WRITER_ADDRESS;
  if (writer && writer.toLowerCase() !== deployer.address.toLowerCase()) {
    const tx = await tracker.setWriter(writer, true);
    await tx.wait();
    console.log(`Authorised audit writer ${writer}`);
  }

  // The in-process hardhat network disappears after this script, so don't record its address
  if (hre.network.name === 'hardhat') return;
  fs.writeFileSync(
    path.join(__dirname, '..', 'contracts', 'address.json'),
    JSON.stringify({ address, block, chainId: chain.chainId, network: hre.network.name }, null, 2)
  );
  console.log('Saved contracts/address.json. In production also set CONTRACT_ADDRESS and CONTRACT_DEPLOY_BLOCK.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
