const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { ethers } = require('ethers');

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com');
  
  const txHash = process.env.SEPOLIA_TX_HASH || process.argv[2];
  const contractAddress = process.env.CONTRACT_ADDRESS || process.argv[3];
  if (!txHash || !contractAddress) {
    console.error('Usage: node verify-sepolia.js <txHash> <contractAddress> or set SEPOLIA_TX_HASH and CONTRACT_ADDRESS.');
    process.exit(1);
  }

  console.log(`\n--- Verification Script Started ---`);
  
  // 1. Get Transaction Receipt
  console.log(`Fetching Receipt for Tx: ${txHash}`);
  const receipt = await provider.getTransactionReceipt(txHash);
  
  if (receipt) {
    console.log(`✅ Status: ${receipt.status === 1 ? 'Success' : 'Reverted'}`);
    console.log(`✅ Block Number: ${receipt.blockNumber}`);
    console.log(`✅ Confirmations: ${await receipt.confirmations()}`);
    console.log(`✅ To Address: ${receipt.to}`);
  } else {
    console.log(`❌ Transaction receipt not found!`);
  }

  // 2. Get Code at Contract Address
  console.log(`\nFetching Bytecode for Contract: ${contractAddress}`);
  const code = await provider.getCode(contractAddress);
  
  if (code && code !== '0x') {
    console.log(`✅ Bytecode Exists! (Length: ${code.length} characters)`);
    console.log(`Preview: ${code.substring(0, 50)}...`);
  } else {
    console.log(`❌ No bytecode found at address!`);
  }
})();
