// Face ID: enrolment and the identity check at the start of a supervised exam.
//
// The browser computes a 128-number face descriptor on the device (lib/faceMatch.ts); no image is
// ever uploaded. The server keeps the enrolled descriptor and compares it with the live one, so the
// decision and its log are not left to the candidate's own device.
//
//   GET    /api/face/status            { enrolled, enrolledAt }
//   POST   /api/face/enroll            { descriptor }            once per account (an admin can reset)
//   POST   /api/face/verify            { descriptor, room }      result goes to the room's host
//   DELETE /api/face/enrollment/:userId                          admin: lets the user enrol again
const express = require('express');
const User = require('./User');
const mockStore = require('./mockStore');
const { protectAuthenticated, protectAdmin } = require('./adminRoutes');

const router = express.Router();

const DESCRIPTOR_LENGTH = 128;
// Same person usually < 0.4; keep in sync with FACE_MATCH_THRESHOLD in lib/faceMatch.ts
const MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.5);

function validDescriptor(value) {
  return Array.isArray(value)
    && value.length === DESCRIPTOR_LENGTH
    && value.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 2);
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

async function loadUser(id) {
  return global.dbConnected ? User.findById(id) : mockStore.findUserById(id);
}

async function saveUser(user) {
  if (global.dbConnected) await user.save();
  else mockStore.saveUser(user);
}

const enrolled = (user) => Array.isArray(user && user.faceDescriptor) && user.faceDescriptor.length === DESCRIPTOR_LENGTH;

router.get('/status', protectAuthenticated, (req, res) => {
  res.json({ success: true, enrolled: enrolled(req.user), enrolledAt: req.user.faceEnrolledAt || null });
});

router.post('/enroll', protectAuthenticated, async (req, res) => {
  try {
    const descriptor = req.body && req.body.descriptor;
    if (!validDescriptor(descriptor)) return res.status(400).json({ success: false, message: 'Invalid face descriptor.' });
    const user = await loadUser(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
    // Re-enrolling would let someone else replace the reference face; an admin reset is required
    if (enrolled(user)) return res.status(409).json({ success: false, message: 'Face ID is already set up. Ask an administrator to reset it.' });
    user.faceDescriptor = descriptor.map(v => Math.round(v * 1e6) / 1e6);
    user.faceEnrolledAt = new Date().toISOString();
    await saveUser(user);
    res.json({ success: true, enrolled: true, enrolledAt: user.faceEnrolledAt });
  } catch (err) {
    console.error('[face] enroll:', err.message);
    res.status(500).json({ success: false, message: 'Could not save your face ID.' });
  }
});

router.post('/verify', protectAuthenticated, async (req, res) => {
  try {
    const descriptor = req.body && req.body.descriptor;
    if (!validDescriptor(descriptor)) return res.status(400).json({ success: false, message: 'Invalid face descriptor.' });
    const user = await loadUser(req.user._id);
    const room = String((req.body && req.body.room) || '').trim().toUpperCase();
    let result;
    if (!enrolled(user)) {
      result = { status: 'not_enrolled' };
    } else {
      const d = distance(descriptor, user.faceDescriptor);
      result = { status: d <= MATCH_THRESHOLD ? 'verified' : 'mismatch', distance: Math.round(d * 1000) / 1000 };
    }
    const reported = room ? await require('./index').reportFaceCheck(room, req.user, result) : false;
    res.json({ success: true, ...result, reported });
  } catch (err) {
    console.error('[face] verify:', err.message);
    res.status(500).json({ success: false, message: 'Could not check your face ID.' });
  }
});

router.delete('/enrollment/:userId', protectAdmin, async (req, res) => {
  try {
    const user = await loadUser(req.params.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    user.faceDescriptor = undefined;
    user.faceEnrolledAt = undefined;
    await saveUser(user);
    res.json({ success: true, message: 'Face ID reset; the user can enrol again.' });
  } catch (err) {
    console.error('[face] reset:', err.message);
    res.status(500).json({ success: false, message: 'Could not reset face ID.' });
  }
});

module.exports = router;
module.exports.MATCH_THRESHOLD = MATCH_THRESHOLD;
