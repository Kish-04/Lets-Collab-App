const crypto = require('crypto');
const { getJwtSecret } = require('./config');

// Evidence screenshots and recordings are personal data, so /uploads is not public: admins get
// short-lived HMAC-signed URLs (works for <img>, <video> and React Native <Image> without headers).
const DEFAULT_TTL_SECONDS = 60 * 60;

function uploadSecret() {
  return process.env.UPLOAD_URL_SECRET || getJwtSecret();
}

function signature(pathname, expiry) {
  return crypto.createHmac('sha256', uploadSecret()).update(`${pathname}:${expiry}`).digest('base64url');
}

/** Only local upload paths are accepted as evidence; anything else (e.g. external URLs sent by a client) is dropped. */
function isUploadPath(url) {
  return typeof url === 'string' && /^\/uploads\/[A-Za-z0-9._\-/]+$/.test(url) && !url.includes('..');
}

function signUploadUrl(url, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!isUploadPath(url)) return null;
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${url}?exp=${expiry}&sig=${signature(url, expiry)}`;
}

/** Express middleware for the /uploads mount: rejects requests without a valid, unexpired signature. */
function requireSignedUpload(req, res, next) {
  const pathname = `/uploads${req.path}`;
  const expiry = Number(req.query.exp);
  const provided = String(req.query.sig || '');
  if (!Number.isFinite(expiry) || expiry < Date.now() / 1000 || !provided) {
    return res.status(403).send('Signed URL required');
  }
  const expected = signature(pathname, expiry);
  const valid = provided.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!valid) return res.status(403).send('Invalid signature');
  res.set('Cache-Control', 'private, max-age=300');
  next();
}

module.exports = { isUploadPath, requireSignedUpload, signUploadUrl };
