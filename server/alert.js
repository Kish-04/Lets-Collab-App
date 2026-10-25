const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
    room: { type: String, required: true, index: true },
    hostEmail: { type: String },
    type: { type: String, default: 'anticheat' },
    event: { type: String },
    message: { type: String, required: true },
    evidenceUrl: { type: String },
    penalty: { type: Number, default: 0 },
    flagged: { type: Boolean, default: false },
    falsePositive: { type: Boolean, default: false },
    // Federated-learning feature vector that produced the alert, and the socket that raised it,
    // so an admin's false-positive verdict can be sent back as a training label
    features: { type: [Number], default: undefined },
    sourceSocketId: { type: String },
    sourceEmail: { type: String }, // lets a training label reach the device after it reconnects
    // Human review (reviewRoutes.js): pending until an admin upholds or dismisses it
    reviewStatus: { type: String, enum: ['pending', 'upheld', 'dismissed'], default: 'pending' },
    reviewNote: { type: String },
    reviewedBy: { type: String },
    reviewedAt: { type: String },
    // A candidate's appeal: { text, createdAt, status: open | accepted | rejected, response, resolvedBy, resolvedAt }
    appeal: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

alertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
