// Creates or promotes an admin user. Credentials come from the environment, never from code:
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node create_admin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const plainPassword = process.env.ADMIN_PASSWORD || '';
if (!email || plainPassword.length < 12) {
  console.error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.');
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ircptracker').then(async () => {
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash(plainPassword, salt);
  await users.updateOne(
    { email },
    { $set: { name: 'System Administrator', email, password, isVerified: true, role: 'admin' } },
    { upsert: true }
  );
  console.log(`Admin user ${email} created or updated.`);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
