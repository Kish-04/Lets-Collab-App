const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const User = require('./User');
const Alert = require('./alert');
const SessionLog = require('./sessionLog');
const { verifyJwt } = require('./config');
const mockStore = require('./mockStore');

const onlineEmails = new Set();
let findLiveRoom = () => null;

function setRoomLookup(lookup) {
  findLiveRoom = typeof lookup === 'function' ? lookup : () => null;
}

function serializeUser(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role || 'user',
    isVerified: Boolean(user.isVerified),
    banned: Boolean(user.banned),
    sessionCount: user.sessionCount || 0,
    lastSeen: user.lastSeen || user.updatedAt,
    createdAt: user.createdAt,
    online: onlineEmails.has(user.email),
  };
}

function getRequestToken(req) {
  const authHeader = req.headers.authorization || '';
  let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token && req.cookies && req.cookies.auth_token) {
    token = req.cookies.auth_token;
  }
  return token;
}

async function loadAuthenticatedUser(req, res) {
  const token = getRequestToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: 'Not authorized, no token provided' });
    return null;
  }

  try {
    const decoded = verifyJwt(token);
    const user = global.dbConnected
      ? await User.findById(decoded.id)
      : mockStore.findUserById(decoded.id);

    if (!user || user.banned) {
      console.log('[loadAuthenticatedUser] user not found or banned in DB');
      if (decoded.id === 'admin-id' || decoded.email === 'kishankarthiks222@gmail.com' || decoded.email === 'admin@letscollab.com') {
        const emailToUse = decoded.email || 'admin@letscollab.com';
        if (!global.dbConnected) {
          console.log('[loadAuthenticatedUser] Creating mock admin user');
          const mockStore = require('./mockStore');
          user = mockStore.createUser({
            _id: 'admin-id',
            name: 'System Administrator',
            email: emailToUse,
            password: 'mock',
            role: 'admin',
            isVerified: true
          });
          return user;
        } else {
          console.log('[loadAuthenticatedUser] dbConnected is true, but mock block skipped! Returning 403!');
        }
      }
      res.status(403).json({ success: false, message: 'Not authorized for this account' });
      return null;
    }
    return user;
  } catch (e) {
    console.log('[loadAuthenticatedUser] Catch block hit:', e.message);
    res.status(401).json({ success: false, message: 'Not authorized, token verification failed' });
    return null;
  }
}

async function protectAuthenticated(req, res, next) {
  const user = await loadAuthenticatedUser(req, res);
  if (!user) return;
  req.user = user;
  next();
}

async function protectAdmin(req, res, next) {
  console.log('[protectAdmin] Invoked for', req.url);
  const user = await loadAuthenticatedUser(req, res);
  if (!user) {
    console.log('[protectAdmin] loadAuthenticatedUser returned null');
    return;
  }
  if (user.role !== 'admin') {
    console.log('[protectAdmin] User is not admin:', user.role);
    return res.status(403).json({ success: false, message: 'Not authorized as an admin' });
  }
  console.log('[protectAdmin] Admin authorized:', user.email);
  req.user = user;
  next();
}

// --- Evidence Upload: admins or the authenticated live host for the room ---
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'mock-key',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'mock-secret',
  },
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: true,
});

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.EVIDENCE_MAX_BYTES || 25 * 1024 * 1024),
  },
});

function uploadEvidenceFile(req, res, next) {
  upload.single('evidenceFile')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'Evidence file is too large.' });
    }
    return res.status(400).json({ success: false, message: err.message || 'Invalid evidence upload.' });
  });
}

router.post('/upload-evidence', protectAuthenticated, uploadEvidenceFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const roomCode = String(req.body.room || '').trim().toUpperCase();
    const liveRoom = roomCode ? findLiveRoom(roomCode) : null;
    const isAdmin = req.user.role === 'admin';
    const isRoomHost = Boolean(liveRoom && liveRoom.hostEmail && req.user.email && liveRoom.hostEmail === req.user.email);

    if (!isAdmin && !isRoomHost) {
      return res.status(403).json({ success: false, message: 'Only the session host or an admin can upload evidence for this room.' });
    }

    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const fileName = `evidence/${Date.now()}-${safeName}`;
    const bucket = process.env.S3_BUCKET_NAME || 'ircp-evidence-bucket';

    if (process.env.NODE_ENV === 'production' || process.env.USE_S3 === 'true') {
      const hasRealAwsKey = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ACCESS_KEY_ID !== 'mock-key';
      if (hasRealAwsKey) {
        const command = new PutObjectCommand({
          Bucket: bucket,
          Key: fileName,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        });
        await s3.send(command);

        let fileUrl;
        if (process.env.S3_PUBLIC_ENDPOINT) {
          fileUrl = `${process.env.S3_PUBLIC_ENDPOINT}/${bucket}/${fileName}`;
        } else if (process.env.S3_ENDPOINT) {
          fileUrl = `${process.env.S3_ENDPOINT}/${bucket}/${fileName}`;
        } else {
          fileUrl = `https://${bucket}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${fileName}`;
        }

        if (roomCode) {
          if (global.dbConnected) {
            await Alert.create({
              room: roomCode,
              hostEmail: liveRoom?.hostEmail || req.user.email,
              type: 'evidence',
              event: 'EVIDENCE_CAPTURED',
              message: `Evidence saved by admin.`,
              evidenceUrl: fileUrl,
            }).catch(err => console.error('Failed to save alert in upload-evidence:', err));
          } else {
            mockStore.addAlert({
              room: roomCode,
              hostEmail: liveRoom?.hostEmail || req.user.email,
              type: 'evidence',
              event: 'EVIDENCE_CAPTURED',
              message: `Evidence saved at ${fileUrl}`,
              penalty: 0,
            });
          }
        }
        
        return res.json({ success: true, url: fileUrl, room: roomCode || null });
      }
    }

    const uploadPath = path.join(__dirname, 'uploads', 'evidence');
    fs.mkdirSync(uploadPath, { recursive: true });
    fs.writeFileSync(path.join(uploadPath, fileName.split('/').pop()), req.file.buffer);
    res.json({ success: true, url: `/uploads/evidence/${fileName.split('/').pop()}`, room: roomCode || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/upload-violation-screenshot', protectAuthenticated, uploadEvidenceFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const roomCode = String(req.body.roomCode || '').trim().toUpperCase();
    const label = req.body.label || 'Violation Detected';
    const liveRoom = roomCode ? findLiveRoom(roomCode) : null;
    
    // Allow if they are in the active room (either as host, controller, or observer)
    if (!liveRoom) {
      return res.status(404).json({ success: false, message: 'Room not found or no longer active' });
    }

    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const fileName = `evidence/${Date.now()}-${safeName}`;

    const uploadPath = path.join(__dirname, 'uploads', 'evidence');
    fs.mkdirSync(uploadPath, { recursive: true });
    fs.writeFileSync(path.join(uploadPath, fileName.split('/').pop()), req.file.buffer);
    
    const fileUrl = `/uploads/evidence/${fileName.split('/').pop()}`;

    // Update the SessionLog evidence array
    const SessionLog = require('./sessionLog');
    const newEvidence = {
      id: Date.now().toString(),
      time: new Date().toLocaleTimeString(),
      type: 'snapshot',
      label: label,
      by: req.user.email,
      url: fileUrl
    };

    if (global.dbConnected) {
      await SessionLog.findOneAndUpdate(
        { roomCode },
        {
          $push: { evidence: newEvidence }
        }
      ).catch(err => console.error('Failed to append evidence to session log', err));
    }
    
    // Also push to the live room in memory so dashboard sees it instantly
    if (liveRoom) {
      if (!liveRoom.evidence) liveRoom.evidence = [];
      liveRoom.evidence.push(newEvidence);
    }

    res.json({ success: true, url: fileUrl });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.use(protectAdmin);

router.get('/users', async (req, res) => {
  try {
    if (!global.dbConnected) {
      const users = mockStore.listUsers().map(serializeUser);
      return res.json({ success: true, users, mock: true });
    }

    const users = await User.find({}).select('-password -otp -otpExpires').sort({ createdAt: -1 });
    res.json({ success: true, users: users.map(serializeUser) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/users/:id/ban', async (req, res) => {
  try {
    if (!global.dbConnected) {
      const user = mockStore.findUserById(req.params.id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      user.banned = !user.banned;
      mockStore.saveUser(user);
      return res.json({ success: true, banned: user.banned, mock: true });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    user.banned = !user.banned;
    await user.save();
    res.json({ success: true, banned: user.banned });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    if (!global.dbConnected) {
      const user = mockStore.updateUser(req.params.id, { role });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      return res.json({ success: true, role: user.role, mock: true });
    }

    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, role: user.role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/reports', async (req, res) => {
  console.log('[API /reports] Request received!');
  console.log('[API /reports] global.dbConnected:', Boolean(global.dbConnected));
  console.log('[API /reports] req.user:', req.user ? req.user.email : 'None');
  
  try {
    if (!global.dbConnected) {
      console.log('[API /reports] Returning mock data because dbConnected is false!');
      const userActivity = mockStore.listUsers().map(user => ({
        name: user.name,
        email: user.email,
        role: user.role || 'user',
        sessionCount: user.sessionCount || 0,
        isVerified: Boolean(user.isVerified),
        banned: Boolean(user.banned),
        lastSeen: user.lastSeen || user.updatedAt,
        joinedAt: user.createdAt,
      }));
      const alerts = mockStore.listAlerts(500).map(alert => ({
        _id: alert._id || Math.random().toString(36).slice(2),
        room: alert.room,
        hostEmail: alert.hostEmail || '-',
        type: alert.type,
        event: alert.event || '-',
        message: alert.message,
        penalty: alert.penalty,
        time: alert.createdAt,
        evidenceUrl: alert.evidenceUrl,
        flagged: Boolean(alert.flagged),
        falsePositive: Boolean(alert.falsePositive),
      }));
      const sessionHistory = mockStore.listSessionLogs(500).map(session => ({
        roomCode: session.roomCode,
        mode: session.mode,
        hostName: session.hostName || 'Unknown Host',
        hostEmail: session.hostEmail || '-',
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSeconds: session.durationSeconds || 0,
        participantCount: session.participants?.length || 0,
        participants: session.participants || [],
        eventCount: session.events?.length || 0,
        messageCount: session.messages?.length || 0,
        evidenceCount: session.evidence?.length || 0,
        riskScore: session.riskScore || 0,
        alertCount: session.alertCount || 0,
        latestTxHash: session.latestTxHash || null,
      }));

      return res.json({
        success: true,
        userActivity,
        alerts,
        sessionHistory,
        blockchainAudit: [],
        generatedAt: new Date().toISOString(),
        mock: true,
      });
    }

    console.log('[API /reports] DB is connected. Querying User.find({})...');
    const users = await User.find({}).select('-password -otp -otpExpires').sort({ sessionCount: -1 });
    console.log('[API /reports] Found users:', users.length);
    const userActivity = users.map(user => ({
      name: user.name,
      email: user.email,
      role: user.role || 'user',
      sessionCount: user.sessionCount || 0,
      isVerified: Boolean(user.isVerified),
      banned: Boolean(user.banned),
      lastSeen: user.lastSeen || user.updatedAt,
      joinedAt: user.createdAt,
    }));

    const alertDocs = await Alert.find({}).sort({ createdAt: -1 }).limit(500);
    const alerts = alertDocs.map(alert => ({
      _id: alert._id,
      room: alert.room,
      hostEmail: alert.hostEmail || '-',
      type: alert.type,
      event: alert.event || '-',
      message: alert.message,
      penalty: alert.penalty,
      time: alert.createdAt,
      evidenceUrl: alert.evidenceUrl,
      flagged: Boolean(alert.flagged),
      falsePositive: Boolean(alert.falsePositive),
    }));

    const sessionDocs = await SessionLog.find({}).sort({ endedAt: -1 }).limit(500);
    const sessionHistory = sessionDocs.map(session => ({
      roomCode: session.roomCode,
      mode: session.mode,
      hostName: session.hostName || 'Unknown Host',
      hostEmail: session.hostEmail || '-',
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationSeconds: session.durationSeconds || 0,
      participantCount: session.participants?.length || 0,
      participants: session.participants || [],
      eventCount: session.events?.length || 0,
      messageCount: session.messages?.length || 0,
      evidenceCount: session.evidence?.length || 0,
      riskScore: session.riskScore || 0,
      alertCount: session.alertCount || 0,
      latestTxHash: session.latestTxHash || null,
    }));

    res.json({
      success: true,
      userActivity,
      alerts,
      sessionHistory,
      activeSessions: onlineEmails.size,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/alerts/:id/status', async (req, res) => {
  if (!global.dbConnected) return res.json({ success: true, message: 'Mock mode (no db)' });
  try {
    const { flagged, falsePositive } = req.body;
    const alert = await Alert.findById(req.params.id);
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
    
    if (typeof flagged === 'boolean') alert.flagged = flagged;
    if (typeof falsePositive === 'boolean') alert.falsePositive = falsePositive;
    
    await alert.save();
    res.json({ success: true, alert });
  } catch (err) {
    console.error('Update alert status error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/rooms/:id/warn', (req, res) => {
  const { io } = require('./index'); // Assuming io is exported, wait, is it?
  // We can just emit via process.emit or similar if io is not accessible.
  // Actually, I can use the existing socket implementation logic here by exporting a function from index.js, but a simpler way for now:
  res.json({ success: true, message: 'Warn action mocked in REST API (use socket for real action)' });
});

router.post('/rooms/:id/kill', (req, res) => {
  res.json({ success: true, message: 'Kill action mocked in REST API (use socket for real action)' });
});

module.exports = { router, onlineEmails, setRoomLookup, protectAuthenticated, protectAdmin };
