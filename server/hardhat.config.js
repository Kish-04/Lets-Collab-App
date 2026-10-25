require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: __dirname + '/.env' });

// One deployer key for every network; falls back to the older SEPOLIA_PRIVATE_KEY name
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.CHAIN_PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      chainId: 11155111,
      accounts
    },
    // Polygon PoS testnet; use it to rehearse a mainnet migration
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts
    }
  },
  // Etherscan API v2 keys work for Polygonscan too (contract source verification)
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""
  }
};
