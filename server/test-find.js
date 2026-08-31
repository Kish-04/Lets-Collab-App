require('dotenv').config();
const mongoose = require('mongoose');
const { User, Alert } = require('./index'); // Assuming index.js exports them or registers them

async function test() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ircp_db');
  
  // They are registered in mongoose globally
  const U = mongoose.model('User');
  const A = mongoose.model('Alert');

  const users = await U.find({});
  const alerts = await A.find({});
  console.log(`Mongoose found Users: ${users.length}, Alerts: ${alerts.length}`);
  process.exit(0);
}
test();
