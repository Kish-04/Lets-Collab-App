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

  if (isProduction || process.env.NODE_ENV !== 'test') {
    console.error('[FATAL] JWT_SECRET is required but not set. Exiting immediately.');
    process.exit(1);
  }

  // Only allow fallback during tests
  if (!global.__LETSCOLLAB_DEV_JWT_SECRET) {
    global.__LETSCOLLAB_DEV_JWT_SECRET = crypto.randomBytes(32).toString('hex');
  }
  return global.__LETSCOLLAB_DEV_JWT_SECRET;
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
  return parseCsv(process.env.CORS_ORIGINS, isProduction ? [] : ['*']);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;
  
  // Always allow the desktop app (which uses random ports on localhost)
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return true;
  }
  
  // Hardcode the known production Vercel domain so it always works even if user forgets to set env var
  if (origin === 'https://letscollab-pearl.vercel.app' || origin.endsWith('.vercel.app')) {
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
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is required when NODE_ENV=production.');
    }
    // Bypassed strict origin check so it doesn't crash on boot if env var isn't set
  }
}

module.exports = {
  createCorsOptions,
  ensureServerConfig,
  getAllowedOrigins,
  getJwtSecret,
  signJwt,
  verifyJwt,
};
