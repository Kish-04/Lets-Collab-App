const path = require('path');
const crypto = require('crypto');
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
const bcrypt = require('bcrypt');
const { router: adminRoutes, onlineEmails, setRoomLookup, protectAdmin, protectAuthenticated } = require('./adminRoutes');
const User = require('./User');
const Alert = require('./alert');
const SessionLog = require('./sessionLog');
const {
  getActiveChain,
  initBlockchain,
  logToChain,
  queryChain,
  querySessionLogs,
  hashAuditPayload,
  hashIdentity,
  legacyIdentityHash,
  verifyAnchors,
} = require('./blockchainLogger');
const { ethers } = require('ethers');
const { decodeSubmission, recoverSum, applyAggregate } = require('./secureAggregation');
const { buildIceServers } = require('./turn');
const { isUploadPath, requireSignedUpload, signUploadUrl } = require('./uploadAccess');
const auditChain = require('./auditChain');
const rateLimit = require('express-rate-limit');
const { createCorsOptions, ensureServerConfig, verifyJwt } = require('./config');
const mockStore = require('./mockStore');

const app = express();
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});
ensureServerConfig();

const corsOptions = createCorsOptions();
app.use(cors(corsOptions));
app.use(cookieParser());
// Evidence and recordings require a short-lived signed URL (issued to admins only)
app.use('/uploads', requireSignedUpload, express.static(path.join(__dirname, 'uploads'), {
  // Evidence is served from the API origin: never let a browser sniff a file into HTML
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
app.use(express.json({ limit: '2mb' }));

// Serve the statically exported Next.js app (if available)
const nextOutPath = path.join(__dirname, '..', 'out');
const fs = require('fs');
if (fs.existsSync(nextOutPath)) {
  app.use(express.static(nextOutPath));
  // Provide a fallback for Next.js routing
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.url === '/health' || req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
      return next();
    }
    
    const urlPath = req.path.endsWith('/') ? req.path + 'index' : req.path;
    const htmlPath = path.join(nextOutPath, urlPath + '.html');
    const folderIndexPath = path.join(nextOutPath, urlPath, 'index.html');
    
    if (fs.existsSync(htmlPath)) {
      return res.sendFile(htmlPath);
    }
    if (fs.existsSync(folderIndexPath)) {
      return res.sendFile(folderIndexPath);
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

const { GoogleGenerativeAI } = require('@google/generative-ai');
// Each call spends the Gemini quota: signed-in users only, 20 questions per user per minute
const petLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { default: false },
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: { text: 'I need a short break. Ask me again in a minute!' },
});
app.post('/api/pet', protectAuthenticated, petLimiter, async (req, res) => {
  try {
    const { message, imageBase64, codeContext } = req.body;
    const geminiApiKey = process.env.GEMINI_API_KEY || '';
    if (!geminiApiKey) {
      return res.json({ text: "I'm offline! Please add GEMINI_API_KEY to your .env file." });
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
    
    const prompt = `You are an AI Pet Assistant in a remote desktop collaboration app called "Let's Collab".
You are a friendly robot pet without a tail, so do not mention wagging a tail or anything about a tail.
Your goal is to help the Host and Controller debug code or use the app. Keep your answers concise, friendly, and helpful.
IMPORTANT: You MUST start every single answer with a funny robotic sound word like *Beep Bop*, *Bzzzzt*, or *Whirr*. Do not forget this.
The user said: "${message}"${codeContext && codeContext.code ? '\n\nThe user is currently editing this ' + String(codeContext.language || 'code').slice(0, 30) + ' code:\n```\n' + String(codeContext.code).slice(0, 8000) + '\n```' : ''}`;

    if (imageBase64) {
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const result = await model.generateContent([
        prompt,
        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
      ]);
      const response = await result.response;
      return res.json({ text: response.text() });
    }

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return res.json({ text: response.text() });
  } catch (error) {
    console.error("Gemini API Error:", error);
    const errorMsg = String(error.message || error);
    if (errorMsg.includes('401') || errorMsg.includes('invalid authentication credentials')) {
      const casualResponses = [
        "Hmm, I'm having trouble connecting to my central knowledge base right now. But I'm here if you need to test the UI!",
        "My cognitive circuits are offline at the moment due to an API issue, but your interface looks great!",
        "I'd love to help with that, but I'm currently running in limited mode. Everything else is looking good though!"
      ];
      return res.json({ text: casualResponses[Math.floor(Math.random() * casualResponses.length)] });
    }
    return res.json({ text: "API Error: " + errorMsg });
  }
});

app.post('/api/profile', protectAuthenticated, async (req, res) => {
  try {
    const { name, newPassword } = req.body;
    const userEmail = req.user.email;
    if (!userEmail) return res.status(401).json({ success: false, message: 'Not authorized' });

    let updated = false;
    let user = null;

    if (global.dbConnected) {
      user = await User.findOne({ email: userEmail });
      if (user) {
        if (name) user.name = name;
        if (newPassword) user.password = newPassword; // Pre-save hook hashes it
        await user.save();
        updated = true;
      }
    } else {
      const mockStore = require('./mockStore');
      user = mockStore.findUserByEmail(userEmail);
      if (user) {
        if (name) user.name = name;
        if (newPassword) {
          const salt = await bcrypt.genSalt(10);
          user.password = await bcrypt.hash(newPassword, salt);
        }
        mockStore.saveUser(user);
        updated = true;
      }
    }

    if (updated && user) {
      // Notify administrators
      const alertMsg = `User ${user.email} updated their profile information.`;
      
      // Save to Alert History
      if (global.dbConnected) {
        await Alert.create({
          room: 'SYSTEM',
          hostEmail: user.email,
          type: 'system',
          event: 'PROFILE_UPDATED',
          message: alertMsg,
          penalty: 0
        }).catch(err => console.error('Failed to log profile alert', err));
      } else {
        const mockStore = require('./mockStore');
        mockStore.addAlert({
          room: 'SYSTEM',
          hostEmail: user.email,
          type: 'system',
          event: 'PROFILE_UPDATED',
          message: alertMsg,
          penalty: 0
        });
      }

      // Live socket emit
      const socketIo = req.app.get('io');
      if (socketIo) {
        socketIo.to('admins').emit('system-alert', {
          room: 'SYSTEM',
          participant: user.name,
          type: 'system',
          event: 'PROFILE_UPDATED',
          message: alertMsg,
          time: new Date()
        });
      }
    }

    res.json({ success: true, message: 'Profile updated' });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

app.get('/api/sessions/recent', protectAuthenticated, async (req, res) => {
  try {
    const userEmail = req.user.email;
    if (!userEmail) {
      return res.json({ success: true, sessions: [] });
    }

    // 1. Get Live Sessions where user is host or controller
    const liveSessions = [];
    for (const [code, room] of rooms.entries()) {
      let isHost = (room.hostEmail === userEmail);
      let isParticipant = false;
      for (const ctrl of room.controllers.values()) {
        if (ctrl.email === userEmail) isParticipant = true;
      }
      
      if (isHost || isParticipant) {
        liveSessions.push({
          roomCode: code,
          mode: room.mode,
          hostName: room.hostName,
          hostEmail: room.hostEmail,
          status: 'active',
          startedAt: new Date(room.createdAt).toISOString(),
          endedAt: null,
          riskScore: room.riskScore,
          alertCount: room.alertCount,
          latestTxHash: room.latestTxHash,
          isHost
        });
      }
    }

    // 2. Get Ended Sessions
    let pastDocs = [];
    if (global.dbConnected) {
      pastDocs = await SessionLog.find({
        $or: [
          { hostEmail: userEmail },
          { "participants.email": userEmail }
        ]
      }).sort({ endedAt: -1 }).limit(20).lean().catch(() => []);
    } else {
      pastDocs = mockStore.listSessionLogs(100).filter(s => 
        s.hostEmail === userEmail || 
        (s.participants && s.participants.some(p => p.email === userEmail))
      ).slice(0, 20);
    }

    const pastSessions = pastDocs.map(s => ({
      roomCode: s.roomCode,
      mode: s.mode,
      hostName: s.hostName,
      hostEmail: s.hostEmail,
      status: 'ended',
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      riskScore: s.riskScore,
      alertCount: s.alertCount,
      latestTxHash: s.latestTxHash,
      isHost: (s.hostEmail === userEmail)
    }));

    const allSessions = [...liveSessions, ...pastSessions];
    res.json({ success: true, sessions: allSessions });
  } catch (error) {
    console.error('Recent Sessions Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recent sessions' });
  }
});

app.get('/api/sessions/:sessionId/history', protectAdmin, async (req, res) => {
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
        hashMap[hashIdentity(user.email)] = user.email;
        hashMap[legacyIdentityHash(user.email)] = user.email;
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

    res.json({ success: true, logs: resolvedLogs, chain: getActiveChain() });
  } catch (error) {
    console.error('History Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
});

// Recompute every stored audit payload hash and compare it with the on-chain record
app.get('/api/sessions/:sessionId/verify', protectAdmin, async (req, res) => {
  try {
    const sessionId = normalizeRoomCode(req.params.sessionId);
    const liveRoom = rooms.get(sessionId);
    let session = liveRoom || endedSessions.find(s => s.roomCode === sessionId) || null;
    if (!session && global.dbConnected) {
      session = await SessionLog.findOne({ roomCode: sessionId }).sort({ endedAt: -1 }).lean();
    }
    if (!session && !global.dbConnected) {
      session = mockStore.listSessionLogs().find(s => s.roomCode === sessionId) || null;
    }
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    // Signed hash chain: detects edited, removed, reordered or inserted anchors without the blockchain
    const signedChain = auditChain.verifyChain(session.anchors || []);
    if (!global.blockchainActive) {
      return res.json({
        success: true,
        chainActive: false,
        message: 'Blockchain is inactive; the signed audit chain was checked instead.',
        sessionId,
        signedChain,
        intact: signedChain.status !== 'broken',
      });
    }

    const chainLogs = await querySessionLogs(sessionId);
    const report = verifyAnchors(session.anchors || [], chainLogs);

    // The chat transcript and evidence are anchored as one digest when the session is archived
    const archiveResult = [...report.results].reverse().find(r => r.eventType === 'SESSION_ARCHIVED' && r.payload);
    let transcript = { status: 'not_archived' };
    if (archiveResult) {
      const anchored = JSON.parse(archiveResult.payload);
      const current = transcriptDigest(session);
      const matches = anchored.messagesHash === current.messagesHash && anchored.evidenceHash === current.evidenceHash;
      transcript = {
        status: archiveResult.status !== 'verified' ? 'unanchored' : matches ? 'verified' : 'tampered',
        anchored: { messageCount: anchored.messageCount, evidenceCount: anchored.evidenceCount },
        current: { messageCount: current.messageCount, evidenceCount: current.evidenceCount },
      };
    }

    res.json({
      success: true,
      chainActive: true,
      sessionId,
      live: Boolean(liveRoom),
      ...report,
      intact: report.intact && transcript.status !== 'tampered' && signedChain.status !== 'broken',
      signedChain,
      transcript,
    });
  } catch (error) {
    console.error('Verify Error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify session audit trail' });
  }
});

// Public half of the audit signing key, so auditors can verify exported sessions offline
app.get('/api/audit/public-key', (req, res) => {
  res.json({ keyId: auditChain.keyId, algorithm: 'Ed25519', publicKey: auditChain.publicKeyPem, ephemeral: auditChain.ephemeralKey });
});

const turnCredentialLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

app.get('/api/turn/credentials', turnCredentialLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    // Tie ephemeral credentials to the signed-in user when there is one (useful in coturn logs)
    let identity = 'guest';
    const token = req.cookies?.auth_token || String(req.headers.authorization || '').replace(/^Bearers+/i, '');
    if (token) {
      try { identity = String(verifyJwt(token).id || 'guest'); } catch (err) { identity = 'guest'; }
    }

    const configured = buildIceServers(process.env, identity);
    if (configured) return res.json(configured.iceServers);

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

app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Exam voice prompts (3 MB) and recorded voice answers (5 MB) travel as one message; the 1 MB
  // default disconnected the sender instead of delivering them
  maxHttpBufferSize: Number(process.env.SOCKET_MAX_MESSAGE_BYTES || 6 * 1024 * 1024),
});

app.set('io', io);

const PORT = process.env.PORT || 3001;
const rooms = new Map();
const endedSessions = [];
const validPermissions = new Set(['view', 'mouse', 'keyboard', 'full']);
const FEDERATED_MODEL_VERSION = 'anti-cheat-v1';
const MAX_FEDERATED_WEIGHTS = 10000;
// Secure aggregation rounds: participants advertise keys, then submit pairwise-masked updates
const FL_MIN_PARTICIPANTS = Math.max(2, Number(process.env.FL_MIN_PARTICIPANTS) || 3);
const FL_MAX_PARTICIPANTS = 50; // keeps the fixed-point sum well inside int32
const FL_JOIN_WINDOW_MS = Number(process.env.FL_JOIN_WINDOW_MS) || 8000;
const FL_SUBMIT_WINDOW_MS = Number(process.env.FL_SUBMIT_WINDOW_MS) || 20000;
// Shamir threshold: a strict majority of the participants that received shares (same rule as the client)
const flShareThreshold = (count) => Math.max(2, Math.floor(count / 2) + 1);
const FL_ROUND_INTERVAL_MS = Number(process.env.FL_ROUND_INTERVAL_MS) || 5 * 60 * 1000;
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

function pushEvent(roomCode, type, message) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const event = { time: nowTime(), type, message };
  room.events.push(event);
  if (room.events.length > 140) room.events.shift();
  // The host's activity panel shows the room log live; candidates never receive it
  if (room.hostSocketId) io.to(room.hostSocketId).emit('room-event', event);
}

function createFederatedState() {
  return {
    round: 0,
    completedRound: 0,
    globalWeights: null,
    history: [],
    lastAggregate: null,
    active: null,
  };
}

function federatedSummary(room) {
  if (!room.federated) return null;
  return {
    round: room.federated.round,
    completedRound: room.federated.completedRound,
    pendingContributors: room.federated.active ? room.federated.active.participants.size : 0,
    phase: room.federated.active ? room.federated.active.phase : 'idle',
    secureAggregation: true,
    hasGlobalModel: Array.isArray(room.federated.globalWeights),
    lastAggregate: room.federated.lastAggregate,
    history: room.federated.history.slice(-5),
  };
}

// ── Exams ──────────────────────────────────────────────────────────────────────
const EXAM_TYPES = new Set(['freeform', 'mc', 'poll', 'code']);
const clampText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : undefined);

function sanitizeExamQuestion(payload) {
  const id = clampText(payload.id, 100);
  if (!id || !EXAM_TYPES.has(payload.type) || typeof payload.prompt !== 'string' || !payload.prompt.trim()) return null;
  return {
    id,
    type: payload.type,
    prompt: payload.prompt.slice(0, 5000),
    options: Array.isArray(payload.options) ? payload.options.slice(0, 20).map(o => String(o).slice(0, 500)) : undefined,
    language: clampText(payload.language, 40),
    starterCode: clampText(payload.starterCode, 20000),
    voicePrompt: clampText(payload.voicePrompt, 3 * 1024 * 1024),
    answerKey: clampText(payload.answerKey, 2000),
  };
}

// What candidates receive: never the answer key
function publicExamQuestion({ answerKey, ...question }) {
  return question;
}

function sanitizeExamAnswer(answer = {}) {
  return {
    text: clampText(answer.text, 50000),
    options: Array.isArray(answer.options) ? answer.options.slice(0, 20).map(o => String(o).slice(0, 500)) : undefined,
    audio: clampText(answer.audio, 5 * 1024 * 1024),
    output: clampText(answer.output, 20000),
  };
}

/** Server-side grading (the candidate never sees the key); null when the question has no key. */
// Answers are compared exactly after normalising case, whitespace and trailing punctuation; a key may
// list accepted alternatives separated by "|" (e.g. "paris|city of paris"). Substring matching let a
// candidate pass by padding the answer with guesses.
function normalizeExamText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;,]+$/, '').trim();
}

function gradeExamAnswer(question, answer) {
  if (!question.answerKey) return null;
  const accepted = String(question.answerKey).split('|').map(normalizeExamText).filter(Boolean);
  if (accepted.length === 0) return null;
  // Code output is produced in the candidate's browser, so this checks what they report, not a
  // server-side run; the host sees the code itself in the live view
  const given = normalizeExamText(question.type === 'code' ? answer.output : answer.text);
  return accepted.includes(given);
}

// What is kept of an exam when the session is archived: questions with keys and every final answer,
// without bulky voice recordings
function examArchive(room) {
  const answers = {};
  Object.entries(room.exam?.answers || {}).forEach(([questionId, byController]) => {
    answers[questionId] = {};
    Object.entries(byController).forEach(([controllerId, entry]) => {
      const participant = room.controllers.get(controllerId);
      const { audio, ...rest } = entry || {};
      answers[questionId][controllerId] = { ...rest, hadAudio: Boolean(audio), name: participant?.name, email: participant?.email };
    });
  });
  return {
    questions: (room.exam?.questions || []).map(({ voicePrompt, ...question }) => question),
    answers,
  };
}

function examQuestionsFor(room, targetSocket) {
  const questions = room.exam?.questions || [];
  if (targetSocket?.id === room.hostSocketId) return questions;
  return questions
    .filter(q => !room.exam.answers[q.id]?.[targetSocket?.id]?.isFinal)
    .map(publicExamQuestion);
}

// Federated features are three normalised signals in [0, 1]
function sanitizeFeatures(features) {
  if (!Array.isArray(features) || features.length !== 3) return undefined;
  const values = features.map(Number);
  return values.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ? values : undefined;
}

/** An admin judged an alert a false positive: send it back to the device that raised it as a label-0 sample. */
function sendFalsePositiveLabel(alert) {
  if (!alert?.sourceSocketId || !Array.isArray(alert.features) || alert.features.length !== 3) return false;
  const target = io.sockets.sockets.get(alert.sourceSocketId);
  if (!target) return false;
  target.emit('fl-label-correction', { alertId: String(alert._id), features: alert.features, label: 0 });
  return true;
}

function sanitizeWeights(weights) {
  if (!Array.isArray(weights) || weights.length === 0 || weights.length > MAX_FEDERATED_WEIGHTS) return null;
  const sanitized = weights.map(Number);
  return sanitized.every(Number.isFinite) ? sanitized : null;
}
function roomFederatedMembers(room) {
  return [room.hostSocketId, ...Array.from(room.controllers.keys())].filter(Boolean);
}

function getFederatedParticipant(room, socket) {
  if (socket.id === room.hostSocketId) {
    return { id: socket.id, name: room.hostName || 'Host', email: room.hostEmail || '', role: 'host' };
  }
  const controller = room.controllers.get(socket.id);
  if (controller) {
    return { id: socket.id, name: controller.name || 'Controller', email: controller.email || '', role: 'controller' };
  }
  return null;
}

function getRoomParticipant(room, socket, targetControllerId = null) {
  if (!room || !socket) return null;
  if (socket.id === room.hostSocketId) {
    const target = targetControllerId ? room.controllers.get(targetControllerId) : null;
    return target || {
      id: socket.id,
      name: room.hostName || 'Host',
      email: room.hostEmail || '',
      role: 'host',
    };
  }
  const controller = room.controllers.get(socket.id);
  if (controller) return controller;
  if (room.observers.has(socket.id)) {
    return { id: socket.id, name: 'Administrator', email: '', role: 'admin' };
  }
  return null;
}

function clearFederatedRound(room) {
  const active = room?.federated?.active;
  if (active?.timer) clearTimeout(active.timer);
  if (room?.federated) room.federated.active = null;
}

function abortFederatedRound(roomCode, reason) {
  const room = rooms.get(roomCode);
  const active = room?.federated?.active;
  if (!active) return;
  clearFederatedRound(room);
  pushEvent(roomCode, 'system', `Secure federated round ${active.round} aborted: ${reason}`);
  io.to(roomCode).emit('fl-round-aborted', { round: active.round, reason });
  emitRoomState(roomCode);
}

function openFederatedRound(roomCode, openedBy) {
  const room = rooms.get(roomCode);
  if (!room || room.mode !== 'supervised' || room.federated.active) return false;
  room.federated.round += 1;
  const round = room.federated.round;
  room.federated.active = {
    round,
    phase: 'advertise',
    participants: new Map(),
    submissions: new Map(),
    vectorLength: null,
    initWeights: null,
    timer: setTimeout(() => distributeFederatedKeys(roomCode), FL_JOIN_WINDOW_MS),
  };
  pushEvent(roomCode, 'system', `Secure federated round ${round} opened${openedBy ? ` by ${openedBy}` : ''}`);
  io.to(roomCode).emit('fl-round-open', { round, baseRound: room.federated.completedRound });
  emitRoomState(roomCode);
  return true;
}

// Stage 1 -> 2: hand every participant the advertised keys so it can Shamir-share its secrets
function distributeFederatedKeys(roomCode) {
  const room = rooms.get(roomCode);
  const active = room?.federated?.active;
  if (!active || active.phase !== 'advertise') return;
  clearTimeout(active.timer);

  if (active.participants.size < FL_MIN_PARTICIPANTS) {
    abortFederatedRound(roomCode, `needs at least ${FL_MIN_PARTICIPANTS} participants, got ${active.participants.size}`);
    return;
  }
  if (!room.federated.globalWeights && !active.initWeights) {
    abortFederatedRound(roomCode, 'no initial model weights were provided');
    return;
  }

  active.phase = 'sharing';
  active.keyed = new Map(active.participants); // U1: everyone who received the key list
  active.threshold = flShareThreshold(active.keyed.size);
  active.shares = new Map();
  const peers = Array.from(active.keyed.values()).map(({ id, publicKey }) => ({ id, publicKey }));
  active.keyed.forEach(p => io.to(p.id).emit('fl-round-keys', { round: active.round, peers, threshold: active.threshold }));
  active.timer = setTimeout(() => startMaskingStage(roomCode), FL_SUBMIT_WINDOW_MS);
  emitRoomState(roomCode);
}

// Stage 2 -> 3: forward each participant the encrypted shares addressed to it
function startMaskingStage(roomCode) {
  const room = rooms.get(roomCode);
  const active = room?.federated?.active;
  if (!active || active.phase !== 'sharing') return;
  clearTimeout(active.timer);

  const sharers = Array.from(active.shares.keys()); // U2
  if (sharers.length < active.threshold) {
    abortFederatedRound(roomCode, `only ${sharers.length} participant(s) shared keys; ${active.threshold} needed`);
    return;
  }
  active.phase = 'masking';
  active.sharers = new Set(sharers);
  active.submissions = new Map();
  const peers = sharers.map(id => ({ id, publicKey: active.keyed.get(id).publicKey }));
  sharers.forEach((recipient) => {
    const inbox = [];
    active.shares.forEach((list, from) => {
      const share = list.find(item => item.to === recipient);
      if (share) inbox.push({ from, ct: share.ct });
    });
    io.to(recipient).emit('fl-round-masking', { round: active.round, peers, shares: inbox });
  });
  active.timer = setTimeout(() => startUnmaskStage(roomCode), FL_SUBMIT_WINDOW_MS);
  emitRoomState(roomCode);
}

// Stage 3 -> 4: whoever submitted survives; ask survivors for the shares needed to unmask the sum
function startUnmaskStage(roomCode) {
  const room = rooms.get(roomCode);
  const active = room?.federated?.active;
  if (!active || active.phase !== 'masking') return;
  clearTimeout(active.timer);

  const survivors = Array.from(active.submissions.keys()); // U3
  if (survivors.length < active.threshold) {
    abortFederatedRound(roomCode, `only ${survivors.length} participant(s) submitted; ${active.threshold} needed to recover dropouts`);
    return;
  }
  active.phase = 'unmasking';
  active.survivors = survivors;
  active.dropped = Array.from(active.sharers).filter(id => !active.submissions.has(id));
  active.revealed = new Map();
  active.revealers = new Set();
  survivors.forEach(id => io.to(id).emit('fl-unmask', { round: active.round, survivors, dropped: active.dropped }));
  active.timer = setTimeout(() => finalizeFederatedRound(roomCode), FL_SUBMIT_WINDOW_MS);
  emitRoomState(roomCode);
}

// Advances a stage early once every still-connected participant of that stage has acted
function maybeAdvanceFederatedRound(roomCode) {
  const room = rooms.get(roomCode);
  const active = room?.federated?.active;
  if (!active) return;
  const connected = id => io.sockets.sockets.has(id);
  if (active.phase === 'sharing' && Array.from(active.keyed.keys()).filter(connected).every(id => active.shares.has(id))) startMaskingStage(roomCode);
  else if (active.phase === 'masking' && Array.from(active.sharers).filter(connected).every(id => active.submissions.has(id))) startUnmaskStage(roomCode);
  else if (active.phase === 'unmasking' && active.survivors.filter(connected).every(id => active.revealers.has(id))) finalizeFederatedRound(roomCode);
}

function finalizeFederatedRound(roomCode) {
  const room = rooms.get(roomCode);
  const active = room?.federated?.active;
  if (!active) return;

  if (active.phase !== 'unmasking') return;
  clearTimeout(active.timer);
  const base = room.federated.globalWeights || active.initWeights;
  let revealedSum;
  try {
    revealedSum = recoverSum({
      masked: active.submissions,
      dropped: active.dropped,
      publicKeys: new Map(Array.from(active.keyed.values()).map(p => [p.id, p.publicKey])),
      revealed: active.revealed,
      threshold: active.threshold,
      roomId: roomCode,
      round: active.round,
    });
  } catch (err) {
    abortFederatedRound(roomCode, `could not unmask the sum (${err.message})`);
    return;
  }
  const result = applyAggregate(base, revealedSum);
  if (!result) {
    abortFederatedRound(roomCode, 'no training samples were contributed this round');
    return;
  }
  if (!result.weights.every(Number.isFinite)) {
    abortFederatedRound(roomCode, 'aggregate was not finite');
    return;
  }

  const summary = {
    round: active.round,
    contributors: active.survivors.map(id => active.keyed.get(id)).map(p => ({ id: p.id, name: p.name, role: p.role })),
    contributorCount: active.survivors.length,
    droppedCount: active.dropped.length,
    sampleCount: result.totalSamples,
    modelVersion: FEDERATED_MODEL_VERSION,
    modelHash: ethers.id(JSON.stringify(result.weights)),
    secureAggregation: true,
    aggregatedAt: new Date().toISOString(),
  };

  clearFederatedRound(room);
  room.federated.globalWeights = result.weights;
  room.federated.completedRound = summary.round;
  room.federated.lastAggregate = summary;
  room.federated.history.push(summary);
  if (room.federated.history.length > 20) room.federated.history.shift();

  pushEvent(roomCode, 'system', `Secure federated round ${summary.round} aggregated from ${summary.contributorCount} participant(s), ${summary.sampleCount} sample(s)`);
  io.to(roomCode).emit('federated-aggregate', { ...summary, weights: result.weights });
  anchorEvent(roomCode, 'FEDERATED_AGGREGATE', {
    round: summary.round,
    contributorCount: summary.contributorCount,
    sampleCount: summary.sampleCount,
    modelVersion: FEDERATED_MODEL_VERSION,
    modelHash: summary.modelHash,
  }, room.hostEmail || '');
  emitRoomState(roomCode);
  broadcastSessions();
}

// Starts a round in every supervised room that has enough eligible participants
setInterval(() => {
  rooms.forEach((room, roomCode) => {
    if (room.mode !== 'supervised' || room.archived || room.federated.active) return;
    if (roomFederatedMembers(room).length >= FL_MIN_PARTICIPANTS) openFederatedRound(roomCode, 'scheduler');
  });
}, FL_ROUND_INTERVAL_MS).unref();

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
    examQuestions: examQuestionsFor(room, socket),
    evidence: room.evidence.slice(-80),
    federated: federatedSummary(room),
    // Room activity (joins, permissions, alerts, chain anchors) is for the host only
    ...(socket && socket.id === room.hostSocketId ? { events: room.events.slice(-60) } : {}),
  };
}

function roomMemberIds(room) {
  return [
    room.hostSocketId,
    ...Array.from(room.controllers.keys()),
    ...Array.from(room.observers),
  ].filter(Boolean);
}

// End-to-end chat: the server only relays public keys. Broadcasts the roster whenever membership
// changes so the host can hand the group key to newcomers and rotate it when someone leaves.
function broadcastE2ERoster(code, room) {
  if (!room.e2eKeys) room.e2eKeys = new Map();
  const members = new Set(roomMemberIds(room));
  room.e2eKeys.forEach((_, id) => { if (!members.has(id)) room.e2eKeys.delete(id); });
  const roster = Array.from(room.e2eKeys.entries()).map(([id, publicKey]) => ({ id, publicKey }));
  const signature = `${room.hostSocketId}|${roster.map(m => m.id).sort().join(',')}`;
  if (signature === room.e2eRosterSignature) return;
  room.e2eRosterSignature = signature;
  io.to(code).emit('e2e-roster', { hostId: room.hostSocketId, members: roster });
}

function emitRoomState(code) {
  const room = rooms.get(code);
  if (!room) return;
  roomMemberIds(room).forEach((socketId) => {
    const targetSocket = io.sockets.sockets.get(socketId);
    if (targetSocket) targetSocket.emit('session-state', roomState(code, room, targetSocket));
  });
  broadcastE2ERoster(code, room);
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
    evidence: room.evidence.slice(-20).map(item => ({ ...item, url: signUploadUrl(item.url) || undefined })),
    recordings: (room.recordings || []).map(url => signUploadUrl(url)).filter(Boolean),
    messageCount: room.messages.length,
    federated: federatedSummary(room),
    examData: room.exam,
  }));
}

function signSessionEvidence(session) {
  return {
    ...session,
    evidence: (session.evidence || []).map(item => ({ ...item, url: signUploadUrl(item.url) || undefined })),
  };
}

function broadcastSessions() {
  io.to('admins').emit('sessions-update', serializeSessions());
  io.emit('sessions-count', { active: rooms.size });
}

// Canonical digest of the chat transcript and evidence, recomputable from an archived SessionLog
function transcriptDigest(session) {
  const messages = (session.messages || []).map(m => [m.id, m.time, m.senderId, m.senderName, m.role, m.text]);
  const evidence = (session.evidence || []).map(e => [e.id, e.time, e.type, e.by, e.label]);
  return {
    messageCount: messages.length,
    messagesHash: ethers.id(JSON.stringify(messages)),
    evidenceCount: evidence.length,
    evidenceHash: ethers.id(JSON.stringify(evidence)),
  };
}

// Every on-chain anchor is a paid transaction, and several events can be triggered at will by
// clients. Anchors are always recorded off-chain; only the chain write is budgeted. Session
// archive/termination and panic revokes always go on-chain (they are bounded by room creation).
const CHAIN_ALWAYS = new Set(['SESSION_ARCHIVED', 'SESSION_TERMINATED', 'PANIC_REVOKE', 'EVIDENCE_PURGED']);
const CHAIN_NOISY = new Set(['AI_ANTI_CHEAT_ALERT', 'PERMISSION_VIOLATION']);
const CHAIN_NOISY_INTERVAL_MS = Number(process.env.CHAIN_NOISY_INTERVAL_MS || 20000);
const CHAIN_ROOM_WINDOW_MS = 10 * 60 * 1000;
const CHAIN_ROOM_MAX = Number(process.env.CHAIN_MAX_TX_PER_ROOM || 40);
const CHAIN_GLOBAL_MAX_PER_MIN = Number(process.env.CHAIN_MAX_TX_PER_MINUTE || 120);
const chainGlobalWrites = [];

function chainWriteAllowed(room, eventType, now = Date.now()) {
  if (CHAIN_ALWAYS.has(eventType)) return true;
  if (!room.chainBudget) room.chainBudget = { writes: [], lastByType: {} };
  const budget = room.chainBudget;
  if (CHAIN_NOISY.has(eventType) && now - (budget.lastByType[eventType] || 0) < CHAIN_NOISY_INTERVAL_MS) return false;
  budget.writes = budget.writes.filter(at => now - at < CHAIN_ROOM_WINDOW_MS);
  if (budget.writes.length >= CHAIN_ROOM_MAX) return false;
  while (chainGlobalWrites.length && now - chainGlobalWrites[0] >= 60000) chainGlobalWrites.shift();
  if (chainGlobalWrites.length >= CHAIN_GLOBAL_MAX_PER_MIN) return false;
  budget.writes.push(now);
  budget.lastByType[eventType] = now;
  chainGlobalWrites.push(now);
  return true;
}

// How long a dropped host or controller can take to come back before the room or seat is given up
const HOST_RECONNECT_GRACE_MS = Number(process.env.HOST_RECONNECT_GRACE_MS ?? 45000);
const CONTROLLER_RECONNECT_GRACE_MS = Number(process.env.CONTROLLER_RECONNECT_GRACE_MS ?? 45000);

// Deletes local /uploads files behind evidence/recording URLs; never touches anything outside uploads/
function deleteUploadedFiles(urls) {
  const uploadsRoot = path.resolve(__dirname, 'uploads');
  let deleted = 0;
  urls.forEach((url) => {
    const bare = String(url).split('?')[0];
    if (!isUploadPath(bare)) return;
    const target = path.resolve(uploadsRoot, bare.slice('/uploads/'.length));
    if (!target.startsWith(uploadsRoot + path.sep)) return;
    try {
      fs.unlinkSync(target);
      deleted += 1;
    } catch { /* already gone */ }
  });
  return deleted;
}

async function closeRoomAfterHostLeft(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearTimeout(room.hostGraceTimer);
  await archiveSession(roomId, 'Host disconnected; session closed');
  io.to(roomId).emit('kill-session');
  room.observers.forEach((observerId) => io.to(observerId).emit('kill-session'));
  rooms.delete(roomId);
  broadcastSessions();
}

// Exam answers are keyed by socket id; a reconnecting candidate keeps (and stays locked by) its own
function moveExamAnswers(room, fromId, toId) {
  if (!fromId || fromId === toId) return;
  Object.values(room.exam?.answers || {}).forEach((byController) => {
    if (!byController[fromId]) return;
    byController[toId] = byController[fromId];
    delete byController[fromId];
  });
}

// Each new room gets its own chain budget and a ROOM_CREATED anchor, so creation itself is capped
const ROOM_CREATE_WINDOW_MS = 10 * 60 * 1000;
const ROOM_CREATE_MAX = Number(process.env.MAX_ROOMS_PER_USER_PER_10_MIN || 10);
const roomCreations = new Map();

function roomCreationAllowed(userKey, now = Date.now()) {
  const recent = (roomCreations.get(userKey) || []).filter(at => now - at < ROOM_CREATE_WINDOW_MS);
  if (recent.length >= ROOM_CREATE_MAX) {
    roomCreations.set(userKey, recent);
    return false;
  }
  recent.push(now);
  roomCreations.set(userKey, recent);
  return true;
}

function anchorEvent(code, eventType, data, hostEmail = '', controllerEmail = '') {
  const room = rooms.get(code);
  if (!room) return;

  // Keyed hash so emails on the public chain cannot be recovered by dictionary lookup
  const hashedHost = hashIdentity(hostEmail);
  const hashedController = hashIdentity(controllerEmail);

  // Keep the exact hashed payload off-chain so auditors can recompute and compare it later
  const { payload, dataHash } = hashAuditPayload(data);
  const anchor = { eventType, payload, dataHash, txHash: null, createdAt: new Date().toISOString() };
  auditChain.appendToChain(room.anchors, anchor); // hash-linked and signed, independent of the chain write
  room.anchors.push(anchor);

  if (!chainWriteAllowed(room, eventType)) {
    anchor.chainSkipped = 'rate_limited'; // still covered by the SESSION_ARCHIVED digest
    return;
  }

  logToChain(code, hashedHost, hashedController, eventType, payload)
    .then((txHash) => {
      if (txHash && !String(txHash).startsWith('[OFF-CHAIN-MOCK]')) anchor.txHash = txHash;
      const liveRoom = rooms.get(code);
      if (!liveRoom || !txHash) return;
      liveRoom.latestTxHash = txHash;
      pushEvent(code, 'chain', `Audit anchored: ${String(txHash).slice(0, 18)}...`);
      io.to(code).emit('chain-log', {
        type: eventType.toLowerCase(),
        hash: txHash,
        timestamp: nowTime(),
      });
      io.to('admins').emit('chain-log', {
        roomId: code,
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
  anchorEvent(roomCode, 'SESSION_ARCHIVED', { reason, ...transcriptDigest(room) }, room.hostEmail || '');
  clearFederatedRound(room);
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
    anchors: room.anchors,
    federated: federatedSummary(room),
    examData: room.mode === 'supervised' ? examArchive(room) : undefined,
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
    if (participant.email) room.recentControllers?.delete(participant.email); // a removed controller must ask again
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

// Admin viewing a controller's camera. The admin socket remembers which controller it asked for,
// and every relayed offer/answer/candidate is checked against that pairing.
function adminObservesController(adminId, controllerId) {
  const adminSocket = io.sockets.sockets.get(adminId);
  const target = adminSocket?.observingController;
  if (!target || target.controllerId !== controllerId) return false;
  return Boolean(rooms.get(target.roomId)?.controllers.has(controllerId));
}

function endControllerObservation(adminSocket) {
  const target = adminSocket.observingController;
  if (!target) return;
  adminSocket.observingController = null;
  io.to(target.controllerId).emit('controller-observation-ended', { adminId: adminSocket.id });
}

// Socket.IO runs listeners without a try/catch, so one malformed event (a missing or null payload
// that a handler destructures) would throw and take the whole process down. Registered before any
// other connection handler so every listener below is wrapped.
function guardSocketListener(socket, event, listener) {
  return (...args) => {
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

// Role swaps need a request from one side and an answer from the other: remember who asked whom
const ROLE_SWAP_TTL_MS = 2 * 60 * 1000;
function rememberRoleSwap(room, requesterId, responderId) {
  if (!room.roleSwapRequests) room.roleSwapRequests = new Map();
  room.roleSwapRequests.set(`${requesterId}>${responderId}`, Date.now() + ROLE_SWAP_TTL_MS);
}
function takeRoleSwap(room, requesterId, responderId) {
  const key = `${requesterId}>${responderId}`;
  const expiresAt = room.roleSwapRequests?.get(key);
  if (!expiresAt) return false;
  room.roleSwapRequests.delete(key);
  return expiresAt > Date.now();
}

io.on('connection', (socket) => {
  const on = socket.on.bind(socket);
  socket.on = (event, listener) => on(event, guardSocketListener(socket, event, listener));
});

io.on('connection', (socket) => {
  socket.on('request-controller-observation', async ({ roomId, targetId } = {}) => {
    if (!await isAdminSocket(socket)) return;
    const roomCode = normalizeRoomCode(roomId);
    const room = rooms.get(roomCode);
    if (!room || !room.controllers.has(targetId)) {
      socket.emit('admin-error', 'That participant is no longer in the session.');
      return;
    }
    // Camera observation follows the supervised-room policy; collaboration rooms need consent
    if (room.mode !== 'supervised') {
      socket.emit('admin-error', 'Participant camera observation is only available in supervised rooms.');
      return;
    }
    endControllerObservation(socket);
    socket.observingController = { roomId: roomCode, controllerId: targetId };
    pushEvent(roomCode, 'permission', `Administrator is viewing ${room.controllers.get(targetId).name}'s camera`);
    io.to(targetId).emit('controller-observation-requested', { adminId: socket.id });
    emitRoomState(roomCode);
  });

  socket.on('end-controller-observation', () => endControllerObservation(socket));

  socket.on('controller-observation-offer', ({ adminId, offer } = {}) => {
    if (!adminObservesController(adminId, socket.id)) return;
    io.to(adminId).emit('observer-offer', { offer, hostId: socket.id, targetType: 'controller' });
  });

  socket.on('controller-observation-ice-candidate', ({ adminId, candidate } = {}) => {
    if (!adminObservesController(adminId, socket.id)) return;
    io.to(adminId).emit('observer-ice-candidate', { candidate, fromId: socket.id });
  });

  socket.on('controller-observation-unavailable', ({ adminId, reason } = {}) => {
    if (!adminObservesController(adminId, socket.id)) return;
    io.to(adminId).emit('admin-error', reason || 'The participant has no camera stream to share.');
  });

  socket.on('disconnect', () => endControllerObservation(socket));
});


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
  const isGamepad = payload.type === 'gamepad-state';
  if (isKeyboard && isClipboardShortcut(payload) && !participant.clipboardAllowed) return false;
  return participant.permission === 'full'
    || (participant.permission === 'mouse' && (isMouse || isGamepad))
    || (participant.permission === 'keyboard' && isKeyboard);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  console.log('Handshake Summary:', {
    origin: socket.handshake.headers.origin || 'unknown',
    userAgent: socket.handshake.headers['user-agent'] || 'unknown',
  });
  isAdminSocket(socket).then((admin) => {
    if (admin) socket.join('admins');
  });

  // Online status comes from the signed-in account, never from an email the client names
  socket.on('identify-user', async () => {
    const actor = await authenticatedUser(socket);
    if (!actor?.email) return;
    socket.userEmail = actor.email;
    onlineEmails.add(actor.email);
  });

  socket.on('create-room', async (meta = {}) => {
    console.log(`[Socket] create-room requested by socket: ${socket.id}`, meta);
    let actor = await authenticatedUser(socket);
    
    if (!actor) {
      socket.emit('session-error', { message: 'Authentication required. Please sign in again before creating a room.' });
      return;
    }
    if (!roomCreationAllowed(String(actor._id || actor.email))) {
      socket.emit('session-error', { message: 'Too many rooms created. Please wait a few minutes and try again.' });
      return;
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
      anchors: [],
      events: [],
      messages: [],
      evidence: [],
      federated: createFederatedState(),
      exam: { questions: [], answers: {} },
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
      socket.emit('session-history', docs.map(signSessionEvidence));
    } else {
      socket.emit('session-history', mockStore.listSessionLogs(100).map(signSessionEvidence));
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
      socket.emit('join-denied', { reason: 'Authentication required. Please sign in before joining a room.' });
      return;
    }
    const normalizedRoomId = normalizeRoomCode(roomId);
    const room = rooms.get(normalizedRoomId);
    if (!room || (role !== 'controller' && role !== 'admin')) {
      socket.emit('room-not-found', { roomId });
      return;
    }
    
    if (role === 'admin') {
      if (!await isAdminSocket(socket)) {
        socket.emit('join-denied', { reason: 'Administrator privileges required.' });
        return;
      }
      // Collaboration rooms need the host's consent, exactly like request-observation; only
      // supervised rooms (where monitoring is announced) let an administrator in directly
      if (room.mode !== 'supervised') {
        socket.observingRoom = normalizedRoomId;
        room.pendingObservers.add(socket.id);
        io.to(room.hostSocketId).emit('admin-observation-request', { observerId: socket.id });
        socket.emit('observation-pending', { message: 'Waiting for host approval.' });
        pushEvent(normalizedRoomId, 'system', 'Administrator asked to observe the session');
        return;
      }
      room.observers.add(socket.id);
      socket.join(normalizedRoomId);
      socket.roomCode = normalizedRoomId;
      socket.role = 'admin';
      pushEvent(normalizedRoomId, 'system', 'Administrator joined the supervised session as an observer');
      socket.emit('session-state', roomState(normalizedRoomId, room, socket));
      emitRoomState(normalizedRoomId);
      return;
    }
    if (room.hostEmail && actor.email === room.hostEmail) {
      socket.emit('join-denied', { reason: 'The host cannot join their own room as a controller.' });
      return;
    }
    if (room.controllers.has(socket.id)) {
      socket.emit('session-state', roomState(normalizedRoomId, room, socket));
      return;
    }

    const pending = buildPendingController(socket, actor, meta);
    room.pendingControllers.set(socket.id, pending);
    socket.pendingRoomCode = normalizedRoomId;
    socket.role = 'pending-controller';
    socket.userEmail = pending.email;

    // The same account coming back after a dropped connection keeps its approval and permission
    const returning = actor.email && room.recentControllers?.get(actor.email);
    if (returning && returning.expiresAt > Date.now()) {
      room.recentControllers.delete(actor.email);
      moveExamAnswers(room, returning.socketId, socket.id);
      pushEvent(normalizedRoomId, 'join', `${pending.name} reconnected`);
      activateController(normalizedRoomId, socket.id, returning.permission, { clipboardAllowed: returning.clipboardAllowed });
      return;
    }
    socket.emit('join-pending', {
      roomCode: normalizedRoomId,
      mode: room.mode,
      message: 'Waiting for host approval before the screen opens.',
    });
    io.to(room.hostSocketId).emit('connection-request', pendingPayload(pending));
    pushEvent(normalizedRoomId, 'join', `${pending.name} requested to join`);
    emitRoomState(normalizedRoomId);
    broadcastSessions();
  });

  socket.on('respond-join', async ({ controllerId, approved, permission = 'view', options = {} } = {}, roomId) => {
    const normalizedRoomId = normalizeRoomCode(roomId);
    const room = rooms.get(normalizedRoomId);
    if (!room || socket.id !== room.hostSocketId) return;
    const pending = room.pendingControllers.get(controllerId);
    if (!pending) return;
    if (!approved) {
      room.pendingControllers.delete(controllerId);
      io.to(controllerId).emit('join-denied', { reason: 'Host denied the connection request.' });
      pushEvent(normalizedRoomId, 'permission', `${pending.name} was denied before screen access`);
      emitRoomState(normalizedRoomId);
      broadcastSessions();
      return;
    }
    activateController(normalizedRoomId, controllerId, permission, options);
  });

  socket.on('request-role-swap', ({ targetId, roomId }) => {
    const normalizedRoomId = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(normalizedRoomId);
    if (!room) return;
    
    // Host requesting controller
    if (socket.id === room.hostSocketId && room.controllers.has(targetId)) {
      rememberRoleSwap(room, socket.id, targetId);
      io.to(targetId).emit('role-swap-requested', { fromId: socket.id, fromName: room.hostName });
      pushEvent(normalizedRoomId, 'system', `Host requested role swap with controller`);
    }
    // Controller requesting host
    else if (room.controllers.has(socket.id) && (!targetId || targetId === room.hostSocketId)) {
      const controller = room.controllers.get(socket.id);
      rememberRoleSwap(room, socket.id, room.hostSocketId);
      io.to(room.hostSocketId).emit('role-swap-requested', { fromId: socket.id, fromName: controller.name });
      pushEvent(normalizedRoomId, 'system', `${controller.name} requested to become host`);
    }
  });

  socket.on('accept-role-swap', ({ targetId, roomId }) => {
    const normalizedRoomId = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(normalizedRoomId);
    if (!room) return;

    let newHostId, oldHostId, newHostParticipant;

    // A swap only happens when the other side actually asked for it
    if (socket.id === room.hostSocketId && room.controllers.has(targetId) && takeRoleSwap(room, targetId, socket.id)) {
      // Host accepts controller's request
      oldHostId = socket.id;
      newHostId = targetId;
      newHostParticipant = room.controllers.get(targetId);
    } else if (room.controllers.has(socket.id) && (!targetId || targetId === room.hostSocketId) && takeRoleSwap(room, room.hostSocketId, socket.id)) {
      // Controller accepts host's request
      newHostId = socket.id;
      oldHostId = room.hostSocketId;
      newHostParticipant = room.controllers.get(socket.id);
    } else {
      return;
    }
    room.roleSwapRequests.clear(); // roles changed, so every other pending request is stale

    const oldHostName = room.hostName;
    const oldHostEmail = room.hostEmail;

    // Create participant entry for the old host
    const oldHostParticipant = {
      id: oldHostId,
      name: oldHostName,
      email: oldHostEmail,
      initials: initials(oldHostName),
      role: 'controller',
      permission: 'full', // Give old host full permission by default
      clipboardAllowed: true,
      joinedAt: Date.now(),
      quality: room.hostQuality || { latency: null, fps: null, packetLoss: null, health: 'unknown' },
    };

    // Update room
    room.hostSocketId = newHostId;
    room.hostName = newHostParticipant.name;
    room.hostEmail = newHostParticipant.email;

    room.controllers.delete(newHostId);
    room.controllers.set(oldHostId, oldHostParticipant);

    // Update socket roles
    const newHostSocket = io.sockets.sockets.get(newHostId);
    if (newHostSocket) newHostSocket.role = 'host';
    const oldHostSocket = io.sockets.sockets.get(oldHostId);
    if (oldHostSocket) oldHostSocket.role = 'controller';

    pushEvent(normalizedRoomId, 'system', `Role swap completed: ${room.hostName} is now the host`);
    
    io.to(normalizedRoomId).emit('role-swap-completed', {
      newHostId,
      oldHostId,
      roomState: roomState(normalizedRoomId, room)
    });
    
    emitRoomState(normalizedRoomId);
    broadcastSessions();
  });

  socket.on('reject-role-swap', ({ requesterId, roomId }) => {
    const room = rooms.get(normalizeRoomCode(roomId || socket.roomCode));
    if (!room || !takeRoleSwap(room, requesterId, socket.id)) return;
    io.to(requesterId).emit('role-swap-rejected');
  });

  socket.on('offer', (payload, maybeRoomId) => {
    const data = payload && payload.offer ? payload : { offer: payload, roomId: maybeRoomId };
    const room = rooms.get(data.roomId || socket.roomCode);
    if (!room || !data.offer) return;
    
    if (socket.id === room.hostSocketId) {
      const targets = data.targetId ? [data.targetId] : Array.from(room.controllers.keys());
      targets.forEach((targetId) => {
        if (room.controllers.has(targetId)) io.to(targetId).emit('offer', {
          offer: data.offer,
          fromId: socket.id,
          roomId: data.roomId || socket.roomCode,
          mediaStreamIds: data.mediaStreamIds || null,
        });
      });
    } else if (room.controllers.has(socket.id)) {
      io.to(room.hostSocketId).emit('offer', {
        offer: data.offer,
        fromId: socket.id,
        roomId: data.roomId || socket.roomCode,
        mediaStreamIds: data.mediaStreamIds || null,
      });
    }
  });

  socket.on('answer', (payload, maybeRoomId) => {
    const data = payload && payload.answer ? payload : { answer: payload, roomId: maybeRoomId };
    const room = rooms.get(data.roomId || socket.roomCode);
    if (!room || !data.answer) return;
    
    if (socket.id === room.hostSocketId) {
      if (data.targetId && room.controllers.has(data.targetId)) {
        io.to(data.targetId).emit('answer', {
          answer: data.answer,
          fromId: socket.id,
          roomId: data.roomId || socket.roomCode,
          mediaStreamIds: data.mediaStreamIds || null,
        });
      }
    } else if (room.controllers.has(socket.id)) {
      io.to(room.hostSocketId).emit('answer', {
        answer: data.answer,
        fromId: socket.id,
        roomId: data.roomId || socket.roomCode,
        mediaStreamIds: data.mediaStreamIds || null,
      });
    }
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
    const roomId = normalizeRoomCode(payload.room || socket.roomCode);
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
    const normalizedRoomId = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(normalizedRoomId);
    const participant = room?.controllers.get(socket.id);
    if (!room || !participant) return;
    pushEvent(normalizedRoomId, 'permission', `Access requested by ${participant.name}`);
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
    const normalizedRoomId = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(normalizedRoomId);
    if (!room || !validPermissions.has(permission) || !await canModerate(socket, room)) return;
    const targets = options.targetId ? [options.targetId] : Array.from(room.controllers.keys());
    const updatesDefault = !options.targetId;
    if (!targets.length && updatesDefault) room.defaultPermission = permission;
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
    if (updatesDefault) room.defaultPermission = permission;
    // Host pressed the emergency shortcut: tell controllers why control vanished
    const isPanic = options.reason === 'panic' && permission === 'view';
    if (isPanic) targets.forEach(targetId => io.to(targetId).emit('system-warning', 'The host revoked all remote control. You are now in View Only mode.'));
    pushEvent(normalizedRoomId, 'permission', isPanic
      ? 'PANIC: host revoked all remote control (every controller set to VIEW)'
      : `Access changed to ${String(permission).toUpperCase()}${options.targetId ? ' for one controller' : ' for all controllers'}`);
    emitRoomState(normalizedRoomId);
    const targetParticipant = options.targetId ? room.controllers.get(options.targetId) : null;
    const targetEmail = targetParticipant ? targetParticipant.email : '';
    anchorEvent(normalizedRoomId, isPanic ? 'PANIC_REVOKE' : 'ACCESS_CHANGED', { permission, targetId: options.targetId || null, ...(isPanic ? { reason: 'panic' } : {}) }, room.hostEmail, targetEmail);
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

  socket.on('e2e-announce', ({ roomId, publicKey } = {}) => {
    const roomCode = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(roomCode);
    if (!room || !roomMemberIds(room).includes(socket.id)) return;
    if (typeof publicKey !== 'string' || publicKey.length < 80 || publicKey.length > 120) return;
    if (!room.e2eKeys) room.e2eKeys = new Map();
    room.e2eKeys.set(socket.id, publicKey);
    room.e2eRosterSignature = null; // force a fresh roster so the host re-shares keys
    broadcastE2ERoster(roomCode, room);
  });

  // Only the host distributes the (wrapped) group key, and only to current room members
  socket.on('e2e-key-share', ({ roomId, targetId, payload } = {}) => {
    const roomCode = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId || !roomMemberIds(room).includes(targetId)) return;
    if (!payload || typeof payload !== 'object' || JSON.stringify(payload).length > 64 * 1024) return;
    io.to(targetId).emit('e2e-key-share', { fromId: socket.id, payload });
  });

  // A member that is missing a key (e.g. after reloading) asks the host to re-share
  socket.on('e2e-key-request', ({ roomId } = {}) => {
    const roomCode = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(roomCode);
    if (!room || !roomMemberIds(room).includes(socket.id)) return;
    io.to(room.hostSocketId).emit('e2e-key-request', { memberId: socket.id });
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
      // End-to-end ciphertext ("e2e1:...") is ~1.4x the plaintext; never truncate it (that breaks decryption)
      text: text.startsWith('e2e1:') ? text.slice(0, 4096) : text.trim().slice(0, 1000),
    };
    if (message.text.startsWith('e2e1:') && text.length > 4096) return;
    room.messages.push(message);
    if (room.messages.length > 150) room.messages.shift();
    // The server cannot read encrypted chat, so the activity log only records that a message was sent
    pushEvent(roomId || socket.roomCode, 'chat', message.text.startsWith('e2e1:')
      ? `${message.senderName}: [end-to-end encrypted message]`
      : `${message.senderName}: ${message.text.slice(0, 80)}`);
    io.to(roomId || socket.roomCode).emit('chat-message', message);
    broadcastSessions();
  });

  const federatedContext = (roomId) => {
    const roomCode = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(roomCode);
    if (!room || room.mode !== 'supervised') return { error: 'Federated learning only runs in live supervised rooms.' };
    const participant = getFederatedParticipant(room, socket);
    if (!participant) return { error: 'Only the host or approved controllers can take part in federated rounds.' };
    return { roomCode, room, participant };
  };

  socket.on('fl-round-start', ({ roomId } = {}) => {
    const { error, roomCode, room, participant } = federatedContext(roomId);
    if (error) return socket.emit('federated-error', { message: error });
    if (room.federated.active) return socket.emit('federated-error', { message: `Round ${room.federated.active.round} is already running.` });
    openFederatedRound(roomCode, participant.name);
  });

  // Late joiners and peers whose model fell behind fetch the current global model
  socket.on('fl-sync-request', ({ roomId } = {}) => {
    const { error, room } = federatedContext(roomId);
    if (error || !room.federated.globalWeights) return;
    socket.emit('fl-model-sync', { round: room.federated.completedRound, weights: room.federated.globalWeights });
  });

  socket.on('fl-join', ({ roomId, round, publicKey, vectorLength, baseRound, initWeights } = {}) => {
    const { error, roomCode, room, participant } = federatedContext(roomId);
    if (error) return socket.emit('federated-error', { message: error });
    const active = room.federated.active;
    if (!active || active.phase !== 'advertise' || active.round !== round) return;

    if (baseRound !== room.federated.completedRound) {
      if (room.federated.globalWeights) {
        socket.emit('fl-model-sync', { round: room.federated.completedRound, weights: room.federated.globalWeights });
      }
      return socket.emit('federated-error', { message: 'Local model was out of date; synced to the latest global model. Join the next round.' });
    }
    if (typeof publicKey !== 'string' || publicKey.length < 40 || publicKey.length > 200) {
      return socket.emit('federated-error', { message: 'Invalid round public key.' });
    }
    const length = Number(vectorLength);
    if (!Number.isInteger(length) || length < 2 || length > MAX_FEDERATED_WEIGHTS + 1) {
      return socket.emit('federated-error', { message: 'Invalid model update size.' });
    }
    if (room.federated.globalWeights && room.federated.globalWeights.length !== length - 1) {
      return socket.emit('federated-error', { message: 'Model shape does not match the room model.' });
    }
    if (active.vectorLength && active.vectorLength !== length) {
      return socket.emit('federated-error', { message: 'Model shape does not match other participants.' });
    }
    if (active.participants.size >= FL_MAX_PARTICIPANTS) {
      return socket.emit('federated-error', { message: 'Round is full.' });
    }

    // The deterministic initial model is public (seeded), so it can be sent in the clear
    if (!room.federated.globalWeights && !active.initWeights) {
      const init = sanitizeWeights(initWeights);
      if (init && init.length === length - 1) active.initWeights = init;
    }

    active.vectorLength = length;
    active.participants.set(socket.id, { id: socket.id, name: participant.name, role: participant.role, publicKey });
    socket.emit('federated-update-accepted', { roomId: roomCode, round: active.round, pendingContributors: active.participants.size });

    if (active.participants.size === roomFederatedMembers(room).length) distributeFederatedKeys(roomCode);
    else emitRoomState(roomCode);
  });

  socket.on('fl-shares', ({ roomId, round, shares } = {}) => {
    const { error, roomCode, room } = federatedContext(roomId);
    if (error) return;
    const active = room.federated.active;
    if (!active || active.phase !== 'sharing' || active.round !== round || !active.keyed.has(socket.id)) return;
    const valid = Array.isArray(shares) && shares.length === active.keyed.size
      && shares.every(item => item && active.keyed.has(item.to) && typeof item.ct === 'string' && item.ct.length < 2048)
      && new Set(shares.map(item => item.to)).size === shares.length;
    if (!valid) return socket.emit('federated-error', { message: 'Malformed key shares; you will be treated as dropped this round.' });
    active.shares.set(socket.id, shares);
    maybeAdvanceFederatedRound(roomCode);
  });

  socket.on('fl-submit', ({ roomId, round, masked } = {}) => {
    const { error, roomCode, room } = federatedContext(roomId);
    if (error) return;
    const active = room.federated.active;
    if (!active || active.phase !== 'masking' || active.round !== round || !active.sharers.has(socket.id)) return;
    const vector = decodeSubmission(masked, active.vectorLength);
    if (!vector) return socket.emit('federated-error', { message: 'Malformed masked update; you will be treated as dropped this round.' });
    active.submissions.set(socket.id, vector);
    maybeAdvanceFederatedRound(roomCode);
  });

  socket.on('fl-unmask-shares', ({ roomId, round, shares } = {}) => {
    const { error, roomCode, room } = federatedContext(roomId);
    if (error) return;
    const active = room.federated.active;
    if (!active || active.phase !== 'unmasking' || active.round !== round || !active.survivors.includes(socket.id)) return;
    if (active.revealers.has(socket.id) || !Array.isArray(shares)) return;
    active.revealers.add(socket.id);
    shares.forEach((share) => {
      if (!share || typeof share.y !== 'string' || !Number.isInteger(share.x)) return;
      // Only accept the kind each participant is entitled to: b for survivors, s for dropped
      const expected = active.survivors.includes(share.owner) ? 'b' : active.dropped.includes(share.owner) ? 's' : null;
      if (!expected || share.kind !== expected) return;
      if (!active.revealed.has(share.owner)) active.revealed.set(share.owner, { kind: expected, shares: [] });
      const entry = active.revealed.get(share.owner);
      if (!entry.shares.some(item => item.x === share.x)) entry.shares.push({ x: share.x, y: share.y });
    });
    maybeAdvanceFederatedRound(roomCode);
  });

  socket.on('quality-update', ({ roomId, quality = {} } = {}) => {
    const normalizedRoomId = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(normalizedRoomId);
    if (!room) return;
    const participant = getRoomParticipant(room, socket);
    if (!participant || participant.role === 'admin') return;
    const safeQuality = {
      latency: Number.isFinite(quality.latency) ? quality.latency : null,
      fps: Number.isFinite(quality.fps) ? quality.fps : null,
      packetLoss: Number.isFinite(quality.packetLoss) ? quality.packetLoss : null,
      health: ['excellent', 'good', 'fair', 'poor', 'unknown'].includes(quality.health) ? quality.health : 'unknown',
    };
    if (socket.id === room.hostSocketId) room.hostQuality = safeQuality;
    if (participant.role === 'controller') participant.quality = safeQuality;
    io.to('admins').emit('quality-update', { roomId: normalizedRoomId, socketId: socket.id, quality: safeQuality });
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

  socket.on('admin-warn-user', async ({ roomId, message = "Warning from administrator: Please return your attention to the session." }) => {
    const room = rooms.get(roomId);
    if (!room || !await isAdminSocket(socket)) return;
    io.to(roomId).emit('system-warning', message);
    pushEvent(roomId, 'warning', `Administrator warning: ${message}`);
    const targetEmail = room.hostEmail || '';
    anchorEvent(roomId, 'ADMIN_WARNING', { by: 'admin', message }, room.hostEmail, targetEmail);
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
      return;
    }
    // Answer to a controller camera offer ("hostId" is the controller that made the offer)
    if (adminObservesController(socket.id, hostId)) {
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
      return;
    }
    if (adminObservesController(socket.id, targetId)) {
      io.to(targetId).emit('observer-ice-candidate', { fromId: socket.id, candidate });
    }
  });

  socket.on('system-alert', (payload = {}) => {
    const roomId = normalizeRoomCode(payload.room || socket.roomCode);
    const room = rooms.get(roomId);
    if (!room || room.mode !== 'supervised') return;
    const participant = getRoomParticipant(room, socket);
    if (!participant || participant.role === 'admin') return;
    const participantName = participant.name || (participant.role === 'host' ? 'Host' : 'Controller');
    const penalty = applyRiskPenalty(room, payload.penalty, 0);
    room.alertCount += 1;
    pushEvent(roomId, payload.type === 'anticheat_violation' ? 'anticheat' : 'system', `${participantName}: ${payload.message || 'Activity detected'}`);
    const alertRecord = {
      room: roomId,
      hostEmail: room.hostEmail || undefined,
      type: payload.type || 'activity',
      event: payload.event || undefined,
      message: `${participantName}: ${payload.message || 'Activity detected'}`,
      evidenceUrl: isUploadPath(payload.evidenceUrl) ? payload.evidenceUrl : undefined,
      penalty,
      features: sanitizeFeatures(payload.features),
      sourceSocketId: socket.id,
    };
    // Admins need the stored id so a live alert can be marked (e.g. false positive) right away
    const saved = global.dbConnected
      ? Alert.create(alertRecord).catch((err) => { console.error('Alert save error:', err); return null; })
      : Promise.resolve(mockStore.addAlert(alertRecord));

    // Anchor anti-cheat alerts to the blockchain
    if (global.blockchainActive && payload.type === 'anticheat_violation') {
      anchorEvent(
        roomId,
        'AI_ANTI_CHEAT_ALERT',
        { event: payload.event, participant: participantName, message: payload.message, penalty, timestamp: nowTime() },
        room.hostEmail || '',
        participant.email || ''
      );
    }

    saved.then((doc) => {
      io.to('admins').emit('system-alert', {
        ...payload,
        _id: doc?._id ? String(doc._id) : undefined,
        room: roomId,
        participant: participantName,
        evidenceUrl: signUploadUrl(payload.evidenceUrl) || undefined,
        penalty,
      });
    });
    emitRoomState(roomId);
    broadcastSessions();
  });

  socket.on('ping-ircp', () => socket.emit('pong-ircp'));

  const handleAntiCheatAlert = (data = {}) => {
    const roomCode = normalizeRoomCode(data.roomCode || data.roomId || socket.roomCode);
    const room = rooms.get(roomCode);
    if (!room || room.mode !== 'supervised') return;

    const participant = getRoomParticipant(room, socket, data.controllerId);
    if (!participant) return;

    const message = data.message || data.reason || 'AI proctoring alert detected';
    const penalty = applyRiskPenalty(room, data.penalty, 15);
    room.alertCount += 1;

    pushEvent(roomCode, 'anticheat', `[AI PROCTORING ALERT] ${participant.name}: ${message}`);

    const alertDoc = {
      room: roomCode,
      hostEmail: room.hostEmail || undefined,
      type: data.type || 'anticheat_violation',
      event: data.event || data.reason || undefined,
      message: `${participant.name}: ${message}`,
      evidenceUrl: isUploadPath(data.evidenceUrl) ? data.evidenceUrl : undefined,
      penalty,
    };
    if (global.dbConnected) {
      Alert.create(alertDoc).catch((err) => console.error('Alert save error:', err));
    } else {
      mockStore.addAlert(alertDoc);
    }

    anchorEvent(
      roomCode,
      'AI_ANTI_CHEAT_ALERT',
      { participant: participant.name, message, timestamp: nowTime() },
      room.hostEmail || '',
      participant.email || ''
    );
    io.to('admins').emit('system-alert', {
      room: roomCode,
      participant: participant.name,
      type: alertDoc.type,
      event: alertDoc.event,
      message,
      evidenceUrl: signUploadUrl(alertDoc.evidenceUrl) || undefined,
      penalty,
    });
    emitRoomState(roomCode);
    broadcastSessions();
  };

  socket.on('anti-cheat-alert', handleAntiCheatAlert);

  socket.on('permission-violation', (data) => {
    const { action } = data || {};
    const roomCode = normalizeRoomCode(data?.roomCode || data?.roomId || socket.roomCode);
    const room = rooms.get(roomCode);
    if (!room || socket.id !== room.hostSocketId) return;
    const participant = data?.controllerId
      ? room.controllers.get(data.controllerId)
      : Array.from(room.controllers.values()).find(candidate => (
        (data?.controllerEmail && candidate.email === data.controllerEmail)
        || (data?.controllerName && candidate.name === data.controllerName)
      ));
    if (!participant) return;
    
    pushEvent(roomCode, 'permission', `${participant.name}'s input was blocked (${action || 'unknown action'})`);
    
    anchorEvent(
      roomCode,
      'PERMISSION_VIOLATION',
      { action: action || 'unknown action', controller: participant.name, timestamp: nowTime() },
      room.hostEmail || '',
      participant.email || ''
    );
    emitRoomState(roomCode);
  });

  // --- Exam Content ---
  socket.on('host-push-question', (payload = {}) => {
    const roomId = normalizeRoomCode(payload.roomId || socket.roomCode);
    const room = rooms.get(roomId);
    if (!room || room.mode !== 'supervised' || socket.id !== room.hostSocketId) return;
    const question = sanitizeExamQuestion(payload);
    if (!question || room.exam.questions.some(q => q.id === question.id)) return;

    room.exam.questions.push(question);
    room.controllers.forEach((controller, controllerId) => {
      io.to(controllerId).emit('new-exam-question', publicExamQuestion(question));
    });
    pushEvent(roomId, 'exam', `New ${question.type} question pushed to controllers`);
    emitRoomState(roomId);
  });

  socket.on('controller-draft-answer', ({ questionId, answer, roomId }) => {
    const normalizedRoomId = normalizeRoomCode(roomId || socket.roomCode);
    const room = rooms.get(normalizedRoomId);
    if (!room || room.mode !== 'supervised' || socket.role !== 'controller') return;
    // Only a candidate of this room may write drafts into its exam
    if (!room.controllers.has(socket.id)) return;
    if (!room.exam.questions.some(q => q.id === questionId)) return;

    if (!room.exam.answers[questionId]) room.exam.answers[questionId] = {};
    if (room.exam.answers[questionId][socket.id]?.isFinal) return;

    room.exam.answers[questionId][socket.id] = {
      ...sanitizeExamAnswer(answer),
      isFinal: false,
      timestamp: Date.now()
    };
    
    io.to(room.hostSocketId).emit('host-live-answer-update', {
      questionId,
      controllerId: socket.id,
      controllerName: room.controllers.get(socket.id)?.name || 'Unknown',
      answer: room.exam.answers[questionId][socket.id]
    });
  });

  socket.on('controller-submit-answer', ({ questionId, answer } = {}) => {
    const roomId = socket.roomCode;
    const room = rooms.get(roomId);
    if (!room || room.mode !== 'supervised' || socket.role !== 'controller') return;
    const question = room.exam.questions.find(q => q.id === questionId);
    if (!question) return;

    if (!room.exam.answers[questionId]) room.exam.answers[questionId] = {};
    if (room.exam.answers[questionId][socket.id]?.isFinal) return;

    const finalAnswer = sanitizeExamAnswer(answer);
    const correct = gradeExamAnswer(question, finalAnswer);
    room.exam.answers[questionId][socket.id] = {
      ...finalAnswer,
      isFinal: true,
      correct,
      timestamp: Date.now()
    };
    if (correct !== null) socket.emit('exam-answer-result', { questionId, correct });

    io.to(room.hostSocketId).emit('host-live-answer-update', {
      questionId,
      controllerId: socket.id,
      controllerName: room.controllers.get(socket.id)?.name || 'Unknown',
      answer: room.exam.answers[questionId][socket.id]
    });
  });

  socket.on('leave-session', () => {
    socket.leftOnPurpose = true; // leaving on purpose skips the reconnect grace period
    socket.disconnect(true);
  });

  // A host whose connection dropped takes its room back within the grace period
  socket.on('resume-host', async ({ roomId } = {}) => {
    const roomCode = normalizeRoomCode(roomId);
    const room = rooms.get(roomCode);
    const actor = await authenticatedUser(socket);
    if (!room || !room.hostDisconnectedAt || !actor?.email || actor.email !== room.hostEmail) {
      socket.emit('resume-failed', { reason: 'The session ended while you were disconnected.' });
      return;
    }
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = null;
    room.hostDisconnectedAt = null;
    room.hostSocketId = socket.id;
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.role = 'host';
    socket.userEmail = room.hostEmail;
    onlineEmails.add(room.hostEmail);
    pushEvent(roomCode, 'system', 'Host reconnected');
    socket.emit('room-created', { roomCode });
    emitRoomState(roomCode); // new host id: the E2E roster changes, so chat keys are re-shared
    // Rebuild the call with every controller that is still here
    room.controllers.forEach((_, controllerId) => socket.emit('controller-joined', { controllerId }));
    io.to(roomCode).emit('host-resumed');
    broadcastSessions();
  });

  socket.on('recording-uploaded', ({ room, url } = {}) => {
    const liveRoom = rooms.get(normalizeRoomCode(room));
    // Only participants of the room may attach recordings, and only files we stored ourselves
    const isMember = liveRoom && (socket.id === liveRoom.hostSocketId || liveRoom.controllers.has(socket.id));
    if (isMember && isUploadPath(url)) {
      if (!liveRoom.recordings) liveRoom.recordings = [];
      liveRoom.recordings.push(url);
      broadcastSessions();
    }
  });

  // "Code Black": an administrator purges a room's recordings and evidence. It must be confirmed with
  // the room code and a reason, deletes the stored files (not just the references), and is itself
  // anchored on the audit chain (who, why, how many items, digest of what was removed).
  socket.on('secret-delete-recordings', async ({ roomId, reason, confirmCode } = {}) => {
    if (!(await isAdminSocket(socket))) return;
    const roomCode = normalizeRoomCode(roomId);
    const why = String(reason || '').trim().slice(0, 300);
    if (!roomCode || normalizeRoomCode(confirmCode) !== roomCode || why.length < 5) {
      socket.emit('admin-error', 'Evidence purge refused: confirm with the room code and give a reason (at least 5 characters).');
      return;
    }
    const actor = await authenticatedUser(socket);
    const removed = [];
    const liveRoom = rooms.get(roomCode);
    if (liveRoom) {
      removed.push(...(liveRoom.recordings || []), ...(liveRoom.evidence || []).map(item => item?.url));
      liveRoom.recordings = [];
      liveRoom.evidence = [];
    }
    if (global.dbConnected) {
      const logs = await SessionLog.find({ roomCode }).lean().catch(() => []);
      logs.forEach(log => removed.push(...(log.evidence || []).map(item => item?.url), ...(log.recordings || [])));
      await SessionLog.updateMany({ roomCode }, { $set: { evidence: [] } }).catch(err => console.error('[CODE BLACK]', err.message));
    } else {
      removed.push(...mockStore.purgeSessionEvidence(roomCode));
    }

    const urls = Array.from(new Set(removed.filter(url => typeof url === 'string' && url)));
    const filesDeleted = deleteUploadedFiles(urls);
    const record = {
      room: roomCode,
      reason: why,
      items: urls.length,
      filesDeleted,
      itemsDigest: crypto.createHash('sha256').update(urls.sort().join('\n')).digest('hex'),
    };
    if (liveRoom) {
      pushEvent(roomCode, 'system', `Administrator purged ${urls.length} evidence item(s): ${why}`);
      anchorEvent(roomCode, 'EVIDENCE_PURGED', record, liveRoom.hostEmail, actor?.email || '');
    } else {
      const { payload } = hashAuditPayload(record);
      logToChain(roomCode, hashIdentity(''), hashIdentity(actor?.email || ''), 'EVIDENCE_PURGED', payload)
        .catch(err => console.error('[AUDIT]', err.message));
    }
    console.warn(`[CODE BLACK] ${actor?.email || 'admin'} purged ${urls.length} item(s) for ${roomCode}: ${why}`);
    socket.emit('admin-action-complete', { message: `Purged ${urls.length} evidence item(s) (${filesDeleted} file(s) deleted). The purge is recorded on the audit chain.` });
    broadcastSessions();
  });

  socket.on('disconnect', async () => {
    // Still online while the same account has another connection open
    if (socket.userEmail && !Array.from(io.sockets.sockets.values()).some(other => other.id !== socket.id && other.userEmail === socket.userEmail)) {
      onlineEmails.delete(socket.userEmail);
    }

    rooms.forEach((room, roomId) => {
      // Before keys are handed out a leaver is simply removed; later it is treated as dropped and its
      // masks are recovered from the other participants' Shamir shares
      const flRound = room.federated?.active;
      if (flRound?.participants.has(socket.id)) {
        if (flRound.phase === 'advertise') flRound.participants.delete(socket.id);
        else setImmediate(() => maybeAdvanceFederatedRound(roomId));
      }

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
    if (socket.role === 'host' && room.hostSocketId === socket.id) {
      // A network blip should not end everyone's session: hold the room for the host to resume
      if (socket.leftOnPurpose || HOST_RECONNECT_GRACE_MS <= 0) {
        await closeRoomAfterHostLeft(roomId);
        return;
      }
      clearTimeout(room.hostGraceTimer);
      room.hostDisconnectedAt = Date.now();
      room.hostGraceTimer = setTimeout(() => { void closeRoomAfterHostLeft(roomId); }, HOST_RECONNECT_GRACE_MS);
      room.hostGraceTimer.unref?.();
      pushEvent(roomId, 'system', `Host connection lost; holding the session for ${Math.round(HOST_RECONNECT_GRACE_MS / 1000)} s`);
      io.to(roomId).emit('host-reconnecting', { graceMs: HOST_RECONNECT_GRACE_MS });
      broadcastSessions();
      return;
    }
    if (socket.role === 'controller' && room.controllers.has(socket.id)) {
      const participant = room.controllers.get(socket.id);
      participant.leftAt = Date.now();
      room.controllers.delete(socket.id);
      if (participant.email && !socket.leftOnPurpose && CONTROLLER_RECONNECT_GRACE_MS > 0) {
        if (!room.recentControllers) room.recentControllers = new Map();
        room.recentControllers.set(participant.email, {
          socketId: socket.id,
          permission: participant.permission,
          clipboardAllowed: participant.clipboardAllowed,
          expiresAt: Date.now() + CONTROLLER_RECONNECT_GRACE_MS,
        });
      }
      pushEvent(roomId, 'join', `${participant.name} disconnected`);
      anchorEvent(roomId, 'USER_LEFT', { role: 'controller', email: participant.email }, room.hostEmail, participant.email);
      io.to(room.hostSocketId).emit('controller-left', { controllerId: socket.id, controller: participantPayload(participant) });
      emitRoomState(roomId);
      broadcastSessions();
    }
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Let's Collab! signaling server running on port ${PORT}`);
  });
}

module.exports = { app, server, io, sendFalsePositiveLabel };
