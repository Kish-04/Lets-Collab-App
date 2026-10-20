// Abuse limits: on-chain anchoring budget, room creation rate, and pending role-swap requests.

// Every on-chain anchor is a paid transaction, and several events can be triggered at will by
// clients. Anchors are always recorded off-chain; only the chain write is budgeted. Session
// archive/termination and panic revokes always go on-chain (they are bounded by room creation).
const CHAIN_ALWAYS = new Set(['SESSION_ARCHIVED', 'SESSION_TERMINATED', 'PANIC_REVOKE', 'EVIDENCE_PURGED']);

const CHAIN_NOISY = new Set(['AI_ANTI_CHEAT_ALERT', 'PERMISSION_VIOLATION']);

const CHAIN_NOISY_INTERVAL_MS = Number(process.env.CHAIN_NOISY_INTERVAL_MS || 20000);

const CHAIN_ROOM_WINDOW_MS = 10 * 60 * 1000;

const CHAIN_ROOM_MAX = Number(process.env.CHAIN_MAX_TX_PER_ROOM || 40);

const CHAIN_GLOBAL_MAX_PER_MIN = Number(process.env.CHAIN_MAX_TX_PER_MINUTE || 120);

const chainGlobalWrites = [];

function chainWriteAllowed(room, eventType, now = Date.now()) {
  if (CHAIN_ALWAYS.has(eventType)) return true;
  if (!room.chainBudget) room.chainBudget = { writes: [], lastByType: {} };
  const budget = room.chainBudget;
  if (CHAIN_NOISY.has(eventType) && now - (budget.lastByType[eventType] || 0) < CHAIN_NOISY_INTERVAL_MS) return false;
  budget.writes = budget.writes.filter(at => now - at < CHAIN_ROOM_WINDOW_MS);
  if (budget.writes.length >= CHAIN_ROOM_MAX) return false;
  while (chainGlobalWrites.length && now - chainGlobalWrites[0] >= 60000) chainGlobalWrites.shift();
  if (chainGlobalWrites.length >= CHAIN_GLOBAL_MAX_PER_MIN) return false;
  budget.writes.push(now);
  budget.lastByType[eventType] = now;
  chainGlobalWrites.push(now);
  return true;
}

// Each new room gets its own chain budget and a ROOM_CREATED anchor, so creation itself is capped
const ROOM_CREATE_WINDOW_MS = 10 * 60 * 1000;

const ROOM_CREATE_MAX = Number(process.env.MAX_ROOMS_PER_USER_PER_10_MIN || 10);

const roomCreations = new Map();

function roomCreationAllowed(userKey, now = Date.now()) {
  const recent = (roomCreations.get(userKey) || []).filter(at => now - at < ROOM_CREATE_WINDOW_MS);
  if (recent.length >= ROOM_CREATE_MAX) {
    roomCreations.set(userKey, recent);
    return false;
  }
  recent.push(now);
  roomCreations.set(userKey, recent);
  return true;
}

// Role swaps need a request from one side and an answer from the other: remember who asked whom
const ROLE_SWAP_TTL_MS = 2 * 60 * 1000;

function rememberRoleSwap(room, requesterId, responderId) {
  if (!room.roleSwapRequests) room.roleSwapRequests = new Map();
  room.roleSwapRequests.set(`${requesterId}>${responderId}`, Date.now() + ROLE_SWAP_TTL_MS);
}

function takeRoleSwap(room, requesterId, responderId) {
  const key = `${requesterId}>${responderId}`;
  const expiresAt = room.roleSwapRequests?.get(key);
  if (!expiresAt) return false;
  room.roleSwapRequests.delete(key);
  return expiresAt > Date.now();
}

module.exports = { CHAIN_ALWAYS, CHAIN_NOISY, CHAIN_NOISY_INTERVAL_MS, CHAIN_ROOM_WINDOW_MS, CHAIN_ROOM_MAX, CHAIN_GLOBAL_MAX_PER_MIN, chainGlobalWrites, chainWriteAllowed, ROOM_CREATE_WINDOW_MS, ROOM_CREATE_MAX, roomCreations, roomCreationAllowed, ROLE_SWAP_TTL_MS, rememberRoleSwap, takeRoleSwap };
