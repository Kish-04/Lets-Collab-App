const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || 'https://rpc.sepolia.org');
const contractData = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', 'IRCPTracker.json'), 'utf8'));
const addressData = JSON.parse(fs.readFileSync(path.join(__dirname, 'contracts', 'address.json'), 'utf8'));
const sessionId = process.env.SESSION_ID || process.argv[2] || 'SESSION_123';

const contract = new ethers.Contract(addressData.address, contractData.abi, provider);

(async () => {
  try {
    console.log(`Querying events for ${sessionId}...`);
    const filter = contract.filters.EventLogged(sessionId);
    console.log('Filter:', filter);
    const logs = await contract.queryFilter(filter, addressData.block, "latest");
    console.log('Found logs:', logs.length);
    if (logs.length > 0) {
      console.log(logs[0].args);
    }
  } catch (err) {
    console.error('Error:', err);
  }
})();
