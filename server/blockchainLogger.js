const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const provider = new ethers.JsonRpcProvider(
  process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545'
);
const isProduction = process.env.NODE_ENV === 'production';
const allowMockBlockchain = process.env.ALLOW_MOCK_BLOCKCHAIN === 'true' || !isProduction;
const hardhatDevPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const contractPath = path.resolve(__dirname, 'contracts', 'IRCPTracker.json');
let contractData, abi, bytecode;
try {
  contractData = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  abi = contractData.abi;
  bytecode = contractData.evm.bytecode.object;
} catch (e) {
  console.warn("Could not load IRCPTracker.json. Run node compile.js first.");
}

let trackerContract = null;
let wallet = null;
let deployedAt = null; // block number at deployment

const initBlockchain = async () => {
  if (!abi || !bytecode) return;
  try {
    await provider.getNetwork();

    const privateKey = process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY || hardhatDevPrivateKey;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY is required for blockchain logging in production.');
    }
    wallet = new ethers.Wallet(privateKey, provider);

    const addressPath = path.resolve(__dirname, 'contracts', 'address.json');
    let existingAddress = process.env.CONTRACT_ADDRESS;
    let existingBlock = 0;
    
    if (fs.existsSync(addressPath)) {
      const parsed = JSON.parse(fs.readFileSync(addressPath));
      existingAddress = existingAddress || parsed.address;
      existingBlock = parsed.block || 0;
    }

    if (existingAddress) {
      console.log(`Connecting to existing IRCPTracker Contract at ${existingAddress}...`);
      trackerContract = new ethers.Contract(existingAddress, abi, wallet);
      deployedAt = existingBlock;
      global.blockchainActive = true;
      return;
    }

    console.log("Deploying IRCPTracker Contract...");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    trackerContract = await factory.deploy();
    await trackerContract.waitForDeployment();

    // Record the deployment block so we can scan from it
    const receipt = await provider.getTransactionReceipt(trackerContract.deploymentTransaction().hash);
    deployedAt = receipt ? Number(receipt.blockNumber) : 0;

    console.log(`IRCPTracker deployed to: ${trackerContract.target} (block ${deployedAt})`);
    
    fs.writeFileSync(addressPath, JSON.stringify({ address: trackerContract.target, block: deployedAt }));
    
    global.blockchainActive = true;
  } catch (err) {
    console.warn(`Blockchain not available (${err.message}). Falling back to mock logging.`);
    global.blockchainActive = false;
  }
};

let txQueue = Promise.resolve();

const logToChain = async (sessionId, hostId, controllerId, eventType, data) => {
  if (global.blockchainActive && trackerContract) {
    return new Promise((resolve) => {
      txQueue = txQueue.then(async () => {
        try {
          const dataStr = typeof data === 'string' ? data : JSON.stringify(data || {});
          const dataHash = ethers.id(dataStr);
          const hostHash = hostId || '';
          const controllerHash = controllerId || '';

          const tx = await trackerContract.logEvent(
            sessionId,
            hostHash,
            controllerHash,
            eventType,
            dataHash
          );
          console.log(`[BLOCKCHAIN] Tx Submitted: ${eventType} (Hash: ${tx.hash})`);
          
          tx.wait().catch(err => console.error('[BLOCKCHAIN WAIT ERROR]', err));
          resolve(tx.hash);
        } catch (err) {
          console.error('[BLOCKCHAIN ERROR]', err.message);
          resolve(null);
        }
      });
    });
  } else {
    if (!allowMockBlockchain || isProduction) {
      console.warn(`[BLOCKCHAIN] ${eventType} was not anchored because blockchain is inactive.`);
      return null;
    }
    console.log(`[MOCK BLOCKCHAIN] Logged ${eventType} for ${sessionId}`);
    return '[OFF-CHAIN-MOCK]-' + Date.now();
  }
};

// ── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Returns all on-chain logs, enriched with block numbers by scanning
 * EventLogged events from the deployment block onwards.
 *
 * Shape returned per entry:
 * {
 *   txHash, blockNumber, sessionId, hostId, controllerId,
 *   eventType, timestamp (unix seconds), dataHash
 * }
 */
const queryChain = async () => {
  // ── Mock mode fallback ──────────────────────────────────────────────────
  if (!global.blockchainActive || !trackerContract) {
    return { active: false, logs: [], totalCount: 0, contractAddress: null };
  }

  try {
    // 1. Total log count from contract
    const totalCount = Number(await trackerContract.getGlobalLogCount());

    // 2. Fetch all EventLogged events from deployment block
    const currentBlock = Number(await provider.getBlockNumber());
    const fromBlock = deployedAt || 0;

    const eventFilter = trackerContract.filters.EventLogged();
    let rawEvents = [];
    let queryFilterSuccess = false;
    
    try {
      rawEvents = await trackerContract.queryFilter(eventFilter, fromBlock, currentBlock);
      queryFilterSuccess = true;
    } catch (err) {
      console.warn('[BLOCKCHAIN QUERY] queryFilter failed (likely RPC archive limit). Falling back to direct struct reads.', err.message);
    }

    let logs = [];
    if (queryFilterSuccess) {
      // 3. For each event, read the full struct from the logs array
      //    The contract stores them in order so index = rawEvents[i].args order
      logs = await Promise.all(
        rawEvents.map(async (ev, idx) => {
          try {
            const struct = await trackerContract.logs(idx);
            return {
              txHash: ev.transactionHash,
              blockNumber: Number(ev.blockNumber),
              sessionId: struct.sessionId,
              hostId: struct.hostId,
              controllerId: struct.controllerId,
              eventType: struct.eventType,
              timestamp: Number(struct.timestamp),
              dataHash: struct.dataHash,
            };
          } catch {
            // Fallback using event args if struct read fails
            return {
              txHash: ev.transactionHash,
              blockNumber: Number(ev.blockNumber),
              sessionId: String(ev.args.sessionId),
              eventType: String(ev.args.eventType),
              timestamp: Number(ev.args.timestamp),
              dataHash: String(ev.args.dataHash),
              hostId: '',
              controllerId: '',
            };
          }
        })
      );
    } else {
      // Manual fallback using totalCount (bypasses eth_getLogs entirely!)
      const limit = Math.min(totalCount, 50); // Fetch latest 50 logs directly
      for (let i = totalCount - limit; i < totalCount; i++) {
        const struct = await trackerContract.logs(i);
        logs.push({
          txHash: 'Archived / Unavailable', // We don't have tx hash easily without event query
          blockNumber: 0,
          sessionId: struct.sessionId,
          hostId: struct.hostId,
          controllerId: struct.controllerId,
          eventType: struct.eventType,
          timestamp: Number(struct.timestamp),
          dataHash: struct.dataHash,
        });
      }
    }

    return {
      active: true,
      logs: logs.reverse(), // newest first
      totalCount,
      contractAddress: trackerContract.target,
      currentBlock,
    };
  } catch (err) {
    console.error('[BLOCKCHAIN QUERY ERROR]', err.message);
    return { active: false, logs: [], totalCount: 0, contractAddress: null, error: err.message };
  }
};

/**
 * Returns all logs for a specific session ID.
 */
const querySessionLogs = async (sessionId) => {
  if (!global.blockchainActive || !trackerContract) return [];
  try {
    const currentBlock = Number(await provider.getBlockNumber());
    // Limit to last 99 blocks to avoid public RPC archive restrictions if deployedAt is old
    const fromBlock = Math.max(deployedAt || 0, currentBlock - 99);
    const eventFilter = trackerContract.filters.EventLogged(sessionId);
    const rawEvents = await trackerContract.queryFilter(eventFilter, fromBlock, currentBlock);

    return rawEvents.map(ev => ({
      txHash: ev.transactionHash,
      blockNumber: Number(ev.blockNumber),
      sessionId: String(ev.args.sessionId),
      eventType: String(ev.args.eventType),
      hostId: String(ev.args.hostId || ''),
      controllerId: String(ev.args.controllerId || ''),
      timestamp: Number(ev.args.timestamp),
      dataHash: String(ev.args.dataHash),
    }));
  } catch (err) {
    console.error('[SESSION QUERY ERROR]', err.message);
    return [];
  }
};

module.exports = { initBlockchain, logToChain, queryChain, querySessionLogs };
