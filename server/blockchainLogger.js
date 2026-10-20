const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { getAuditHashSecret } = require('./config');
const { getChainInfo } = require('./chains');

// CHAIN_* works for any EVM network (Polygon, Amoy, Sepolia, ...); SEPOLIA_* is kept for older setups
const provider = new ethers.JsonRpcProvider(
  process.env.CHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:8545'
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
let chainInfo = null;

const LOG_BLOCK_RANGE = Number(process.env.CHAIN_LOG_BLOCK_RANGE) || 10000;
const LOG_MAX_CHUNKS = Number(process.env.CHAIN_LOG_MAX_CHUNKS) || 20;

const initBlockchain = async () => {
  if (!abi || !bytecode) return;
  try {
    const network = await provider.getNetwork();
    chainInfo = getChainInfo(network.chainId);

    const privateKey = process.env.CHAIN_PRIVATE_KEY || process.env.SEPOLIA_PRIVATE_KEY || process.env.PRIVATE_KEY || (!isProduction ? hardhatDevPrivateKey : null);
    if (!privateKey) {
      throw new Error('PRIVATE_KEY is required for blockchain logging in production.');
    }
    // Track nonces locally: back-to-back audit events must not reuse a stale "pending" nonce,
    // which load-balanced public RPCs (e.g. Polygon) frequently return
    wallet = new ethers.NonceManager(new ethers.Wallet(privateKey, provider));

    const addressPath = path.resolve(__dirname, 'contracts', 'address.json');
    let existingAddress = process.env.CONTRACT_ADDRESS;
    let existingBlock = 0;
    
    if (fs.existsSync(addressPath)) {
      const parsed = JSON.parse(fs.readFileSync(addressPath));
      // Never reuse an address recorded for a different chain (e.g. a Sepolia address on Polygon)
      if (parsed.chainId && Number(parsed.chainId) !== chainInfo.chainId) {
        console.warn(`[BLOCKCHAIN] contracts/address.json is for chain ${parsed.chainId}, connected to ${chainInfo.chainId}; ignoring it.`);
      } else {
        existingAddress = existingAddress || parsed.address;
        existingBlock = parsed.block || 0;
      }
    }
    if (process.env.CONTRACT_DEPLOY_BLOCK) existingBlock = Number(process.env.CONTRACT_DEPLOY_BLOCK);

    if (existingAddress) {
      console.log(`Connecting to existing IRCPTracker Contract at ${existingAddress} on ${chainInfo.name}...`);
      trackerContract = new ethers.Contract(existingAddress, abi, wallet);
      deployedAt = existingBlock;
      if (!(await canWrite())) {
        console.warn(`[BLOCKCHAIN] ${await wallet.getAddress()} is not an authorised writer on the contract; audit anchoring disabled. Call setWriter() from the owner.`);
        global.blockchainActive = false;
        return;
      }
      global.blockchainActive = true;
      return;
    }

    if (isProduction) {
      throw new Error('CONTRACT_ADDRESS is required in production. Deploy the contract separately and set CONTRACT_ADDRESS.');
    }

    console.log("Deploying IRCPTracker Contract...");
    const factory = new ethers.ContractFactory(abi, bytecode, wallet);
    trackerContract = await factory.deploy();
    await trackerContract.waitForDeployment();

    // Record the deployment block so we can scan from it
    const receipt = await provider.getTransactionReceipt(trackerContract.deploymentTransaction().hash);
    deployedAt = receipt ? Number(receipt.blockNumber) : 0;

    console.log(`IRCPTracker deployed to: ${trackerContract.target} (block ${deployedAt})`);
    
    fs.writeFileSync(addressPath, JSON.stringify({ address: trackerContract.target, block: deployedAt, chainId: chainInfo.chainId }));
    
    global.blockchainActive = true;
  } catch (err) {
    console.warn(`Blockchain not available (${err.message}). Falling back to mock logging.`);
    global.blockchainActive = false;
  }
};

// Contracts deployed before access control existed have no writers() function; treat them as open
async function canWrite() {
  try {
    return await trackerContract.writers(await wallet.getAddress());
  } catch (err) {
    return true;
  }
}

// EIP-1559 fees with a per-chain priority-fee floor (Polygon rejects tips below ~25-30 gwei)
async function feeOverrides() {
  if (!chainInfo || !chainInfo.minPriorityFeeGwei) return {};
  const [feeData, block] = await Promise.all([provider.getFeeData(), provider.getBlock('latest')]);
  const floor = ethers.parseUnits(String(chainInfo.minPriorityFeeGwei), 'gwei');
  const tip = feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > floor ? feeData.maxPriorityFeePerGas : floor;
  const baseFee = (block && block.baseFeePerGas) || feeData.gasPrice || 0n;
  return { maxPriorityFeePerGas: tip, maxFeePerGas: baseFee * 2n + tip };
}

// eth_getLogs in bounded chunks (public Polygon RPCs cap the block range); null if too large to scan
async function queryEventsChunked(filter, fromBlock, toBlock) {
  if ((toBlock - fromBlock) / LOG_BLOCK_RANGE > LOG_MAX_CHUNKS) return null;
  const events = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_BLOCK_RANGE) {
    events.push(...await trackerContract.queryFilter(filter, start, Math.min(toBlock, start + LOG_BLOCK_RANGE - 1)));
  }
  return events;
}

const getActiveChain = () => chainInfo;

let txQueue = Promise.resolve();

/**
 * Canonical serialisation + keccak256 hash of an audit payload. The exact
 * `payload` string must be stored off-chain so the hash can be recomputed later.
 */
const hashAuditPayload = (data) => {
  const payload = typeof data === 'string' ? data : JSON.stringify(data || {});
  return { payload, dataHash: ethers.id(payload) };
};

/**
 * Keyed pseudonym for an email stored on-chain. A plain keccak256(email) can be reversed by hashing
 * a list of candidate emails; an HMAC can only be resolved by whoever holds AUDIT_HASH_SECRET.
 */
const hashIdentity = (email) => {
  if (!email) return '';
  const normalized = String(email).trim().toLowerCase();
  return ethers.computeHmac('sha256', ethers.toUtf8Bytes(getAuditHashSecret()), ethers.toUtf8Bytes(normalized));
};

// Hash used by entries written before identities were keyed; kept so old history still resolves
const legacyIdentityHash = (email) => (email ? ethers.id(email) : '');

const logToChain = async (sessionId, hostId, controllerId, eventType, data) => {
  if (global.blockchainActive && trackerContract) {
    return new Promise((resolve) => {
      txQueue = txQueue.then(async () => {
        try {
          const { dataHash } = hashAuditPayload(data);
          const hostHash = hostId || '';
          const controllerHash = controllerId || '';

          const tx = await trackerContract.logEvent(
            sessionId,
            hostHash,
            controllerHash,
            eventType,
            dataHash,
            await feeOverrides()
          );
          console.log(`[BLOCKCHAIN] Tx Submitted: ${eventType} (Hash: ${tx.hash})`);
          
          tx.wait().catch(err => console.error('[BLOCKCHAIN WAIT ERROR]', err));
          resolve(tx.hash);
        } catch (err) {
          console.error('[BLOCKCHAIN ERROR]', err.message);
          wallet.reset(); // resync the nonce from the chain after a failed send
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
      const scanned = await queryEventsChunked(eventFilter, fromBlock, currentBlock);
      if (!scanned) throw new Error(`block range ${currentBlock - fromBlock} too large to scan`);
      rawEvents = scanned;
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
      chain: chainInfo,
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
    // The contract's own per-session index is authoritative and needs no log scanning
    const structs = await trackerContract.getSessionLogs(sessionId);

    // Tx hashes only exist in event logs; add them when the range is small enough to scan
    let located = [];
    try {
      const currentBlock = Number(await provider.getBlockNumber());
      const events = await queryEventsChunked(trackerContract.filters.EventLogged(sessionId), deployedAt || 0, currentBlock);
      if (events && events.length === structs.length) {
        located = events.map(ev => ({ txHash: ev.transactionHash, blockNumber: Number(ev.blockNumber) }));
      }
    } catch (err) {
      console.warn('[SESSION QUERY] Could not scan event logs for tx hashes:', err.message);
    }

    return structs.map((log, index) => ({
      txHash: located[index]?.txHash || 'Archived / Unavailable',
      blockNumber: located[index]?.blockNumber || 0,
      sessionId: String(log.sessionId),
      eventType: String(log.eventType),
      hostId: String(log.hostId || ''),
      controllerId: String(log.controllerId || ''),
      timestamp: Number(log.timestamp),
      dataHash: String(log.dataHash),
    }));
  } catch (err) {
    console.error('[SESSION QUERY ERROR]', err.message);
    // null, not []: an unreachable chain must not look like "nothing was anchored"
    return null;
  }
};

/**
 * Compares locally stored anchor records against on-chain logs for one session.
 *
 * Each local anchor is { eventType, payload, dataHash, txHash }. Its hash is
 * recomputed from `payload`, so editing the stored payload is detected even if
 * the stored dataHash is left untouched. Statuses:
 *   verified      – recomputed hash matches an on-chain entry
 *   tampered      – on-chain entry found (by txHash) but its hash differs
 *   not_on_chain  – was anchored in mock mode, failed, or is not yet visible
 *   missing_local – on-chain entry with no surviving local record (deleted)
 */
const verifyAnchors = (anchors = [], chainLogs = []) => {
  const unmatched = chainLogs.map(log => ({ ...log, dataHash: String(log.dataHash) }));
  const take = (predicate) => {
    const index = unmatched.findIndex(predicate);
    return index === -1 ? null : unmatched.splice(index, 1)[0];
  };

  const results = anchors.map((anchor) => {
    const recomputedHash = ethers.id(String(anchor.payload ?? ''));
    const byTx = anchor.txHash ? take(log => log.txHash === anchor.txHash) : null;
    const chainEntry = byTx
      || take(log => log.dataHash === recomputedHash && log.eventType === anchor.eventType);

    let status = 'not_on_chain';
    if (chainEntry) {
      status = chainEntry.dataHash === recomputedHash && chainEntry.eventType === anchor.eventType
        ? 'verified'
        : 'tampered';
    }

    return {
      status,
      eventType: anchor.eventType,
      payload: anchor.payload,
      recomputedHash,
      chainHash: chainEntry ? chainEntry.dataHash : null,
      txHash: chainEntry ? chainEntry.txHash : anchor.txHash || null,
      blockNumber: chainEntry ? chainEntry.blockNumber : null,
    };
  });

  unmatched.forEach((log) => {
    results.push({
      status: 'missing_local',
      eventType: log.eventType,
      payload: null,
      recomputedHash: null,
      chainHash: log.dataHash,
      txHash: log.txHash,
      blockNumber: log.blockNumber,
    });
  });

  const summary = results.reduce((counts, result) => {
    counts[result.status] = (counts[result.status] || 0) + 1;
    return counts;
  }, { verified: 0, tampered: 0, not_on_chain: 0, missing_local: 0 });

  // confirmed: at least one anchor found on chain and nothing contradicts it; unconfirmed: nothing
  // contradicts the log, but nothing could be found on chain either (mock mode, failed sends)
  const contradicted = summary.tampered > 0 || summary.missing_local > 0;
  const chainStatus = contradicted ? 'tampered' : summary.verified > 0 ? 'confirmed' : anchors.length ? 'unconfirmed' : 'empty';
  return {
    intact: !contradicted,
    chainStatus,
    summary,
    results,
  };
};

module.exports = {
  getActiveChain,
  initBlockchain,
  logToChain,
  queryChain,
  querySessionLogs,
  hashAuditPayload,
  hashIdentity,
  legacyIdentityHash,
  verifyAnchors,
};
