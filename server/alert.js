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
}, { timestamps: true });

alertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
