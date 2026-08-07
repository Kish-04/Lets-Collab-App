const express = require('express');
const router = express.Router();
const SessionLog = require('./sessionLog');
const mockStore = require('./mockStore');
const { protectAuthenticated } = require('./adminRoutes');

router.get('/recent', protectAuthenticated, async (req, res) => {
  try {
    const userId = String(req.user.id);
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    let sessions;
    if (global.dbConnected) {
      sessions = await SessionLog.find({
        status: 'ended',
        $or: [
          { hostUserId: userId },
          { participantUserIds: userId },
        ],
      })
        .sort({ endedAt: -1, startedAt: -1 })
        .limit(limit)
        .select('-events -messages -evidence -participants -federated')
        .lean();
    } else {
      sessions = mockStore.listSessionLogs(limit)
        .filter((s) => s.status === 'ended' && (s.hostUserId === userId || (Array.isArray(s.participantUserIds) && s.participantUserIds.includes(userId))))
        .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
    }

    const mappedSessions = (sessions || []).map(s => {
      const isHost = String(s.hostUserId) === userId;
      return { ...s, isHost };
    });

    res.json({ success: true, sessions: mappedSessions });
  } catch (err) {
    console.error('recent sessions error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load recent sessions' });
  }
});

module.exports = router;
