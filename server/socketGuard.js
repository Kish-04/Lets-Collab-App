// Socket.IO listener guard: per-connection rate limit, and malformed events can never crash the process.

// Socket.IO runs listeners without a try/catch, so one malformed event (a missing or null payload
// that a handler destructures) would throw and take the whole process down. Registered before any
// other connection handler so every listener below is wrapped.
// Per-connection token bucket over all socket events: generous enough for ICE bursts, per-keystroke
// exam drafts and socket-relayed input, but a client can no longer flood the server. Events that
// write to the database, fan out to a room or create rooms cost more.
const SOCKET_RATE_PER_SEC = Number(process.env.SOCKET_EVENTS_PER_SEC || 120);

const SOCKET_BURST = Number(process.env.SOCKET_EVENT_BURST || 400);

const SOCKET_EVENT_COST = {
  'create-room': 40, 'join-room': 20, 'resume-host': 20, 'chat-message': 4, 'system-alert': 8,
  'anti-cheat-alert': 8, 'permission-violation': 8, 'e2e-announce': 4, 'e2e-key-request': 4,
  'host-push-question': 8, 'controller-submit-answer': 4, 'secret-delete-recordings': 40,
};

const SOCKET_UNMETERED = new Set(['disconnect', 'disconnecting', 'error']);

function socketEventAllowed(socket, event, now = Date.now()) {
  if (SOCKET_UNMETERED.has(event) || SOCKET_RATE_PER_SEC <= 0) return true;
  const bucket = socket.rateBucket || (socket.rateBucket = { tokens: SOCKET_BURST, at: now, warnedAt: 0 });
  bucket.tokens = Math.min(SOCKET_BURST, bucket.tokens + ((now - bucket.at) / 1000) * SOCKET_RATE_PER_SEC);
  bucket.at = now;
  const cost = SOCKET_EVENT_COST[event] || 1;
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return true;
  }
  if (now - bucket.warnedAt > 10000) {
    bucket.warnedAt = now;
    console.warn(`[Socket] rate limit: dropping '${event}' and others from ${socket.id}`);
    socket.emit('rate-limited', { event, message: 'Too many requests; some were ignored.' });
  }
  return false;
}

function guardSocketListener(socket, event, listener) {
  return (...args) => {
    if (!socketEventAllowed(socket, event)) return;
    if (args[0] === undefined || args[0] === null) args[0] = {};
    const report = (err) => console.error(`[Socket] '${event}' from ${socket.id} failed:`, err?.message || err);
    try {
      const result = listener(...args);
      if (result && typeof result.catch === 'function') result.catch(report);
    } catch (err) {
      report(err);
    }
  };
}

module.exports = { SOCKET_RATE_PER_SEC, SOCKET_BURST, SOCKET_EVENT_COST, SOCKET_UNMETERED, socketEventAllowed, guardSocketListener };
