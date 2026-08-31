const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/ircp_db').then(async () => {
  const users = await mongoose.connection.db.collection('users').countDocuments();
  const alerts = await mongoose.connection.db.collection('alerts').countDocuments();
  console.log(`Users: ${users}, Alerts: ${alerts}`);
  process.exit(0);
});
