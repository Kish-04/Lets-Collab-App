require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

mongoose.connect('mongodb://127.0.0.1:27017/ircptracker').then(async () => {
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const salt = await bcrypt.genSalt(10);
  const password = await bcrypt.hash('Kishan@2005', salt);
  await users.updateOne(
    { email: 'kishankarthiks222@gmail.com' },
    { $set: { name: 'Kishan Admin', email: 'kishankarthiks222@gmail.com', password: password, isVerified: true, role: 'admin' } },
    { upsert: true }
  );
  console.log('Admin user created successfully in DB!');
  process.exit(0);
}).catch(console.error);
