// Visitor feedback from the landing page.
//
//   Anyone  POST  /api/feedback        { name, email, role?, rating?, problem, improvement?, contactOk? }
//   Admin   GET   /api/feedback        newest first, with counts and the average rating
//   Admin   PATCH /api/feedback/:id    { status: 'new' | 'read' | 'planned' | 'done' }
const express = require('express');
const rateLimit = require('express-rate-limit');
const Feedback = require('./feedback');
const mockStore = require('./mockStore');
const { protectAdmin } = require('./adminRoutes');
const { verifyJwt } = require('./config');

const router = express.Router();

const ROLES = new Set(['student', 'teacher', 'examiner', 'developer', 'business', 'other']);
const STATUSES = new Set(['new', 'read', 'planned', 'done']);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const cleanText = (value, max) => (typeof value === 'string' ? value.replace(/\s+\n/g, '\n').trim().slice(0, max) : '');

// The form is public: a few submissions per visitor per hour is plenty, and stops scripted floods
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Thanks! You have sent several responses already. Please try again in an hour.' },
});

// Signed-in visitors are linked to their account; anyone else is fine too
function optionalUserId(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return undefined;
  try {
    const decoded = verifyJwt(header.slice(7));
    return decoded?.id ? String(decoded.id) : undefined;
  } catch {
    return undefined;
  }
}

router.post('/', submitLimiter, async (req, res) => {
  const body = req.body || {};
  // Hidden field real people never fill in
  if (cleanText(body.website, 200)) return res.json({ success: true });

  const entry = {
    name: cleanText(body.name, 80),
    email: cleanText(body.email, 254).toLowerCase(),
    role: ROLES.has(body.role) ? body.role : 'other',
    rating: Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : undefined,
    problem: cleanText(body.problem, 2000),
    improvement: cleanText(body.improvement, 2000),
    contactOk: body.contactOk === true,
    userId: optionalUserId(req),
    status: 'new',
  };

  if (entry.name.length < 2) return res.status(400).json({ success: false, message: 'Please enter your name.' });
  if (!EMAIL.test(entry.email)) return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  if (entry.problem.length < 10) return res.status(400).json({ success: false, message: 'Please describe the problem in a few more words (at least 10 characters).' });

  try {
    if (global.dbConnected) await Feedback.create(entry);
    else mockStore.addFeedback(entry);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[FEEDBACK]', err.message);
    res.status(500).json({ success: false, message: 'Could not save your feedback. Please try again.' });
  }
});

router.get('/', protectAdmin, async (req, res) => {
  try {
    const items = global.dbConnected
      ? await Feedback.find({}).sort({ createdAt: -1 }).limit(500).lean()
      : mockStore.listFeedback(500);
    const rated = items.filter(item => item.rating);
    res.json({
      success: true,
      items,
      total: items.length,
      unread: items.filter(item => item.status === 'new').length,
      averageRating: rated.length ? Math.round((rated.reduce((sum, item) => sum + item.rating, 0) / rated.length) * 10) / 10 : null,
    });
  } catch (err) {
    console.error('[FEEDBACK]', err.message);
    res.status(500).json({ success: false, message: 'Could not load feedback' });
  }
});

router.patch('/:id', protectAdmin, async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.has(status)) return res.status(400).json({ success: false, message: 'Unknown status' });
  try {
    const item = global.dbConnected
      ? await Feedback.findByIdAndUpdate(req.params.id, { status }, { new: true }).lean().catch(() => null)
      : mockStore.updateFeedback(req.params.id, { status });
    if (!item) return res.status(404).json({ success: false, message: 'Feedback not found' });
    res.json({ success: true, item });
  } catch (err) {
    console.error('[FEEDBACK]', err.message);
    res.status(500).json({ success: false, message: 'Could not update feedback' });
  }
});

module.exports = router;
