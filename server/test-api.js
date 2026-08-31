require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

async function test() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ircp_db');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const adminUser = await User.findOne({ role: 'admin' });
  
  const token = jwt.sign(
    { id: adminUser._id, role: adminUser.role, email: adminUser.email }, 
    process.env.JWT_SECRET || 'super_secret_test_key_for_jwt', 
    { expiresIn: '1h' }
  );

  const res = await fetch('http://127.0.0.1:3001/api/admin/reports', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const text = await res.text();
  console.log('RESPONSE SIZE (bytes):', text.length);
  process.exit(0);
}
test();
