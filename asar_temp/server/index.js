const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
// Fallback to root .env if it exists
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cookie = require('cookie');
const connectDB = require('./db');
const authRoutes = require('./authRoutes');
const { router: adminRoutes, onlineEmails, setRoomLookup } = require('./adminRoutes');
const User = require('./User');
const Alert = require('./alert');
const SessionLog = require('./sessionLog');
const { initBlockchain, logToChain, queryChain, querySessionLogs } = require('./blockchainLogger');
const { ethers } = require('ethers');
const { createCorsOptions, ensureServerConfig, verifyJwt } = require('./config');
const mockStore = require('./mockStore');

const app = express();
ensureServerConfig();

const corsOptions = createCorsOptions();
app.use(cors(corsOptions));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.json({ limit: '2mb' }));

// Serve the statically exported Next.js app (if available)
const nextOutPath = path.join(__dirname, '..', 'out');
const fs = require('fs');
if (fs.existsSync(nextOutPath)) {
  app.use(express.static(nextOutPath));
  // Provide a fallback for Next.js routing
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(nextOutPath, 'index.html'));
  });
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    dbConnected: Boolean(global.dbConnected),
    blockchainActive: Boolean(global.blockchainActive),
    timestamp: new Date().toISOString(),
  });
});

connectDB();
initBlockchain();

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/sessions/:sessionId/history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const rawLogs = await querySessionLogs(sessionId);

    // Build hash -> email map
    const dbUsers = global.dbConnected ? await User.find({}) : [];
    const mockUsers = mockStore.listUsers();
    const allUsers = [...dbUsers, ...mockUsers];
    const hashMap = {};
    for (const user of allUsers) {
      if (user.email) {
        hashMap[ethers.id(user.email)] = user.email;
      }
    }

    const resolvedLogs = rawLogs.map(log => ({
      txHash: log.txHash,
      timestamp: log.timestamp,
      eventType: log.eventType,
      hostEmail: log.hostId ? (hashMap[log.hostId] || 'Unknown Hash') : '',
      controllerEmail: log.controllerId ? (hashMap[log.controllerId] || 'Unknown Hash') : '',
      dataHash: log.dataHash
    }));

    res.json({ success: true, logs: resolvedLogs });
  } catch (error) {
    console.error('History Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
});

app.get('/api/turn/credentials', async (req, res) => {
  try {
    const staticTurnUrl = process.env.TURN_URL || process.env.NEXT_PUBLIC_TURN_URL;
    if (staticTurnUrl) {
      return res.json([
        {
          urls: staticTurnUrl,
          username: process.env.TURN_USERNAME || process.env.NEXT_PUBLIC_TURN_USERNAME || undefined,
          credential: process.env.TURN_CREDENTIAL || process.env.NEXT_PUBLIC_TURN_CREDENTIAL || undefined,
        },
        { urls: 'stun:stun.l.google.com:19302' },
      ]);
    }

    const domain = process.env.METERED_DOMAIN;
    const apiKey = process.env.METERED_SECRET_KEY;
    if (!domain || !apiKey) {
      return res.status(500).json({ error: 'TURN credentials not configured on backend.' });
    }
    const response = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`);
    if (!response.ok) {
      throw new Error(`Metered API returned ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Error fetching TURN credentials:', err.message);
    res.status(200).json([{ urls: 'stun:stun.l.google.com:19302' }]);
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;
const rooms = new Map();
const endedSessions = [];
const validPermissions = new Set(['view', 'mouse', 'keyboard', 'full']);
setRoomLookup((roomCode) => rooms.get(String(roomCode || '').toUpperCase()));
const appearanceKeys = new Set([
  'preset', 'background', 'surface', 'elevated', 'border', 'textPrimary',
  'textSecondary', 'accent', 'success', 'warning', 'danger', 'radius',
  'density', 'glow', 'transparency', 'reducedMotion',
]);

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAppearance(appearance) {
  if (!appearance || typeof appearance !== 'object') return null;
  return Object.fromEntries(Object.entries(appearance).filter(([key]) => appearanceKeys.has(key)));
}

function nowTime() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function initials(name = 'User') {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'U';
}

function pushEvent(roomCode, type, message) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.events.push({ time: nowTime(), type, message });
  if (room.events.length > 140) room.events.shift();
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

function roomState(code, room, socket) {
  const ownController = socket ? room.controllers.get(socket.id) : null;
  return {
    roomCode: code,
    mode: room.mode,
    permission: ownController ? ownController.permission : room.defaultPermission,
    clipboardAllowed: ownController ? ownController.clipboardAllowed : room.defaultClipboardAllowed,
    appearance: room.appearance,
    observerCount: room.observers.size,
    riskScore: room.riskScore,
    participants: Array.from(room.controllers.values()).map(participantPayload),
    pendingRequests: Array.from(room.pendingControllers.values()).map(pendingPayload),
    messages: room.messages.slice(-80),
    evidence: room.evidence.slice(-80),
  };
}

function emitRoomState(code) {
  const room = rooms.get(code);
  if (!room) return;
  const recipients = [
    room.hostSocketId,
    ...Array.from(room.controllers.keys()),
    ...Array.from(room.observers),
  ].filter(Boolean);
  recipients.forEach((socketId) => {
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) targetSocket.emit('session-state', roomState(code, room, targetSocket));
  });
}

function serializeSessions() {
  const now = Date.now();
  return Array.from(rooms.entries()).map(([code, room]) => ({
    id: code,
    host: room.hostName || 'Unknown Host',
    hostSocketId: room.hostSocketId,
    controllerCount: room.controllers.size,
    pendingCount: room.pendingControllers.size,
    durationSeconds: Math.floor((now - room.createdAt) / 1000),
    riskScore: room.riskScore,
    alertCount: room.alertCount,
    status: room.riskScore >= 70 ? 'high-risk' : 'live',
    latestTxHash: room.latestTxHash || null,
    createdAt: room.createdAt,
    events: room.events,
    mode: room.mode,
    permission: room.defaultPermission,
    appearance: room.appearance,
    observerCount: room.observers.size,
    hasController: room.controllers.size > 0,
    controllers: Array.from(room.controllers.values()).map(participantPayload),
    pendingControllers: Array.from(room.pendingControllers.values()).map(pendingPayload),
    evidence: room.evidence.slice(-20),
    messageCount: room.messages.length,
  }));
}

function broadcastSessions() {
  io.to('admins').emit('sessions-update', serializeSessions());
  io.emit('sessions-count', { active: rooms.size });
}

function anchorEvent(code, eventType, data, hostEmail = '', controllerEmail = '') {
  const room = rooms.get(code);
  if (!room) return;
  
  // Hash emails for privacy before sending to chain
  const hashedHost = hostEmail ? ethers.id(hostEmail) : '';
  const hashedController = controllerEmail ? ethers.id(controllerEmail) : '';

  logToChain(code, hashedHost, hashedController, eventType, data)
    .then((txHash) => {
      const liveRoom = rooms.get(code);
      if (!liveRoom || !txHash) return;
      liveRoom.latestTxHash = txHash;
      pushEvent(code, 'chain', `Audit anchored: ${String(txHash).slice(0, 18)}...`);
      io.to(code).emit('chain-log', {
        type: eventType.toLowerCase(),
        hash: txHash,
        timestamp: nowTime(),
      });
      broadcastSessions();
    })
    .catch((err) => console.error('[AUDIT]', err.message));
}

function getTokenFromSocket(socket) {
  let token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token && socket.handshake.headers.cookie) {
    const cookies = cookie.parse(socket.handshake.headers.cookie);
    token = cookies.auth_token;
  }
  return token;
}

async function isAdminSocket(socket) {
  const token = getTokenFromSocket(socket);
  if (!token) return false;
  try {
    const decoded = verifyJwt(token);
    if (!global.dbConnected) {
      const user = mockStore.findUserById(decoded.id);
      return Boolean(user && user.role === 'admin' && !user.banned);
    }
    const user = await User.findById(decoded.id).select('role banned');
    return Boolean(user && user.role === 'admin' && !user.banned);
  } catch {
    return false;
  }
}

async function authenticatedUser(socket) {
  const token = getTokenFromSocket(socket);
  if (!token) return null;
  try {
    const decoded = verifyJwt(token);
    if (!global.dbConnected) {
      const user = mockStore.findUserById(decoded.id);
      return user && !user.banned ? user : null;
    }
    const user = await User.findById(decoded.id).select('name email role banned');
    return user && !user.banned ? user : null;
  } catch {
    return null;
  }
}

async function canModerate(socket, room) {
  return Boolean(room && (socket.id === room.hostSocketId || await isAdminSocket(socket)));
}

function allRoomParticipants(room) {
  return [
    {
      socketId: room.hostSocketId,
      name: room.hostName,
      email: room.hostEmail,
      role: 'host',
      permission: 'host',
      joinedAt: new Date(room.createdAt),
      leftAt: null,
    },
    ...Array.from(room.controllers.values()).map((participant) => ({
      socketId: participant.id,
      name: participant.name,
      email: participant.email,
      role: 'controller',
      permission: participant.permission,
      joinedAt: participant.joinedAt ? new Date(participant.joinedAt) : null,
      leftAt: participant.leftAt ? new Date(participant.leftAt) : null,
    })),
  ];
}

async function archiveSession(roomCode, reason) {
  const room = rooms.get(roomCode);
  if (!room || room.archived) return;
  room.archived = true;
  const endedAt = Date.now();
  pushEvent(roomCode, 'kill', reason);
  const archived = {
    roomCode,
    mode: room.mode,
    hostName: room.hostName,
    hostEmail: room.hostEmail,
    startedAt: new Date(room.createdAt),
    endedAt: new Date(endedAt),
    durationSeconds: Math.floor((endedAt - room.createdAt) / 1000),
    participants: allRoomParticipants(room),
    events: room.events,
    messages: room.messages,
    evidence: room.evidence,
    riskScore: room.riskScore,
    alertCount: room.alertCount,
    latestTxHash: room.latestTxHash,
  };
  endedSessions.unshift(archived);
  if (endedSessions.length > 100) endedSessions.pop();
  if (global.dbConnected) {
    try {
      await SessionLog.create(archived);
    } catch (err) {
      console.error('Session archive save error:', err.message);
    }
  } else {
    mockStore.addSessionLog(archived);
  }
}

function removeController(roomCode, controllerId, reason) {
  const room = rooms.get(roomCode);
  if (!room) return false;
  const controllerIds = controllerId ? [controllerId] : Array.from(room.controllers.keys());
  let removed = false;

  controllerIds.forEach((id) => {
    const participant = room.controllers.get(id);
    if (!participant) return;
    participant.leftAt = Date.now();
    const controller = io.sockets.sockets.get(id);
    if (controller) {
      controller.emit('removed-from-session', { reason });
      controller.leave(roomCode);
      controller.roomCode = null;
      controller.role = null;
    }
    room.controllers.delete(id);
    io.to(room.hostSocketId).emit('controller-left', { controllerId: id, controller: participantPayload(participant) });
    removed = true;
  });

  if (removed) {
    pushEvent(roomCode, 'permission', reason);
    emitRoomState(roomCode);
    broadcastSessions();
  }
  return removed;
}

function grantObservation(roomCode, observerId) {
  const room = rooms.get(roomCode);
  const observerSocket = io.sockets.sockets.get(observerId);
  if (!room || !observerSocket) return;
  room.pendingObservers.delete(observerId);
  room.observers.add(observerId);
  observerSocket.join(roomCode);
  observerSocket.role = 'observer';
  observerSocket.observingRoom = roomCode;
  io.to(observerId).emit('observation-granted', {
    roomCode,
    mode: room.mode,
    appearance: room.appearance,
  });
  io.to(room.hostSocketId).emit('admin-observer-joined', { observerId });
  pushEvent(roomCode, 'system', 'Administrator entered live screen observation visibly');
  emitRoomState(roomCode);
  broadcastSessions();
}

function buildPendingController(socket, actor, meta = {}) {
  const name = actor.name || meta.name || 'Controller';
  return {
    id: socket.id,
    name,
    email: actor.email || meta.email || null,
    initials: initials(name),
    role: 'controller',
    device: meta.device || socket.handshake.headers['user-agent'] || 'Browser',
    ip: socket.handshake.address || 'unknown',
    requestedAt: Date.now(),
  };
}

function activateController(roomCode, controllerId, permission = 'view', options = {}) {
  const room = rooms.get(roomCode);
  const socket = io.sockets.sockets.get(controllerId);
  const pending = room?.pendingControllers.get(controllerId);
  if (!room || !socket || !pending) return false;

  const participant = {
    ...pending,
    permission: validPermissions.has(permission) ? permission : 'view',
    clipboardAllowed: Boolean(options.clipboardAllowed),
    joinedAt: Date.now(),
    leftAt: null,
    quality: { latency: null, fps: null, packetLoss: null, health: 'unknown' },
  };

  room.pendingControllers.delete(controllerId);
  room.controllers.set(controllerId, participant);
  socket.join(roomCode);
  socket.roomCode = roomCode;
  socket.role = 'controller';
  socket.userEmail = participant.email;
  if (participant.email) onlineEmails.add(participant.email);

  pushEvent(roomCode, 'join', `${participant.name} approved as controller (${participant.permission})`);
  socket.emit('join-approved', { roomCode, permission: participant.permission, clipboardAllowed: participant.clipboardAllowed });
  socket.emit('session-state', roomState(roomCode, room, socket));
  io.to(room.hostSocketId).emit('controller-joined', { controllerId, controller: participantPayload(participant) });
  io.to(roomCode).emit('user-joined', controllerId, 'controller', participantPayload(participant));
  anchorEvent(roomCode, 'USER_JOINED', { role: 'controller', email: participant.email, permission: participant.permission }, room.hostEmail, participant.email);
  emitRoomState(roomCode);
  broadcastSessions();
  return true;
}

function isClipboardShortcut(payload = {}) {
  const key = String(payload.key || '').toLowerCase();
  const code = String(payload.code || '').toLowerCase();
  const modifier = Boolean(payload.modifiers?.ctrl || payload.modifiers?.meta);
  return modifier && ['c', 'v', 'x'].some(shortcut => key === shortcut || code === `key${shortcut}`);
}

function isInputAllowed(participant, payload = {}) {
  const isMouse = ['mousemove', 'mousedown', 'mouseup', 'wheel'].includes(payload.type);
  const isKeyboard = ['keydown', 'keyup'].includes(payload.type);
  if (isKeyboard && isClipboardShortcut(payload) && !participant.clipboardAllowed) return false;
  return participant.permission === 'full'
    || (participant.permission === 'mouse' && isMouse)
    || (participant.permission === 'keyboard' && isKeyboard);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  console.log('Handshake Headers:', socket.handshake.headers);
  isAdminSocket(socket).then((admin) => {
    if (admin) socket.join('admins');
  });

  socket.on('identify-user', (email) => {
    if (!email) return;
    socket.userEmail = email;
    onlineEmails.add(email);
  });

  socket.on('create-room', async (meta = {}) => {
    console.log(`[Socket] create-room requested by socket: ${socket.id}`, meta);
    let actor = await authenticatedUser(socket);
    
    // If backend restarted, mock store is empty, but user thinks they are logged in.
    // Allow them to create the room anyway with a default fallback identity.
    if (!actor) {
      console.log(`[Socket] create-room fallback: unauthenticated socket ${socket.id} - granting guest access`);
      actor = { name: meta.name || 'Guest User', email: meta.email || 'guest@local.host' };
    }
    
    const code = generateRoomCode();
    const room = {
      hostSocketId: socket.id,
      hostName: actor.name || meta.name || 'Unknown Host',
      hostEmail: actor.email || meta.email || null,
      hostQuality: { latency: null, fps: null, packetLoss: null, health: 'unknown' },
      controllers: new Map(),
      pendingControllers: new Map(),
      mode: meta.mode === 'supervised' ? 'supervised' : 'collaboration',
      defaultPermission: 'view',
      defaultClipboardAllowed: false,
      appearance: normalizeAppearance(meta.appearance),
      observers: new Set(),
      pendingObservers: new Set(),
      createdAt: Date.now(),
      riskScore: 0,
      alertCount: 0,
      latestTxHash: null,
      events: [],
      messages: [],
      evidence: [],
      archived: false,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.role = 'host';
    socket.userEmail = room.hostEmail;
    if (room.hostEmail) onlineEmails.add(room.hostEmail);

    pushEvent(code, 'system', `${room.mode === 'supervised' ? 'Supervised session' : 'Collaboration room'} created by ${room.hostName}`);
    pushEvent(code, 'permission', 'Guest connections require host approval before screen access');
    if (room.mode === 'supervised') {
      pushEvent(code, 'system', 'Visible activity monitoring is enabled for host and controllers');
    }

    if (room.hostEmail) {
      if (global.dbConnected) {
        User.findOneAndUpdate(
          { email: room.hostEmail },
          { $inc: { sessionCount: 1 }, lastSeen: new Date() },
        ).catch((err) => console.error('sessionCount update error:', err));
      } else {
        const user = mockStore.findUserByEmail(room.hostEmail);
        if (user) {
          user.sessionCount = (user.sessionCount || 0) + 1;
          user.lastSeen = new Date().toISOString();
          mockStore.saveUser(user);
        }
      }
    }

    socket.emit('room-created', { roomCode: code });
    socket.emit('session-state', roomState(code, room, socket));
    anchorEvent(code, 'ROOM_CREATED', { code, mode: room.mode }, room.hostEmail);
    broadcastSessions();
  });

  socket.on('get-sessions', async () => {
    if (await isAdminSocket(socket)) socket.emit('sessions-update', serializeSessions());
    else socket.emit('sessions-count', { active: rooms.size });
  });

  socket.on('get-session-count', () => socket.emit('sessions-count', { active: rooms.size }));

  socket.on('get-session-history', async () => {
    if (!await isAdminSocket(socket)) return;
    if (global.dbConnected) {
      const docs = await SessionLog.find({}).sort({ endedAt: -1 }).limit(100).lean().catch(() => []);
      socket.emit('session-history', docs);
    } else {
      socket.emit('session-history', mockStore.listSessionLogs(100));
    }
  });

  socket.on('query-chain', async () => {
    if (!await isAdminSocket(socket)) {
      socket.emit('admin-error', 'Administrator authentication required');
      return;
    }
    try {
      socket.emit('chain-data', await queryChain());
    } catch (err) {
      socket.emit('chain-data', {
        active: false,
        logs: [],
        totalCount: 0,
        contractAddress: null,
        error: err.message,
      });
    }
  });

  socket.on('join-room', async (roomId, role, meta = {}) => {
    let actor = await authenticatedUser(socket);
    if (!actor) {
      actor = { name: 'Guest Mobile', email: 'guest@example.com' };
    }
    const room = rooms.get(String(roomId || '').toUpperCase());
    if (!room || role !== 'controller') {
      socket.emit('room-not-found', { roomId });
      return;
    }
    if (room.hostEmail && actor.email === room.hostEmail) {
      socket.emit('join-denied', { reason: 'The host cannot join their own room as a controller.' });
      return;
    }
    if (room.controllers.has(socket.id)) {
      socket.emit('session-state', roomState(roomId, room, socket));
      return;
    }

    const pending = buildPendingController(socket, actor, meta);
    room.pendingControllers.set(socket.id, pending);
    socket.pendingRoomCode = roomId;
    socket.role = 'pending-controller';
    socket.userEmail = pending.email;
    socket.emit('join-pending', {
      roomCode: roomId,
      mode: room.mode,
      message: 'Waiting for host approval before the screen opens.',
    });
    io.to(room.hostSocketId).emit('connection-request', pendingPayload(pending));
    pushEvent(roomId, 'join', `${pending.name} requested to join`);
    emitRoomState(roomId);
    broadcastSessions();
  });

  socket.on('respond-join', async ({ controllerId, approved, permission = 'view', options = {} } = {}, roomId) => {
    const room = rooms.get(roomId);
    if (!room || socket.id !== room.hostSocketId) return;
    const pending = room.pendingControllers.get(controllerId);
    if (!pending) return;
    if (!approved) {
      room.pendingControllers.delete(controllerId);
      io.to(controllerId).emit('join-denied', { reason: 'Host denied the connection request.' });
      pushEvent(roomId, 'permission', `${pending.name} was denied before screen access`);
      emitRoomState(roomId);
      broadcastSessions();
      return;
    }
    activateController(roomId, controllerId, permission, options);
  });

  socket.on('offer', (payload, maybeRoomId) => {
    const data = payload && payload.offer ? payload : { offer: payload, roomId: maybeRoomId };
    const room = rooms.get(data.roomId || socket.roomCode);
    if (!room || socket.id !== room.hostSocketId || !data.offer) return;
    const targets = data.targetId ? [data.targetId] : Array.from(room.controllers.keys());
    targets.forEach((targetId) => {
      if (room.controllers.has(targetId)) io.to(targetId).emit('offer', { offer: data.offer, fromId: socket.id, roomId: data.roomId || socket.roomCode });
    });
  });

  socket.on('answer', (payload, maybeRoomId) => {
    const data = payload && payload.answer ? payload : { answer: payload, roomId: maybeRoomId };
    const room = rooms.get(data.roomId || socket.roomCode);
    if (!room || !room.controllers.has(socket.id) || !data.answer) return;
    io.to(room.hostSocketId).emit('answer', { answer: data.answer, fromId: socket.id, roomId: data.roomId || socket.roomCode });
  });

  socket.on('ice-candidate', (payload, maybeRoomId) => {
    const data = payload && payload.candidate ? payload : { candidate: payload, roomId: maybeRoomId };
    const room = rooms.get(data.roomId || socket.roomCode);
    if (!room || !data.candidate) return;
    if (socket.id === room.hostSocketId) {
      const targets = data.targetId ? [data.targetId] : Array.from(room.controllers.keys());
      targets.forEach((targetId) => {
        if (room.controllers.has(targetId)) io.to(targetId).emit('ice-candidate', { candidate: data.candidate, fromId: socket.id, roomId: data.roomId || socket.roomCode });
      });
      return;
    }
    if (room.controllers.has(socket.id)) {
      io.to(room.hostSocketId).emit('ice-candidate', { candidate: data.candidate, fromId: socket.id, roomId: data.roomId || socket.roomCode });
    }
  });

  socket.on('input-event', (payload = {}) => {
    const roomId = payload.room || socket.roomCode;
    const room = rooms.get(roomId);
    const participant = room?.controllers.get(socket.id);
    if (!room || !participant) return;
    if (!isInputAllowed(participant, payload)) {
      socket.emit('input-blocked', {
        reason: isClipboardShortcut(payload) && !participant.clipboardAllowed
          ? 'Clipboard shortcuts are blocked by the host.'
          : `Your current permission is ${participant.permission}.`,
      });
      return;
    }
    io.to(room.hostSocketId).emit('input-event', { ...payload, fromId: socket.id, controllerName: participant.name });
  });

  socket.on('request-access', (payload = {}, roomId) => {
    const room = rooms.get(roomId);
    const participant = room?.controllers.get(socket.id);
    if (!room || !participant) return;
    pushEvent(roomId, 'permission', `Access requested by ${participant.name}`);
    io.to(room.hostSocketId).emit('request-access', {
      ...payload,
      controllerId: socket.id,
      name: participant.name,
      initials: participant.initials,
      device: participant.device,
      ip: participant.ip,
    });
    broadcastSessions();
  });

  socket.on('access-granted', async (permission, options = {}, roomId) => {
    const room = rooms.get(roomId);
    if (!room || !validPermissions.has(permission) || !await canModerate(socket, room)) return;
    const targets = options.targetId ? [options.targetId] : Array.from(room.controllers.keys());
    if (!targets.length) room.defaultPermission = permission;
    targets.forEach((targetId) => {
      const participant = room.controllers.get(targetId);
      if (!participant) return;
      participant.permission = permission;
      if (typeof options.clipboardAllowed === 'boolean') participant.clipboardAllowed = options.clipboardAllowed;
      io.to(targetId).emit('access-granted', permission, {
        clipboardAllowed: participant.clipboardAllowed,
        targetId,
      });
    });
    room.defaultPermission = permission;
    pushEvent(roomId, 'permission', `Access changed to ${String(permission).toUpperCase()}${options.targetId ? ' for one controller' : ' for all controllers'}`);
    emitRoomState(roomId);
    const targetParticipant = options.targetId ? room.controllers.get(options.targetId) : null;
    const targetEmail = targetParticipant ? targetParticipant.email : '';
    anchorEvent(roomId, 'ACCESS_CHANGED', { permission, targetId: options.targetId || null }, room.hostEmail, targetEmail);
    broadcastSessions();
  });

  socket.on('access-denied', (roomId, targetId) => {
    const room = rooms.get(roomId);
    if (!room || socket.id !== room.hostSocketId) return;
    pushEvent(roomId, 'permission', 'Access request denied by host');
    const targets = targetId ? [targetId] : Array.from(room.controllers.keys());
    targets.forEach(id => io.to(id).emit('access-denied'));
    broadcastSessions();
  });

  socket.on('clipboard-policy', async ({ roomId, targetId, allowed } = {}) => {
    const room = rooms.get(roomId);
    if (!room || !await canModerate(socket, room)) return;
    const targets = targetId ? [targetId] : Array.from(room.controllers.keys());
    targets.forEach((id) => {
      const participant = room.controllers.get(id);
      if (!participant) return;
      participant.clipboardAllowed = Boolean(allowed);
      io.to(id).emit('clipboard-policy', { allowed: participant.clipboardAllowed });
    });
    room.defaultClipboardAllowed = Boolean(allowed);
    pushEvent(roomId, 'permission', `Clipboard ${allowed ? 'enabled' : 'blocked'}${targetId ? ' for one controller' : ' for controllers'}`);
    emitRoomState(roomId);
    broadcastSessions();
  });

  socket.on('update-appearance', (roomId, appearance) => {
    const room = rooms.get(roomId);
    if (!room || socket.id !== room.hostSocketId) return;
    room.appearance = normalizeAppearance(appearance);
    socket.to(roomId).emit('appearance-updated', room.appearance);
    emitRoomState(roomId);
    broadcastSessions();
  });

  socket.on('chat-message', ({ roomId, text } = {}) => {
    const room = rooms.get(roomId || socket.roomCode);
    if (!room || typeof text !== 'string' || !text.trim()) return;
    const controller = room.controllers.get(socket.id);
    const isHost = socket.id === room.hostSocketId;
    const isObserver = room.observers.has(socket.id);
    if (!isHost && !controller && !isObserver) return;
    const message = {
      id: makeId('msg'),
      time: nowTime(),
      senderId: socket.id,
      senderName: isHost ? room.hostName : controller?.name || 'Administrator',
      role: isHost ? 'host' : controller ? 'controller' : 'admin',
      text: text.trim().slice(0, 1000),
    };
    room.messages.push(message);
    if (room.messages.length > 150) room.messages.shift();
    pushEvent(roomId || socket.roomCode, 'chat', `${message.senderName}: ${message.text.slice(0, 80)}`);
    io.to(roomId || socket.roomCode).emit('chat-message', message);
    broadcastSessions();
  });

  socket.on('quality-update', ({ roomId, quality = {} } = {}) => {
    const room = rooms.get(roomId || socket.roomCode);
    if (!room) return;
    const safeQuality = {
      latency: Number.isFinite(quality.latency) ? quality.latency : null,
      fps: Number.isFinite(quality.fps) ? quality.fps : null,
      packetLoss: Number.isFinite(quality.packetLoss) ? quality.packetLoss : null,
      health: ['excellent', 'good', 'fair', 'poor', 'unknown'].includes(quality.health) ? quality.health : 'unknown',
    };
    if (socket.id === room.hostSocketId) room.hostQuality = safeQuality;
    const participant = room.controllers.get(socket.id);
    if (participant) participant.quality = safeQuality;
    io.to('admins').emit('quality-update', { roomId: roomId || socket.roomCode, socketId: socket.id, quality: safeQuality });
    broadcastSessions();
  });

  socket.on('evidence-event', ({ roomId, type, label } = {}) => {
    const room = rooms.get(roomId || socket.roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    const evidence = {
      id: makeId(type === 'recording' ? 'rec' : 'shot'),
      time: nowTime(),
      type: type === 'recording' ? 'recording' : 'snapshot',
      by: room.hostName,
      label: String(label || (type === 'recording' ? 'Screen recording saved' : 'Snapshot captured')).slice(0, 120),
    };
    room.evidence.push(evidence);
    pushEvent(roomId || socket.roomCode, 'recording', `${evidence.type}: ${evidence.label}`);
    io.to(roomId || socket.roomCode).emit('evidence-event', evidence);
    broadcastSessions();
  });

  socket.on('kill-session', async (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !await canModerate(socket, room)) return;
    await archiveSession(roomId, 'Session terminated by host or administrator');
    anchorEvent(roomId, 'SESSION_TERMINATED', { by: socket.id === room.hostSocketId ? 'host' : 'admin' }, room.hostEmail);
    io.to(roomId).emit('kill-session');
    room.observers.forEach((observerId) => io.to(observerId).emit('kill-session'));
    rooms.delete(roomId);
    broadcastSessions();
  });

  socket.on('admin-revoke-access', async (roomId, targetId) => {
    const room = rooms.get(roomId);
    if (!room || !await isAdminSocket(socket)) return;
    const targets = targetId ? [targetId] : Array.from(room.controllers.keys());
    targets.forEach((id) => {
      const participant = room.controllers.get(id);
      if (!participant) return;
      participant.permission = 'view';
      io.to(id).emit('access-granted', 'view', { clipboardAllowed: participant.clipboardAllowed, targetId: id });
    });
    room.defaultPermission = 'view';
    pushEvent(roomId, 'permission', 'Administrator revoked controller input access');
    emitRoomState(roomId);
    const targetParticipant = targetId ? room.controllers.get(targetId) : null;
    const targetEmail = targetParticipant ? targetParticipant.email : '';
    anchorEvent(roomId, 'ACCESS_REVOKED', { by: 'admin', targetId: targetId || null }, room.hostEmail, targetEmail);
    broadcastSessions();
  });

  socket.on('admin-remove-controller', async (payload) => {
    const roomId = typeof payload === 'string' ? payload : payload?.roomId;
    const targetId = typeof payload === 'object' ? payload.targetId : undefined;
    if (!await isAdminSocket(socket)) return;
    removeController(roomId, targetId, 'Controller removed from session by administrator');
  });

  socket.on('admin-ban-participant', async ({ roomId, target = 'controller', targetId } = {}) => {
    const room = rooms.get(roomId);
    if (!room || !await isAdminSocket(socket)) return;
    const targetParticipant = target === 'host'
      ? { email: room.hostEmail, name: room.hostName, id: room.hostSocketId }
      : (targetId ? room.controllers.get(targetId) : Array.from(room.controllers.values())[0]);
    const email = targetParticipant?.email;
    if (!email) {
      socket.emit('admin-error', 'Participant has no account identity in this session.');
      return;
    }
    const bannedUser = global.dbConnected
      ? await User.findOneAndUpdate({ email }, { banned: true })
      : (() => {
        const user = mockStore.findUserByEmail(email);
        if (!user) return null;
        user.banned = true;
        return mockStore.saveUser(user);
      })();
    if (!bannedUser) {
      socket.emit('admin-error', 'The participant account could not be found.');
      return;
    }
    pushEvent(roomId, 'kill', `${target === 'host' ? 'Host' : 'Controller'} account banned by administrator`);
    if (target === 'host') {
      await archiveSession(roomId, 'Host account banned by administrator');
      io.to(roomId).emit('kill-session');
      rooms.delete(roomId);
    } else {
      removeController(roomId, targetParticipant.id, 'Your account was banned by an administrator');
    }
    socket.emit('admin-action-complete', { message: `${email} has been banned.` });
    broadcastSessions();
  });

  socket.on('request-observation', async (roomId) => {
    const room = rooms.get(roomId);
    if (!room || !await isAdminSocket(socket)) return;
    socket.observingRoom = roomId;
    if (room.mode === 'supervised') {
      grantObservation(roomId, socket.id);
      return;
    }
    room.pendingObservers.add(socket.id);
    io.to(room.hostSocketId).emit('admin-observation-request', { observerId: socket.id });
    socket.emit('observation-pending', { message: 'Waiting for host approval.' });
  });

  socket.on('respond-observation', ({ observerId, approved }, roomId) => {
    const room = rooms.get(roomId);
    if (!room || socket.id !== room.hostSocketId || !room.pendingObservers.has(observerId)) return;
    if (approved) grantObservation(roomId, observerId);
    else {
      room.pendingObservers.delete(observerId);
      io.to(observerId).emit('observation-denied');
      pushEvent(roomId, 'system', 'Host declined administrator screen observation request');
      broadcastSessions();
    }
  });

  socket.on('observer-offer', ({ observerId, offer }) => {
    const room = rooms.get(socket.roomCode);
    if (room && socket.id === room.hostSocketId && room.observers.has(observerId)) {
      io.to(observerId).emit('observer-offer', { offer, hostId: socket.id });
    }
  });

  socket.on('observer-answer', ({ hostId, answer }) => {
    const room = rooms.get(socket.observingRoom);
    if (room && room.hostSocketId === hostId && room.observers.has(socket.id)) {
      io.to(hostId).emit('observer-answer', { observerId: socket.id, answer });
    }
  });

  socket.on('observer-ice-candidate', ({ targetId, candidate }) => {
    const hostedRoom = rooms.get(socket.roomCode);
    if (hostedRoom && socket.id === hostedRoom.hostSocketId && hostedRoom.observers.has(targetId)) {
      io.to(targetId).emit('observer-ice-candidate', { fromId: socket.id, candidate });
      return;
    }
    const observedRoom = rooms.get(socket.observingRoom);
    if (observedRoom && observedRoom.hostSocketId === targetId && observedRoom.observers.has(socket.id)) {
      io.to(targetId).emit('observer-ice-candidate', { fromId: socket.id, candidate });
    }
  });

  socket.on('system-alert', (payload = {}) => {
    const roomId = payload.room || socket.roomCode;
    const room = rooms.get(roomId);
    if (!room || room.mode !== 'supervised') return;
    const controller = room.controllers.get(socket.id);
    if (socket.id !== room.hostSocketId && !controller) return;
    const participant = socket.id === room.hostSocketId ? 'Host' : controller.name || 'Controller';
    const penalty = payload.penalty || 0;
    room.riskScore = Math.min(100, room.riskScore + penalty);
    room.alertCount += 1;
    pushEvent(roomId, payload.type === 'anticheat_violation' ? 'anticheat' : 'system', `${participant}: ${payload.message || 'Activity detected'}`);
    if (global.dbConnected) {
      Alert.create({
        room: roomId,
        hostEmail: room.hostEmail || undefined,
        type: payload.type || 'activity',
        event: payload.event || undefined,
        message: `${participant}: ${payload.message || 'Activity detected'}`,
        penalty,
      }).catch((err) => console.error('Alert save error:', err));
    } else {
      mockStore.addAlert({
        room: roomId,
        hostEmail: room.hostEmail || undefined,
        type: payload.type || 'activity',
        event: payload.event || undefined,
        message: `${participant}: ${payload.message || 'Activity detected'}`,
        penalty,
      });
    }

    // Anchor anti-cheat alerts to the blockchain
    if (global.blockchainActive && payload.type === 'anticheat_violation') {
      anchorEvent(
        roomId,
        'AI_ANTI_CHEAT_ALERT',
        { event: payload.event, participant, message: payload.message, penalty, timestamp: nowTime() },
        room.hostEmail || '',
        ''
      );
    }

    io.to('admins').emit('system-alert', { ...payload, room: roomId, participant });
    emitRoomState(roomId);
    broadcastSessions();
  });

  socket.on('ping-ircp', () => socket.emit('pong-ircp'));

  socket.on('anti-cheat-alert', (data) => {
    const { roomCode, participant, message } = data;
    const room = rooms.get(roomCode);
    if (!room) return;

    pushEvent(roomCode, 'system', `[AI PROCTORING ALERT] ${participant.name}: ${message}`);
    
    anchorEvent(
      roomCode,
      'AI_ANTI_CHEAT_ALERT',
      { participant: participant.name, message, timestamp: nowTime() },
      room.hostEmail || '',
      participant.email || ''
    );
    emitRoomState(roomCode);
  });

  socket.on('permission-violation', (data) => {
    const { roomCode, action, controllerName, controllerEmail } = data;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    pushEvent(roomCode, 'permission', `${controllerName}'s input was blocked (${action})`);
    
    anchorEvent(
      roomCode,
      'PERMISSION_VIOLATION',
      { action, controller: controllerName, timestamp: nowTime() },
      room.hostEmail || '',
      controllerEmail || ''
    );
    emitRoomState(roomCode);
  });

  socket.on('disconnect', async () => {
    if (socket.userEmail) onlineEmails.delete(socket.userEmail);

    rooms.forEach((room, roomId) => {
      const pending = room.pendingControllers.get(socket.id);
      if (pending) {
        room.pendingControllers.delete(socket.id);
        io.to(room.hostSocketId).emit('join-request-cancelled', { controllerId: socket.id });
        pushEvent(roomId, 'join', `${pending.name} cancelled the join request`);
        emitRoomState(roomId);
        broadcastSessions();
      }
      if (room.observers.delete(socket.id) || room.pendingObservers.delete(socket.id)) {
        emitRoomState(roomId);
        broadcastSessions();
      }
    });

    const roomId = socket.roomCode;
    const room = rooms.get(roomId);
    if (!room) return;
    if (socket.role === 'host') {
      await archiveSession(roomId, 'Host disconnected; session closed');
      io.to(roomId).emit('kill-session');
      room.observers.forEach((observerId) => io.to(observerId).emit('kill-session'));
      rooms.delete(roomId);
      broadcastSessions();
      return;
    }
    if (socket.role === 'controller' && room.controllers.has(socket.id)) {
      const participant = room.controllers.get(socket.id);
      participant.leftAt = Date.now();
      room.controllers.delete(socket.id);
      pushEvent(roomId, 'join', `${participant.name} disconnected`);
      anchorEvent(roomId, 'USER_LEFT', { role: 'controller', email: participant.email }, room.hostEmail, participant.email);
      io.to(room.hostSocketId).emit('controller-left', { controllerId: socket.id, controller: participantPayload(participant) });
      emitRoomState(roomId);
      broadcastSessions();
    }
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Let's Collab! signaling server running on port ${PORT}`);
  });
}

module.exports = { app, server, io };
