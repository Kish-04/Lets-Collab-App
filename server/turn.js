const crypto = require('crypto');

const DEFAULT_STUN = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

function parseList(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * Short-lived TURN credentials using the TURN REST API scheme that coturn implements with
 * `use-auth-secret` / `static-auth-secret`: username = "<expiry unix time>:<identity>",
 * credential = base64(HMAC-SHA1(secret, username)). Nothing long-lived ever reaches the client,
 * and every TURN node sharing the secret accepts the same credential, so one credential works
 * across all regions listed in TURN_URLS (ICE then picks the relay with the best path).
 */
function createTurnRestCredentials({ secret, urls, identity = 'guest', ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now() }) {
  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const safeIdentity = String(identity).replace(/[^a-zA-Z0-9_.@-]/g, '').slice(0, 64) || 'guest';
  const username = `${expiry}:${safeIdentity}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential, credentialType: 'password', expiresAt: expiry };
}

/** Returns the RTCIceServer list for the configured TURN mode, or null when no mode is configured. */
function buildIceServers(env = process.env, identity = 'guest') {
  const stun = parseList(env.STUN_URLS);
  const stunServers = { urls: stun.length ? stun : DEFAULT_STUN };

  // Self-hosted coturn fleet (one entry per region, all sharing TURN_SECRET)
  const turnUrls = parseList(env.TURN_URLS);
  if (turnUrls.length && env.TURN_SECRET) {
    const ttlSeconds = Number(env.TURN_CREDENTIAL_TTL) || DEFAULT_TTL_SECONDS;
    const { expiresAt, ...server } = createTurnRestCredentials({ secret: env.TURN_SECRET, urls: turnUrls, identity, ttlSeconds });
    return { iceServers: [server, stunServers], expiresAt };
  }

  // Legacy single static TURN account
  if (env.TURN_URL) {
    return {
      iceServers: [
        { urls: env.TURN_URL, username: env.TURN_USERNAME || undefined, credential: env.TURN_CREDENTIAL || undefined },
        stunServers,
      ],
      expiresAt: null,
    };
  }

  return null;
}

module.exports = { buildIceServers, createTurnRestCredentials, parseList };
