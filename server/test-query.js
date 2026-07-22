const { ethers } = require('ethers');
const fs = require('fs');

const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.org');
const contractData = JSON.parse(fs.readFileSync('./contracts/IRCPTracker.json', 'utf8'));
const addressData = JSON.parse(fs.readFileSync('./contracts/address.json', 'utf8'));

const contract = new ethers.Contract(addressData.address, contractData.abi, provider);

(async () => {
  try {
    console.log('Querying events for SESSION_123...');
    const filter = contract.filters.EventLogged("SESSION_123");
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
