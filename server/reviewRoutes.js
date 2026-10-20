// Human review of proctoring alerts, and student appeals.
//
//   Candidate  GET  /api/reviews/mine                    alerts raised about my account, with their review state
//   Candidate  POST /api/reviews/:alertId/appeal         { text }  one appeal per alert
//   Admin      GET  /api/reviews/queue                   alerts awaiting review, open appeals first
//   Admin      POST /api/reviews/:alertId/decision       { decision: 'upheld' | 'dismissed', note? }
//   Admin      POST /api/reviews/:alertId/appeal-decision { decision: 'accepted' | 'rejected', response }
//
// Dismissing an alert, or accepting an appeal, marks it a false positive: like the dashboard's
// false-positive button it goes back to the device that raised it as a federated training label.
const express = require('express');
const Alert = require('./alert');
const mockStore = require('./mockStore');
const { protectAuthenticated, protectAdmin } = require('./adminRoutes');

const router = express.Router();

const REVIEW_DECISIONS = new Set(['upheld', 'dismissed']);
const APPEAL_DECISIONS = new Set(['accepted', 'rejected']);
const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const plain = (alert) => (alert && typeof alert.toObject === 'function' ? alert.toObject() : alert);

async function findAlert(id) {
  if (global.dbConnected) return Alert.findById(id).catch(() => null);
  return mockStore.listAlerts(1000).find(item => String(item._id) === String(id)) || null;
}

async function saveAlert(alert, updates) {
  if (global.dbConnected) {
    Object.assign(alert, updates);
    if (updates.appeal) alert.markModified('appeal');
    await alert.save();
    return alert;
  }
  return mockStore.updateAlert(alert._id, updates);
}

async function listAllAlerts() {
  if (global.dbConnected) return Alert.find({}).sort({ createdAt: -1 }).limit(1000).lean();
  return mockStore.listAlerts(1000);
}

// Alerts that took points off a candidate are reviewed; zero-penalty notes are informational
const needsReview = (alert) => (alert.penalty || 0) > 0 && (!alert.reviewStatus || alert.reviewStatus === 'pending');
const hasOpenAppeal = (alert) => alert.appeal && alert.appeal.status === 'open';

// What a candidate may see about an alert raised about them
function candidateView(alert) {
  const a = plain(alert);
  return {
    _id: String(a._id),
    room: a.room,
    event: a.event,
    message: a.message,
    penalty: a.penalty || 0,
    createdAt: a.createdAt,
    reviewStatus: a.reviewStatus || ((a.penalty || 0) > 0 ? 'pending' : 'none'),
    reviewNote: a.reviewNote || null,
    reviewedAt: a.reviewedAt || null,
    appeal: a.appeal || null,
  };
}

async function markFalsePositive(alert) {
  const wasFalsePositive = Boolean(plain(alert).falsePositive);
  if (wasFalsePositive) return false;
  return require('./index').sendFalsePositiveLabel(plain(alert));
}

// ── Candidate ──────────────────────────────────────────────────────────────────
router.get('/mine', protectAuthenticated, async (req, res) => {
  try {
    const email = req.user.email;
    if (!email) return res.json({ success: true, alerts: [] });
    const alerts = (await listAllAlerts()).filter(alert => alert.sourceEmail === email);
    res.json({ success: true, alerts: alerts.map(candidateView) });
  } catch (err) {
    console.error('[reviews] mine:', err.message);
    res.status(500).json({ success: false, message: 'Could not load your alerts.' });
  }
});

router.post('/:alertId/appeal', protectAuthenticated, async (req, res) => {
  try {
    const alert = await findAlert(req.params.alertId);
    if (!alert || !req.user.email || plain(alert).sourceEmail !== req.user.email) {
      return res.status(404).json({ success: false, message: 'Alert not found.' });
    }
    const a = plain(alert);
    if (a.appeal) return res.status(409).json({ success: false, message: 'This alert already has an appeal.' });
    if (a.reviewStatus === 'dismissed') return res.status(400).json({ success: false, message: 'This alert was already dismissed.' });
    const text = cleanText(req.body && req.body.text, 2000);
    if (text.length < 10) return res.status(400).json({ success: false, message: 'Explain what happened in at least 10 characters.' });
    const saved = await saveAlert(alert, { appeal: { text, createdAt: new Date().toISOString(), status: 'open' } });
    res.json({ success: true, alert: candidateView(saved) });
  } catch (err) {
    console.error('[reviews] appeal:', err.message);
    res.status(500).json({ success: false, message: 'Could not submit the appeal.' });
  }
});

// ── Administrators ─────────────────────────────────────────────────────────────
router.get('/queue', protectAdmin, async (req, res) => {
  try {
    const alerts = (await listAllAlerts()).filter(alert => needsReview(alert) || hasOpenAppeal(alert));
    alerts.sort((a, b) => Number(hasOpenAppeal(b)) - Number(hasOpenAppeal(a)) || new Date(b.createdAt) - new Date(a.createdAt));
    res.json({
      success: true,
      alerts: alerts.slice(0, 200).map(alert => ({ ...candidateView(alert), hostEmail: alert.hostEmail || null, candidate: alert.sourceEmail || null, evidenceUrl: alert.evidenceUrl || null })),
    });
  } catch (err) {
    console.error('[reviews] queue:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the review queue.' });
  }
});

router.post('/:alertId/decision', protectAdmin, async (req, res) => {
  try {
    const decision = req.body && req.body.decision;
    if (!REVIEW_DECISIONS.has(decision)) return res.status(400).json({ success: false, message: 'decision must be upheld or dismissed.' });
    const alert = await findAlert(req.params.alertId);
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found.' });
    const labelSent = decision === 'dismissed' ? await markFalsePositive(alert) : false;
    const saved = await saveAlert(alert, {
      reviewStatus: decision,
      reviewNote: cleanText(req.body.note, 1000) || null,
      reviewedBy: req.user.email,
      reviewedAt: new Date().toISOString(),
      flagged: decision === 'upheld',
      falsePositive: decision === 'dismissed',
    });
    res.json({ success: true, alert: candidateView(saved), labelSent });
  } catch (err) {
    console.error('[reviews] decision:', err.message);
    res.status(500).json({ success: false, message: 'Could not save the decision.' });
  }
});

router.post('/:alertId/appeal-decision', protectAdmin, async (req, res) => {
  try {
    const decision = req.body && req.body.decision;
    if (!APPEAL_DECISIONS.has(decision)) return res.status(400).json({ success: false, message: 'decision must be accepted or rejected.' });
    const response = cleanText(req.body.response, 1000);
    if (!response) return res.status(400).json({ success: false, message: 'Write a response the student will see.' });
    const alert = await findAlert(req.params.alertId);
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found.' });
    const a = plain(alert);
    if (!a.appeal || a.appeal.status !== 'open') return res.status(409).json({ success: false, message: 'There is no open appeal on this alert.' });

    const accepted = decision === 'accepted';
    const labelSent = accepted ? await markFalsePositive(alert) : false;
    const now = new Date().toISOString();
    const saved = await saveAlert(alert, {
      appeal: { ...a.appeal, status: decision, response, resolvedBy: req.user.email, resolvedAt: now },
      // An accepted appeal overturns the alert; a rejected one confirms it
      reviewStatus: accepted ? 'dismissed' : 'upheld',
      reviewedBy: req.user.email,
      reviewedAt: now,
      flagged: !accepted,
      falsePositive: accepted,
    });
    res.json({ success: true, alert: candidateView(saved), labelSent });
  } catch (err) {
    console.error('[reviews] appeal decision:', err.message);
    res.status(500).json({ success: false, message: 'Could not save the appeal decision.' });
  }
});

module.exports = router;
