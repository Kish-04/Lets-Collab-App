// LTI 1.3 tool core: lets a course on Moodle, Canvas, Blackboard or any LTI 1.3 platform open
// Let's Collab from a course activity, and receive exam grades back (Assignment and Grade Services).
//
// One platform is configured through the environment (register Let's Collab there as an "LTI 1.3
// external tool" with the URLs from GET /api/lti/config):
//   LTI_ISSUER            platform issuer, e.g. https://moodle.example.edu
//   LTI_CLIENT_ID         client id the platform assigned to this tool
//   LTI_DEPLOYMENT_ID     deployment id (comma-separated for several)
//   LTI_AUTH_LOGIN_URL    platform OIDC authentication endpoint
//   LTI_KEYSET_URL        platform public keyset (JWKS)
//   LTI_ACCESS_TOKEN_URL  platform OAuth2 token endpoint (grade passback)
//   LTI_TOOL_PRIVATE_KEY  this tool's RSA private key (PKCS#8 PEM, "\n" may be escaped); without it a
//                         temporary key is generated and the platform must re-fetch /api/lti/jwks
// State, nonces and course links live in memory (one server instance), like live rooms do.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/';
const AGS_CLAIM = 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint';
const SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';
const STATE_TTL_MS = 10 * 60 * 1000;

function platformConfig() {
  return {
    issuer: process.env.LTI_ISSUER || '',
    clientId: process.env.LTI_CLIENT_ID || '',
    deploymentIds: String(process.env.LTI_DEPLOYMENT_ID || '').split(',').map(s => s.trim()).filter(Boolean),
    authLoginUrl: process.env.LTI_AUTH_LOGIN_URL || '',
    keysetUrl: process.env.LTI_KEYSET_URL || '',
    accessTokenUrl: process.env.LTI_ACCESS_TOKEN_URL || '',
  };
}

const configured = () => {
  const c = platformConfig();
  return Boolean(c.issuer && c.clientId && c.authLoginUrl && c.keysetUrl);
};

// ── This tool's key (signs grade-passback requests; published at /api/lti/jwks) ──
let toolKeys = null;
function getToolKeys() {
  if (toolKeys) return toolKeys;
  const pem = String(process.env.LTI_TOOL_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const privateKey = pem ? crypto.createPrivateKey(pem) : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const publicKey = crypto.createPublicKey(privateKey);
  const kid = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  toolKeys = { privateKey, publicKey, kid };
  return toolKeys;
}

function toolJwks() {
  const { publicKey, kid } = getToolKeys();
  return { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] };
}

// ── OIDC login state and launch nonces (single use, short-lived) ──
const pendingLogins = new Map(); // state -> { nonce, expiresAt }
const usedNonces = new Map(); // nonce -> expiresAt

function sweep(map, now = Date.now()) {
  for (const [key, value] of map) if ((value.expiresAt || value) < now) map.delete(key);
}

function beginLogin() {
  sweep(pendingLogins);
  const state = crypto.randomBytes(24).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  pendingLogins.set(state, { nonce, expiresAt: Date.now() + STATE_TTL_MS });
  return { state, nonce };
}

function takeLogin(state) {
  const entry = state && pendingLogins.get(state);
  if (!entry) return null;
  pendingLogins.delete(state);
  return entry.expiresAt > Date.now() ? entry : null;
}

// ── Platform keyset (cached) ──
let keysetCache = { url: '', keys: [], fetchedAt: 0 };
async function platformKey(kid) {
  const { keysetUrl } = platformConfig();
  const fresh = keysetCache.url === keysetUrl && Date.now() - keysetCache.fetchedAt < 10 * 60 * 1000;
  let key = fresh ? keysetCache.keys.find(k => k.kid === kid) : null;
  if (!key) {
    // Unknown kid: the platform may have rotated its keys, so refetch once
    const res = await fetch(keysetUrl);
    if (!res.ok) throw new Error(`platform keyset returned ${res.status}`);
    const body = await res.json();
    keysetCache = { url: keysetUrl, keys: Array.isArray(body.keys) ? body.keys : [], fetchedAt: Date.now() };
    key = keysetCache.keys.find(k => k.kid === kid) || (keysetCache.keys.length === 1 && !kid ? keysetCache.keys[0] : null);
  }
  if (!key) throw new Error('signing key not in the platform keyset');
  return crypto.createPublicKey({ key, format: 'jwk' });
}

/**
 * Verifies a launch id_token (signature, issuer, audience, expiry, single-use nonce, deployment,
 * message type, version) and returns the parts the tool uses.
 */
async function verifyLaunch(idToken, expectedNonce) {
  const c = platformConfig();
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header) throw new Error('malformed id_token');
  const key = await platformKey(decoded.header.kid);
  const claims = jwt.verify(idToken, key, { algorithms: ['RS256'], issuer: c.issuer, audience: c.clientId, clockTolerance: 60 });

  if (!claims.nonce || claims.nonce !== expectedNonce) throw new Error('nonce mismatch');
  sweep(usedNonces);
  if (usedNonces.has(claims.nonce)) throw new Error('nonce already used');
  usedNonces.set(claims.nonce, Date.now() + STATE_TTL_MS);

  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== c.clientId) throw new Error('azp mismatch');
  const deploymentId = claims[`${CLAIM}deployment_id`];
  if (c.deploymentIds.length && !c.deploymentIds.includes(deploymentId)) throw new Error('unknown deployment');
  if (claims[`${CLAIM}message_type`] !== 'LtiResourceLinkRequest') throw new Error('unsupported message type');
  if (claims[`${CLAIM}version`] !== '1.3.0') throw new Error('unsupported LTI version');
  const link = claims[`${CLAIM}resource_link`];
  if (!link || !link.id) throw new Error('missing resource link');

  const roles = claims[`${CLAIM}roles`] || [];
  const isInstructor = roles.some(role => /#(Instructor|Administrator|ContentDeveloper|TeachingAssistant)$/.test(role) || /membership#Instructor/.test(role));
  const ags = claims[AGS_CLAIM] || null;
  return {
    sub: String(claims.sub),
    email: claims.email ? String(claims.email).trim().toLowerCase() : null,
    name: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || 'LTI user',
    isInstructor,
    linkKey: `${c.issuer}|${deploymentId}|${link.id}`,
    linkTitle: link.title || claims[`${CLAIM}context`]?.title || 'Course activity',
    lineitem: ags && Array.isArray(ags.scope) && ags.scope.includes(SCORE_SCOPE) ? ags.lineitem || null : null,
  };
}

// ── Course activity -> live room, and the LMS user id of each candidate ──
const links = new Map(); // linkKey -> { roomCode, lineitem, title, hostEmail, subsByEmail: Map }

function rememberLaunch(launch) {
  const entry = links.get(launch.linkKey) || { roomCode: null, lineitem: null, title: launch.linkTitle, hostEmail: null, subsByEmail: new Map() };
  if (launch.lineitem) entry.lineitem = launch.lineitem;
  if (launch.email) entry.subsByEmail.set(launch.email, launch.sub);
  if (launch.isInstructor && launch.email) entry.hostEmail = launch.email;
  links.set(launch.linkKey, entry);
  return entry;
}

const linkFor = key => links.get(key) || null;

// ── Grade passback (Assignment and Grade Services) ──
async function accessToken() {
  const c = platformConfig();
  const { privateKey, kid } = getToolKeys();
  const assertion = jwt.sign(
    { iss: c.clientId, sub: c.clientId, aud: c.accessTokenUrl, jti: crypto.randomUUID() },
    privateKey,
    { algorithm: 'RS256', keyid: kid, expiresIn: 300 },
  );
  const res = await fetch(c.accessTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: SCORE_SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error('no access_token from platform');
  return body.access_token;
}

function scoresUrl(lineitem) {
  const url = new URL(lineitem);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/scores`;
  return url.toString();
}

/** Sends one score per candidate: [{ email, given, maximum }]. Returns how many the platform accepted. */
async function sendScores(linkKey, scores) {
  const entry = links.get(linkKey);
  if (!entry || !entry.lineitem || !platformConfig().accessTokenUrl || scores.length === 0) return 0;
  const token = await accessToken();
  let sent = 0;
  for (const score of scores) {
    const userId = entry.subsByEmail.get(score.email);
    if (!userId) continue; // joined without launching from the course: no LMS identity to grade
    const res = await fetch(scoresUrl(entry.lineitem), {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.ims.lis.v1.score+json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userId,
        scoreGiven: score.given,
        scoreMaximum: score.maximum,
        activityProgress: 'Completed',
        gradingProgress: 'FullyGraded',
        timestamp: new Date().toISOString(),
      }),
    });
    if (res.ok) sent += 1;
    else console.error(`[LTI] score for ${score.email} rejected: ${res.status}`);
  }
  return sent;
}

module.exports = {
  platformConfig, configured, toolJwks, beginLogin, takeLogin, verifyLaunch,
  rememberLaunch, linkFor, sendScores, scoresUrl, CLAIM, AGS_CLAIM, SCORE_SCOPE,
};
