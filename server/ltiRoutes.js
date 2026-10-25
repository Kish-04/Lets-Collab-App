// LTI 1.3 endpoints (see lti.js for the configuration and the protocol checks).
//
//   GET      /api/lti/config   URLs to enter when registering the tool on the platform
//   GET      /api/lti/jwks     this tool's public keyset (the platform verifies grade requests with it)
//   GET|POST /api/lti/login    OIDC third-party initiated login -> redirect to the platform
//   POST     /api/lti/launch   the platform posts the signed id_token here -> signed in, redirected
//   GET      /api/lti/room     ?link=  the live room of a course activity (for students waiting on it)
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const lti = require('./lti');
const User = require('./User');
const mockStore = require('./mockStore');
const { signJwt } = require('./config');
const { protectAuthenticated } = require('./adminRoutes');

const router = express.Router();
router.use(express.urlencoded({ extended: false, limit: '64kb' }));

function toolBaseUrl(req) {
  return (process.env.LTI_TOOL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:8081').replace(/\/+$/, '').replace(/\/app$/, '');
}

const refuse = (res, status, message) => res.status(status).type('text/plain').send(`LTI launch refused: ${message}`);

router.get('/config', (req, res) => {
  const base = toolBaseUrl(req);
  res.json({
    configured: lti.configured(),
    loginUrl: `${base}/api/lti/login`,
    redirectUrl: `${base}/api/lti/launch`,
    jwksUrl: `${base}/api/lti/jwks`,
    scopes: [lti.SCORE_SCOPE],
  });
});

router.get('/jwks', (req, res) => res.json(lti.toolJwks()));

router.all('/login', (req, res) => {
  if (!lti.configured()) return refuse(res, 501, 'LTI is not configured on this server.');
  const params = { ...req.query, ...(req.body || {}) };
  const config = lti.platformConfig();
  if (params.iss !== config.issuer) return refuse(res, 400, 'unknown platform.');
  if (params.client_id && params.client_id !== config.clientId) return refuse(res, 400, 'unknown client.');
  if (!params.login_hint) return refuse(res, 400, 'missing login_hint.');

  const { state, nonce } = lti.beginLogin();
  const target = new URL(config.authLoginUrl);
  const query = {
    scope: 'openid',
    response_type: 'id_token',
    response_mode: 'form_post',
    prompt: 'none',
    client_id: config.clientId,
    redirect_uri: `${toolBaseUrl(req)}/api/lti/launch`,
    login_hint: params.login_hint,
    state,
    nonce,
  };
  if (params.lti_message_hint) query.lti_message_hint = params.lti_message_hint;
  Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, value));
  res.redirect(302, target.toString());
});

async function findOrCreateLtiUser(email, name) {
  let user = global.dbConnected ? await User.findOne({ email }) : mockStore.findUserByEmail(email);
  const randomPassword = crypto.randomBytes(24).toString('hex');
  if (!user) {
    return global.dbConnected
      ? User.create({ name, email, password: randomPassword, isVerified: true })
      : mockStore.createUser({ name, email, password: await bcrypt.hash(randomPassword, 10), isVerified: true });
  }
  if (!user.isVerified) {
    // The platform vouched for this email: an unverified pre-registration must not keep its password
    user.password = global.dbConnected ? randomPassword : await bcrypt.hash(randomPassword, 10);
    user.isVerified = true;
    if (global.dbConnected) await user.save();
    else mockStore.saveUser(user);
  }
  return user;
}

router.post('/launch', async (req, res) => {
  try {
    if (!lti.configured()) return refuse(res, 501, 'LTI is not configured on this server.');
    const login = lti.takeLogin(req.body && req.body.state);
    if (!login) return refuse(res, 400, 'the login state is missing or expired; open the activity again.');
    const launch = await lti.verifyLaunch(String(req.body.id_token || ''), login.nonce);
    if (!launch.email) return refuse(res, 400, 'the platform did not share an email address; enable it in the tool\'s privacy settings.');

    const user = await findOrCreateLtiUser(launch.email, launch.name);
    if (user.banned) return refuse(res, 403, 'this account is blocked.');
    lti.rememberLaunch(launch);

    const token = signJwt({ id: user._id, email: user.email }, { expiresIn: process.env.JWT_EXPIRES_IN || '30d' });
    // The token travels in the URL fragment, which browsers never send to a server or log
    const fragment = new URLSearchParams({
      token,
      name: user.name || launch.name,
      email: user.email,
      role: launch.isInstructor ? 'instructor' : 'learner',
      link: launch.linkKey,
      title: launch.linkTitle,
    });
    res.redirect(302, `${frontendUrl()}/lti/launch#${fragment.toString()}`);
  } catch (err) {
    console.warn('[LTI] launch refused:', err.message);
    refuse(res, 401, err.message);
  }
});

router.get('/room', protectAuthenticated, (req, res) => {
  const entry = lti.linkFor(String(req.query.link || ''));
  const { liveRoomCode } = require('./index');
  const roomCode = entry && entry.roomCode && liveRoomCode(entry.roomCode) ? entry.roomCode : null;
  res.json({ success: true, roomCode, title: entry ? entry.title : null });
});

module.exports = router;
