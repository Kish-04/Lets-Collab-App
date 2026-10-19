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

  it('should log in the built-in admin account', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@letscollab.com', password: 'admin123' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.role).toBe('admin');
    expect(res.body.token).toBeDefined();
  });

  it('should let a built-in admin token reach the admin API after its user record is gone', async () => {
    const { signJwt } = require('../config');
    const token = signJwt({ id: `admin-missing-${Date.now()}`, email: 'admin@letscollab.com' });
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
  });

  it('should rate-limit password reset guesses for one email', async () => {
    const email = `reset-${Date.now()}@test.local`;
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ email, otp: String(100000 + i), newPassword: 'a-new-password' });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5).every(code => code !== 429)).toBe(true);
    expect(statuses[6]).toEqual(429);
  });

  it('should rate-limit repeated login attempts for one email', async () => {
    const email = `login-${Date.now()}@test.local`;
    let last;
    for (let i = 0; i < 12; i++) {
      last = await request(app).post('/api/auth/login').send({ email, password: `guess-${i}` });
    }
    expect(last.statusCode).toEqual(429);
  });

  it('should need the current password to change it', async () => {
    const bcrypt = require('bcrypt');
    const mockStore = require('../mockStore');
    const { signJwt } = require('../config');
    const user = mockStore.createUser({
      name: 'Profile User',
      email: `profile-${Date.now()}@test.local`,
      password: await bcrypt.hash('old-password-1', 4),
      isVerified: true,
    });
    const auth = { Authorization: `Bearer ${signJwt({ id: user._id })}` };
    const change = body => request(app).post('/api/profile').set(auth).send(body);

    expect((await change({ name: 'Renamed', newPassword: 'new-password-1' })).statusCode).toEqual(403);
    expect((await change({ newPassword: 'new-password-1', currentPassword: 'wrong-guess' })).statusCode).toEqual(403);
    expect((await change({ newPassword: 'short', currentPassword: 'old-password-1' })).statusCode).toEqual(400);
    expect((await change({ newPassword: 'new-password-1', currentPassword: 'old-password-1' })).statusCode).toEqual(200);
    expect((await change({ name: 'Just A Rename' })).statusCode).toEqual(200);
  });

  it('should require sign-in for the Gemini pet', async () => {
    const res = await request(app).post('/api/pet').send({ message: 'hi' });
    expect(res.statusCode).toEqual(401);
  });

  it('should not expose the unauthenticated evidence video upload', async () => {
    const res = await request(app)
      .post('/api/upload-evidence-video')
      .attach('video', Buffer.from('fake video data'), '../escape.webm');
    expect(res.statusCode).toEqual(404);
  });
});
