// Small helpers for rooms and their members: ids, codes, numbers, payloads, federated inputs.

const validPermissions = new Set(['view', 'mouse', 'keyboard', 'full']);

const MAX_FEDERATED_WEIGHTS = 10000;

const appearanceKeys = new Set([
  'preset', 'background', 'surface', 'elevated', 'border', 'textPrimary',
  'textSecondary', 'accent', 'success', 'warning', 'danger', 'radius',
  'density', 'glow', 'transparency', 'reducedMotion',
]);

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAppearance(appearance) {
  if (!appearance || typeof appearance !== 'object') return null;
  return Object.fromEntries(Object.entries(appearance).filter(([key]) => appearanceKeys.has(key)));
}

function nowTime() {
  return new Date().toISOString();
}

function normalizeRoomCode(value) {
  return String(value || '').trim().toUpperCase();
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function applyRiskPenalty(room, value, fallback = 0) {
  const penalty = clampNumber(value, fallback, 0, 100);
  room.riskScore = clampNumber((room.riskScore || 0) + penalty, 0, 0, 100);
  return penalty;
}

function initials(name = 'User') {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'U';
}

// Federated features are three normalised signals in [0, 1]
function sanitizeFeatures(features) {
  if (!Array.isArray(features) || features.length !== 3) return undefined;
  const values = features.map(Number);
  return values.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ? values : undefined;
}

function sanitizeWeights(weights) {
  if (!Array.isArray(weights) || weights.length === 0 || weights.length > MAX_FEDERATED_WEIGHTS) return null;
  const sanitized = weights.map(Number);
  return sanitized.every(Number.isFinite) ? sanitized : null;
}

function participantPayload(participant) {
  return {
    id: participant.id,
    socketId: participant.id,
    name: participant.name,
    email: participant.email,
    initials: participant.initials,
    role: participant.role,
    permission: participant.permission,
    clipboardAllowed: participant.clipboardAllowed,
    joinedAt: participant.joinedAt,
    quality: participant.quality,
  };
}

function pendingPayload(participant) {
  return {
    id: participant.id,
    socketId: participant.id,
    name: participant.name,
    email: participant.email,
    initials: participant.initials,
    device: participant.device,
    ip: participant.ip,
    requestedAt: participant.requestedAt,
  };
}

module.exports = { validPermissions, MAX_FEDERATED_WEIGHTS, appearanceKeys, makeId, normalizeAppearance, nowTime, normalizeRoomCode, clampNumber, applyRiskPenalty, initials, sanitizeFeatures, sanitizeWeights, participantPayload, pendingPayload };
