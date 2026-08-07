const mongoose = require('mongoose');

const sessionLogSchema = new mongoose.Schema({
  roomCode: { type: String, required: true, index: true },
  mode: { type: String, enum: ['collaboration', 'supervised'], required: true },
   hostName: { type: String },
   hostEmail: { type: String },
   hostUserId: { type: String, index: true },
   participantUserIds: [{ type: String, index: true }],
   status: { type: String, enum: ['active', 'ended'], default: 'ended', index: true },
   startedAt: { type: Date, required: true },
   endedAt: { type: Date },
  durationSeconds: { type: Number, default: 0 },
  participants: [{
    socketId: String,
    name: String,
    email: String,
    role: String,
    permission: String,
    joinedAt: Date,
    leftAt: Date,
  }],
  events: [{
    time: String,
    type: { type: String },
    message: String,
  }],
  messages: [{
    id: String,
    time: String,
    senderId: String,
    senderName: String,
    role: String,
    text: String,
  }],
  evidence: [{
    id: String,
    time: String,
    type: { type: String },
    by: String,
    label: String,
  }],
  federated: { type: mongoose.Schema.Types.Mixed },
  examData: { type: mongoose.Schema.Types.Mixed },
  riskScore: { type: Number, default: 0 },
  alertCount: { type: Number, default: 0 },
  latestTxHash: String,
}, { timestamps: true });

module.exports = mongoose.models.SessionLog || mongoose.model('SessionLog', sessionLogSchema);
