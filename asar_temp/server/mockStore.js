const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storePath = process.env.MOCK_STORE_FILE
  ? path.resolve(process.env.MOCK_STORE_FILE)
  : path.join(__dirname, 'data', 'mock-db.json');

function emptyState() {
  return {
    users: [],
    alerts: [],
    sessionLogs: [],
  };
}

function normalizeState(value) {
  return {
    users: Array.isArray(value?.users) ? value.users : [],
    alerts: Array.isArray(value?.alerts) ? value.alerts : [],
    sessionLogs: Array.isArray(value?.sessionLogs) ? value.sessionLogs : [],
  };
}

function loadState() {
  try {
    if (!fs.existsSync(storePath)) return emptyState();
    return normalizeState(JSON.parse(fs.readFileSync(storePath, 'utf8')));
  } catch (err) {
    console.warn(`[MOCK STORE] Could not read ${storePath}: ${err.message}`);
    return emptyState();
  }
}

let state = loadState();

function persist() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmpPath, storePath);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  if (!user) return null;
  const { password, otp, otpExpires, ...safe } = user;
  return safe;
}

function findUserByEmail(email) {
  const target = normalizeEmail(email);
  return state.users.find(user => normalizeEmail(user.email) === target) || null;
}

function findUserById(id) {
  return state.users.find(user => String(user._id) === String(id)) || null;
}

function listUsers() {
  return state.users.map(publicUser);
}

function createUser(fields) {
  const now = new Date().toISOString();
  const user = {
    _id: fields._id || `mock-${crypto.randomUUID()}`,
    name: fields.name,
    email: normalizeEmail(fields.email),
    password: fields.password,
    otp: fields.otp,
    otpExpires: fields.otpExpires,
    isVerified: Boolean(fields.isVerified),
    role: fields.role || 'user',
    banned: Boolean(fields.banned),
    sessionCount: fields.sessionCount || 0,
    lastSeen: fields.lastSeen || null,
    createdAt: fields.createdAt || now,
    updatedAt: fields.updatedAt || now,
  };
  state.users.unshift(user);
  persist();
  return user;
}

function saveUser(user) {
  const index = state.users.findIndex(candidate => String(candidate._id) === String(user._id));
  user.email = normalizeEmail(user.email);
  user.updatedAt = new Date().toISOString();
  if (index === -1) state.users.unshift(user);
  else state.users[index] = user;
  persist();
  return user;
}

function updateUser(id, patch) {
  const user = findUserById(id);
  if (!user) return null;
  Object.assign(user, patch);
  return saveUser(user);
}

function addAlert(alert) {
  const item = {
    _id: `mock-alert-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...alert,
  };
  state.alerts.unshift(item);
  state.alerts = state.alerts.slice(0, 1000);
  persist();
  return item;
}

function listAlerts(limit = 500) {
  return state.alerts.slice(0, limit);
}

function addSessionLog(session) {
  const item = {
    _id: `mock-session-${crypto.randomUUID()}`,
    ...session,
    startedAt: session.startedAt instanceof Date ? session.startedAt.toISOString() : session.startedAt,
    endedAt: session.endedAt instanceof Date ? session.endedAt.toISOString() : session.endedAt,
  };
  state.sessionLogs = [
    item,
    ...state.sessionLogs.filter(existing => existing.roomCode !== item.roomCode),
  ].slice(0, 500);
  persist();
  return item;
}

function listSessionLogs(limit = 500) {
  return state.sessionLogs.slice(0, limit);
}

module.exports = {
  addAlert,
  addSessionLog,
  createUser,
  findUserByEmail,
  findUserById,
  listAlerts,
  listSessionLogs,
  listUsers,
  publicUser,
  saveUser,
  updateUser,
};
