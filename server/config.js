const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';

function parseCsv(value, fallback = []) {
  if (!value) return fallback;
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function getJwtSecret() {
  const configured = process.env.JWT_SECRET;
  if (configured) {
    if (isProduction && configured.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    return configured;
  }

  if (isProduction) {
    console.error('[FATAL] JWT_SECRET is required but not set. Exiting immediately.');
    process.exit(1);
  }

  console.warn('[CONFIG] JWT_SECRET is not set. Using an in-memory development secret; sessions will reset on restart.');
  if (!global.__LETSCOLLAB_DEV_JWT_SECRET) {
    global.__LETSCOLLAB_DEV_JWT_SECRET = crypto.randomBytes(32).toString('hex');
  }
  return global.__LETSCOLLAB_DEV_JWT_SECRET;
}

// Key for the HMAC that pseudonymises emails written to the public audit chain.
// It must stay stable: rotating it means older on-chain identities can no longer be resolved.
function getAuditHashSecret() {
  if (process.env.AUDIT_HASH_SECRET) return process.env.AUDIT_HASH_SECRET;
  if (isProduction) {
    if (!global.__LETSCOLLAB_AUDIT_SECRET_WARNED) {
      console.warn('[CONFIG] AUDIT_HASH_SECRET is not set. Falling back to JWT_SECRET for on-chain identity hashes.');
      global.__LETSCOLLAB_AUDIT_SECRET_WARNED = true;
    }
    return getJwtSecret();
  }
  return 'letscollab-development-audit-hash-secret';
}

const generateToken = (id, email) => {
  const jwt = require('jsonwebtoken');
  const payload = { id };
  if (email) payload.email = email;
  const options = { expiresIn: '30d' };
  return jwt.sign(payload, getJwtSecret(), options);
};

function signJwt(payload, options = {}) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(payload, getJwtSecret(), options);
}

function verifyJwt(token) {
  const jwt = require('jsonwebtoken');
  return jwt.verify(token, getJwtSecret());
}

function getAllowedOrigins() {
  const configured = [
    ...parseCsv(process.env.CORS_ORIGINS),
    ...parseCsv(process.env.FRONTEND_URL),
    ...parseCsv(process.env.APP_URL),
  ];
  return configured.length ? Array.from(new Set(configured)) : (isProduction ? [] : ['*']);
}

// This server's own public address. React Native's Android WebSocket sends the URL it connects to
// as Origin, so the mobile app's sockets arrive with the backend's own origin. A same-origin request
// is not cross-site, so it is always allowed. Render sets RENDER_EXTERNAL_URL itself.
function getSelfOrigins() {
  return [process.env.RENDER_EXTERNAL_URL, process.env.PUBLIC_SERVER_URL, process.env.LTI_TOOL_URL]
    .flatMap(parseCsv)
    .map((value) => { try { return new URL(value).origin; } catch { return null; } })
    .filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (getSelfOrigins().includes(origin)) return true;

  // The desktop app loads app://- and rewrites the Origin of its requests to http://localhost:8081
  // (main.js). In production only those exact origins are accepted, not every local port, since
  // this allow-list is also what guards Socket.IO connections.
  const desktopOrigins = parseCsv(process.env.DESKTOP_ORIGINS || 'app://-,http://localhost:8081');
  if (desktopOrigins.includes(origin)) return true;

  // Local development: any port on localhost
  if (!isProduction && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
    return true;
  }

  return false;
}

function corsOrigin(origin, callback) {
  const allowedOrigins = getAllowedOrigins();
  if (isOriginAllowed(origin, allowedOrigins)) {
    callback(null, true);
    return;
  }
  callback(new Error(`CORS origin not allowed: ${origin}`));
}

function createCorsOptions() {
  return {
    origin: corsOrigin,
    credentials: true,
  };
}

function ensureServerConfig() {
  getJwtSecret();
  const allowedOrigins = getAllowedOrigins();
  if (isProduction) {
    if (!allowedOrigins.length) {
      console.warn('[CONFIG] CORS_ORIGINS is empty in production. Browser clients on separate domains will be blocked.');
    }
    if (!process.env.MONGO_URI) {
      console.warn('[CONFIG] MONGO_URI is not set in production. Persistent user/session storage will not be available.');
    }
  }
}

module.exports = {
  createCorsOptions,
  ensureServerConfig,
  getAllowedOrigins,
  getAuditHashSecret,
  getJwtSecret,
  isOriginAllowed,
  signJwt,
  verifyJwt,
};
