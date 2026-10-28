const mongoose = require('mongoose');

// What visitors tell us on the landing page's "Help us improve" form (feedbackRoutes.js)
const feedbackSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, index: true },
  role: { type: String, default: 'other' },
  rating: { type: Number, min: 1, max: 5 },
  problem: { type: String, required: true },
  improvement: { type: String, default: '' },
  contactOk: { type: Boolean, default: false },
  userId: { type: String }, // set when the visitor was signed in
  status: { type: String, enum: ['new', 'read', 'planned', 'done'], default: 'new' },
}, { timestamps: true });

feedbackSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
