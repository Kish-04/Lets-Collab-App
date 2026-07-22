const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ircp_db';
    const timeoutMs = Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 5000);
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: timeoutMs,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    global.dbConnected = true;
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[FATAL] MongoDB Connection Error: ${err.message}. Refusing to start in production without a database.`);
      process.exit(1);
    }
    console.warn(`MongoDB Connection Error: ${err.message}. Falling back to persistent JSON storage for development.`);
    global.dbConnected = false;
  }
};

module.exports = connectDB;
