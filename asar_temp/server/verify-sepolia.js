require('dotenv').config({ path: __dirname + '/server/.env' });
const { ethers } = require('ethers');

(async () => {
  const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  
  const txHash = '0x629c27406f838a105fbc541787677e611a6bbe6e0b27c18a16ef7f9832145d1a';
  const contractAddress = '0x5b0FD227eCC75A8C95FE23887248D6fA107296dA';

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
