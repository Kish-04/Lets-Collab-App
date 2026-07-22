process.env.NODE_ENV = 'test';
const request = require('supertest');
const { app, server } = require('../index');
const connectDB = require('../db');
const mongoose = require('mongoose');

describe('API Tests', () => {
  beforeAll(async () => {
    // Wait for the app to initialize if necessary
  });

  afterAll(async () => {
    // Close the server and DB connection so Jest can exit
    server.close();
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
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
