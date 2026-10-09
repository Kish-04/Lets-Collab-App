// TURN credentials and signed evidence URLs: node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { repoRoot } from './helpers/loadTs.mjs'

process.env.JWT_SECRET ||= 'server_security_test_secret_more_than_32_chars'
const require = createRequire(path.join(repoRoot, 'server', 'index.js'))
const { buildIceServers } = require('./turn.js')
const { isUploadPath, requireSignedUpload, signUploadUrl } = require('./uploadAccess.js')
const express = require('express')

test('TURN credentials follow the coturn REST API scheme and expire', () => {
  const { iceServers } = buildIceServers({ TURN_URLS: 'turn:a.example:3478,turns:b.example:5349', TURN_SECRET: 's3cret' }, 'user 1<x>')
  const [turn, stun] = iceServers
  const [expiry, identity] = turn.username.split(':')
  assert.deepEqual(turn.urls, ['turn:a.example:3478', 'turns:b.example:5349'])
  assert.equal(identity, 'user1x')
  assert.ok(Math.abs(Number(expiry) - (Date.now() / 1000 + 43200)) < 5)
  assert.equal(turn.credential, crypto.createHmac('sha1', 's3cret').update(turn.username).digest('base64'))
  assert.ok(stun.urls.length > 0)
  assert.equal(buildIceServers({}), null)
})

test('evidence files need a valid, unexpired signature bound to the exact path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'))
  fs.mkdirSync(path.join(root, 'evidence'))
  fs.writeFileSync(path.join(root, 'evidence', 'shot.png'), 'PNG')
  const app = express()
  app.use('/uploads', requireSignedUpload, express.static(root))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  const status = async url => (await fetch(base + url)).status
  try {
    const signed = signUploadUrl('/uploads/evidence/shot.png')
    assert.equal(await status('/uploads/evidence/shot.png'), 403)
    assert.equal(await status(signed), 200)
    assert.equal(await status(signed.replace('shot.png', 'other.png')), 403)
    assert.equal(await status(signed.replace(/sig=[^&]+/, 'sig=AAAA')), 403)
    assert.equal(await status(signUploadUrl('/uploads/evidence/shot.png', -10)), 403)
  } finally {
    server.close()
  }
  assert.equal(signUploadUrl('https://evil.example/pixel.png'), null)
  assert.ok(!isUploadPath('/uploads/../index.js'))
  assert.ok(isUploadPath('/uploads/evidence/1-shot.png'))
})
