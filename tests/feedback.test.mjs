// Landing-page feedback: stored, validated, rate limited, readable only by admins
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { repoRoot } from './helpers/loadTs.mjs'

process.env.JWT_SECRET ||= 'feedback_test_secret_more_than_32_characters'
process.env.MOCK_STORE_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-')), 'db.json')
global.dbConnected = false
const require = createRequire(path.join(repoRoot, 'server', 'index.js'))
const express = require('express')
const mockStore = require('./mockStore.js')
const { signJwt } = require('./config.js')

test('feedback is stored, validated and only admins can read it', async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/feedback', require('./feedbackRoutes.js'))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}/api/feedback`
  const post = body => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const admin = mockStore.createUser({ name: 'Admin', email: `admin-${Date.now()}@test.local`, password: 'x', isVerified: true, role: 'admin' })
  const member = mockStore.createUser({ name: 'Member', email: `member-${Date.now()}@test.local`, password: 'x', isVerified: true })
  const auth = user => ({ Authorization: `Bearer ${signJwt({ id: user._id })}` })
  try {
    assert.equal((await post({ name: 'A', email: 'a@b.co', problem: 'too short' })).status, 400)
    assert.equal((await post({ name: 'Asha', email: 'not-an-email', problem: 'Screen share lags on my laptop' })).status, 400)
    const ok = await post({ name: 'Asha', email: 'Asha@Example.com', role: 'student', rating: 4, problem: 'Screen share lags on my laptop', improvement: 'Lower quality option', contactOk: true })
    assert.equal(ok.status, 201)

    // Bots that fill the hidden field get a polite yes and nothing is stored
    assert.equal((await post({ name: 'Bot', email: 'bot@spam.io', problem: 'buy cheap things now', website: 'http://spam' })).status, 200)

    assert.equal((await fetch(base)).status, 401)
    assert.equal((await fetch(base, { headers: auth(member) })).status, 403)
    const list = await (await fetch(base, { headers: auth(admin) })).json()
    assert.equal(list.total, 1)
    assert.equal(list.averageRating, 4)
    const [item] = list.items
    assert.equal(item.email, 'asha@example.com')
    assert.equal(item.status, 'new')

    const patched = await fetch(`${base}/${item._id}`, { method: 'PATCH', headers: { ...auth(admin), 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'planned' }) })
    assert.equal((await patched.json()).item.status, 'planned')

    // Five per hour from one address
    for (let i = 0; i < 2; i++) await post({ name: 'Asha', email: 'asha@example.com', problem: 'Another detailed problem report' })
    assert.equal((await post({ name: 'Asha', email: 'asha@example.com', problem: 'Another detailed problem report' })).status, 429)
  } finally {
    server.close()
  }
})
