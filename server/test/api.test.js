process.env.NODE_ENV = 'test';
const path = require('path');
Object.assign(process.env, {
  JWT_SECRET: 'test_jwt_secret_with_more_than_32_chars',
  MONGO_URI: 'mongodb://127.0.0.1:1/api-test',
  MONGO_CONNECT_TIMEOUT_MS: '250',
  RPC_URL: 'http://127.0.0.1:9',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:9',
  CONTRACT_ADDRESS: '',
  ALLOW_MOCK_BLOCKCHAIN: 'true',
  LOG_OTP: 'false',
  RESEND_API_KEY: '',
  EMAILJS_SERVICE_ID: '',
  EMAILJS_TEMPLATE_ID: '',
  EMAILJS_PUBLIC_KEY: '',
  MOCK_STORE_FILE: path.join(__dirname, '../../scratch/api-test-mock-store.json'),
});
const request = require('supertest');
const { app, server } = require('../index');
const mongoose = require('mongoose');

describe('API Tests', () => {
  beforeAll(async () => {
    // Wait for the app to initialize if necessary
  });

  afterAll(async () => {
    // Close the server and DB connection so Jest can exit
    server.close();
    await mongoose.disconnect().catch(() => {});
  });

  it('should reject unauthenticated requests to /api/admin/users', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('no token provided');
  });

  it('should handle mock admin report data gracefully', async () => {
    const res = await request(app).get('/api/admin/reports');
    expect(res.statusCode).toEqual(401);
  });

  it('should reject unauthenticated evidence uploads', async () => {
    const res = await request(app)
      .post('/api/admin/upload-evidence')
      .attach('evidenceFile', Buffer.from('fake image data'), 'test.png');
    expect(res.statusCode).toEqual(401);
    expect(res.body.success).toBe(false);
  });
});
