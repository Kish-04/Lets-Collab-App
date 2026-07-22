process.env.NODE_ENV = 'production';
require('dotenv').config({ path: __dirname + '/.env' });
const { initBlockchain, logToChain } = require('./blockchainLogger');

(async () => {
  console.log("Initializing blockchain logger to Sepolia...");
  
  await initBlockchain();
  
  console.log("Logging a test event to the Sepolia blockchain...");
  const txHash = await logToChain(
    "SESSION_123",
    "HOST_456",
    "CONTROLLER_789",
    "TEST_EVENT",
    { message: "Hello Sepolia Testnet from DRCSFA!" }
  );
  
  if (txHash) {
    console.log(`\n✅ Success! View your transaction on Etherscan:`);
    console.log(`https://sepolia.etherscan.io/tx/${txHash}`);
  } else {
    console.log("Failed to log to chain.");
  }
  process.exit(0);
})();
