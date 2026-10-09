// Audit logger against a real local chain node: npm run test:chain (from server/)
// Starts its own `hardhat node`, so it needs no external RPC or funds.
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');
const assert = require('assert/strict');
const { ethers } = require('ethers');

const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const serverDir = path.resolve(__dirname, '..');
const artifact = require('../contracts/IRCPTracker.json');
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // hardhat dev account #0
const OUTSIDER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // dev account #1

const freshLogger = () => {
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(serverDir) && !key.includes('node_modules') && !key.endsWith('IRCPTracker.json')) delete require.cache[key];
  });
  return require('../blockchainLogger');
};

async function waitForNode() {
  const provider = new ethers.JsonRpcProvider(RPC);
  for (let i = 0; i < 60; i += 1) {
    try { await provider.getBlockNumber(); return; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('hardhat node did not start');
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); } catch (err) { results.push(['FAIL', `${name}: ${err.message}`]); }
}

const portInUse = port => new Promise((resolve) => {
  const probe = net.createServer().once('error', () => resolve(true)).once('listening', () => probe.close(() => resolve(false)));
  probe.listen(port, '127.0.0.1');
});

// Kill the whole process tree synchronously (npx/shell wrappers on Windows keep the real node child alive)
function stopTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

(async () => {
  if (await portInUse(PORT)) throw new Error(`port ${PORT} is already in use; stop the other process first`);
  const node = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['hardhat', 'node', '--port', String(PORT)], { cwd: serverDir, stdio: 'ignore', shell: process.platform === 'win32' });
  try {
    await waitForNode();
    const provider = new ethers.JsonRpcProvider(RPC);
    const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
    const tracker = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, deployer).deploy();
    await tracker.waitForDeployment();

    Object.assign(process.env, {
      NODE_ENV: 'test',
      JWT_SECRET: 'chain_integration_secret_more_than_32_chars',
      CHAIN_RPC_URL: RPC,
      CONTRACT_ADDRESS: tracker.target,
      CONTRACT_DEPLOY_BLOCK: '0',
      CHAIN_MIN_PRIORITY_FEE_GWEI: '30', // exercise the Polygon-style fee floor
      CHAIN_LOG_BLOCK_RANGE: '2', // force chunked eth_getLogs
    });
    delete process.env.CHAIN_PRIVATE_KEY;
    delete process.env.SEPOLIA_PRIVATE_KEY;
    delete process.env.PRIVATE_KEY;

    let logger = freshLogger();
    await logger.initBlockchain();
    const anchors = [];

    await check('authorised writer connects and detects the chain', async () => {
      assert.equal(global.blockchainActive, true);
      assert.equal(logger.getActiveChain().chainId, 31337);
    });

    await check('back-to-back anchors are all mined (nonce management) with the fee floor', async () => {
      for (const [eventType, data] of [['ROOM_CREATED', { a: 1 }], ['USER_JOINED', { b: 2 }], ['SESSION_ARCHIVED', { c: 3 }]]) {
        const { payload, dataHash } = logger.hashAuditPayload(data);
        anchors.push({ eventType, payload, dataHash, txHash: await logger.logToChain('ITROOM', '', '', eventType, payload) });
      }
      await new Promise(r => setTimeout(r, 500));
      for (const anchor of anchors) assert.equal((await provider.getTransactionReceipt(anchor.txHash)).status, 1);
      const tx = await provider.getTransaction(anchors[0].txHash);
      assert.ok(tx.maxPriorityFeePerGas >= ethers.parseUnits('30', 'gwei'));
    });

    await check('session logs come from the contract index with tx hashes, and verify', async () => {
      const logs = await logger.querySessionLogs('ITROOM');
      assert.equal(logs.length, 3);
      assert.ok(logs.every((log, i) => log.txHash === anchors[i].txHash));
      assert.equal(logger.verifyAnchors(anchors, logs).summary.verified, 3);
    });

    await check('works without log scanning when the range is too large', async () => {
      process.env.CHAIN_LOG_MAX_CHUNKS = '1';
      logger = freshLogger();
      await logger.initBlockchain();
      const logs = await logger.querySessionLogs('ITROOM');
      assert.equal(logs.length, 3);
      assert.equal(logs[0].txHash, 'Archived / Unavailable');
      assert.equal(logger.verifyAnchors(anchors.map(a => ({ ...a, txHash: null })), logs).summary.verified, 3);
    });

    await check('a wallet that is not an authorised writer disables anchoring', async () => {
      process.env.CHAIN_PRIVATE_KEY = OUTSIDER_KEY;
      logger = freshLogger();
      await logger.initBlockchain();
      assert.equal(global.blockchainActive, false);
    });
  } finally {
    stopTree(node);
  }

  results.forEach(([status, name]) => console.log(`${status} ${name}`));
  const failed = results.filter(([status]) => status === 'FAIL').length;
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
