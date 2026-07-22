const request = require('supertest');
const express = require('express');
const authRoutes = require('../authRoutes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

describe('Auth API', () => {
  it('should return error for invalid login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nonexistent@example.com',
        password: 'wrongpassword'
      });
    expect(res.statusCode).toEqual(401);
  });
});
