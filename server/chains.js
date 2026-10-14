// Chain metadata used by the audit logger. Polygon validators reject transactions whose priority
// fee is below ~25-30 gwei, and ethers' default estimate is often lower, so a floor is enforced there.
const CHAINS = {
  1: { name: 'Ethereum Mainnet', explorer: 'https://etherscan.io', minPriorityFeeGwei: 0 },
  11155111: { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io', minPriorityFeeGwei: 0 },
  137: { name: 'Polygon PoS', explorer: 'https://polygonscan.com', minPriorityFeeGwei: 30 },
  80002: { name: 'Polygon Amoy', explorer: 'https://amoy.polygonscan.com', minPriorityFeeGwei: 30 },
  31337: { name: 'Hardhat (local)', explorer: null, minPriorityFeeGwei: 0 },
};

function getChainInfo(chainId) {
  const id = Number(chainId);
  const known = CHAINS[id] || { name: `Chain ${id}`, explorer: null, minPriorityFeeGwei: 0 };
  const explorer = process.env.CHAIN_EXPLORER_URL || known.explorer;
  const minPriorityFeeGwei = process.env.CHAIN_MIN_PRIORITY_FEE_GWEI !== undefined
    ? Number(process.env.CHAIN_MIN_PRIORITY_FEE_GWEI)
    : known.minPriorityFeeGwei;
  return {
    chainId: id,
    name: known.name,
    explorer,
    explorerTxBaseUrl: explorer ? `${explorer}/tx/` : null,
    minPriorityFeeGwei,
  };
}

module.exports = { CHAINS, getChainInfo };
