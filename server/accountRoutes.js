// Account-level HTTP routes that do not touch live rooms: the AI pet, profile changes, the audit
// signing key and TURN credentials. Mounted at the root, so the paths are the full /api/... paths.
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const User = require('./User');
const mockStore = require('./mockStore');
const auditChain = require('./auditChain');
const { verifyJwt } = require('./config');
const { buildIceServers, stunOnly } = require('./turn');
const { protectAuthenticated } = require('./adminRoutes');

const router = express.Router();

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
router.post('/api/pet', protectAuthenticated, petLimiter, async (req, res) => {
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

router.post('/api/profile', protectAuthenticated, async (req, res) => {
  try {
    const { newPassword, currentPassword } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    const userEmail = req.user.email;
    if (!userEmail) return res.status(401).json({ success: false, message: 'Not authorized' });
    if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 8)) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    let updated = false;
    let user = global.dbConnected
      ? await User.findOne({ email: userEmail })
      : mockStore.findUserByEmail(userEmail);

    // A session token alone must not be enough to take over the account
    if (user && newPassword) {
      const matches = typeof currentPassword === 'string' && currentPassword.length > 0 && (global.dbConnected
        ? await user.matchPassword(currentPassword)
        : await bcrypt.compare(currentPassword, user.password || ''));
      if (!matches) {
        return res.status(403).json({ success: false, message: 'Current password is incorrect. If you signed up with Google or GitHub, use "Forgot password" to set one.' });
      }
    }

    if (global.dbConnected) {
      if (user) {
        if (name) user.name = name;
        if (newPassword) user.password = newPassword; // Pre-save hook hashes it
        await user.save();
        updated = true;
      }
    } else {
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

// Public half of the audit signing key, so auditors can verify exported sessions offline
router.get('/api/audit/public-key', (req, res) => {
  res.json({ keyId: auditChain.keyId, algorithm: 'Ed25519', publicKey: auditChain.publicKeyPem, ephemeral: auditChain.ephemeralKey });
});

const turnCredentialLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.get('/api/turn/credentials', turnCredentialLimiter, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    // Relay credentials cost bandwidth and last for hours, so only signed-in users get them (tied to
    // the account in coturn logs); anyone else gets public STUN servers
    const header = String(req.headers.authorization || '');
    const token = /^Bearer\s+\S+/i.test(header) ? header.replace(/^Bearer\s+/i, '') : req.cookies?.auth_token;
    let identity = null;
    if (token) {
      try { identity = String(verifyJwt(token).id || '') || null; } catch { identity = null; }
    }
    if (!identity) return res.json(stunOnly());

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

module.exports = router;
