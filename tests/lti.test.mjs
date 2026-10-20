// LTI 1.3 end to end against a simulated platform (a stand-in for Moodle or Canvas): OIDC login,
// signed launch for an instructor and a student, the course activity linked to the exam room, and
// the student's grade posted back to the platform's gradebook when the exam ends.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { repoRoot } from './helpers/loadTs.mjs'

const platformKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const received = { tokenRequests: [], scores: [] }
let platformUrl
let toolUrl

const platform = http.createServer((req, res) => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    if (req.url === '/jwks') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ keys: [{ ...platformKeys.publicKey.export({ format: 'jwk' }), kid: 'plat-1', alg: 'RS256', use: 'sig' }] }))
    }
    if (req.url === '/token' && req.method === 'POST') {
      received.tokenRequests.push(Object.fromEntries(new URLSearchParams(body)))
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ access_token: 'platform-access-token', token_type: 'Bearer', expires_in: 3600 }))
    }
    if (req.url.startsWith('/lineitems/7/lineitem/scores') && req.method === 'POST') {
      received.scores.push({ auth: req.headers.authorization, type: req.headers['content-type'], body: JSON.parse(body) })
      res.statusCode = 200
      return res.end('{}')
    }
    res.statusCode = 404
    res.end()
  })
})

await new Promise(resolve => platform.listen(0, '127.0.0.1', resolve))
platformUrl = `http://127.0.0.1:${platform.address().port}`

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'lti_test_jwt_secret_with_more_than_32_characters',
  MONGO_URI: 'mongodb://127.0.0.1:1/lti-test',
  MONGO_CONNECT_TIMEOUT_MS: '250',
  RPC_URL: 'http://127.0.0.1:9',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:9',
  CHAIN_RPC_URL: 'http://127.0.0.1:9',
  CONTRACT_ADDRESS: '',
  ALLOW_MOCK_BLOCKCHAIN: 'true',
  MOCK_STORE_FILE: path.join(os.tmpdir(), `drcsfa-lti-${Date.now()}.json`),
  FRONTEND_URL: 'http://frontend.test',
  LTI_ISSUER: 'https://moodle.example.edu',
  LTI_CLIENT_ID: 'lets-collab-client',
  LTI_DEPLOYMENT_ID: 'dep-1',
  LTI_AUTH_LOGIN_URL: `${platformUrl}/auth`,
  LTI_KEYSET_URL: `${platformUrl}/jwks`,
  LTI_ACCESS_TOKEN_URL: `${platformUrl}/token`,
})

const serverRequire = createRequire(path.join(repoRoot, 'server', 'index.js'))
const { io: ioClient } = createRequire(path.join(repoRoot, 'package.json'))('socket.io-client')
const jwt = serverRequire('jsonwebtoken')
const { server } = serverRequire('./index.js')
const sockets = []

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  toolUrl = `http://127.0.0.1:${server.address().port}`
  await new Promise(resolve => setTimeout(resolve, 500))
})

after(async () => {
  sockets.forEach(s => s.disconnect())
  server.close()
  platform.close()
  await serverRequire('mongoose').disconnect().catch(() => {})
  setTimeout(() => process.exit(0), 200).unref()
})

function once(socket, event, predicate = () => true, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout)
    const handler = (...args) => {
      if (!predicate(...args)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(args[0])
    }
    socket.on(event, handler)
  })
}

const CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/'
function idToken(nonce, who, overrides = {}) {
  return jwt.sign({
    nonce,
    sub: who.sub,
    email: who.email,
    name: who.name,
    [`${CLAIM}deployment_id`]: 'dep-1',
    [`${CLAIM}message_type`]: 'LtiResourceLinkRequest',
    [`${CLAIM}version`]: '1.3.0',
    [`${CLAIM}resource_link`]: { id: 'quiz-42', title: 'Midterm' },
    [`${CLAIM}roles`]: [who.instructor ? 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor' : 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
    'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint': {
      scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'],
      lineitem: `${platformUrl}/lineitems/7/lineitem?type_id=1`,
    },
    ...overrides,
  }, platformKeys.privateKey, { algorithm: 'RS256', keyid: 'plat-1', issuer: 'https://moodle.example.edu', audience: 'lets-collab-client', expiresIn: 300 })
}

async function login() {
  const res = await fetch(`${toolUrl}/api/lti/login?iss=${encodeURIComponent('https://moodle.example.edu')}&login_hint=hint-1&client_id=lets-collab-client`, { redirect: 'manual' })
  assert.equal(res.status, 302)
  const target = new URL(res.headers.get('location'))
  assert.equal(`${target.origin}${target.pathname}`, `${platformUrl}/auth`)
  assert.equal(target.searchParams.get('redirect_uri'), `${toolUrl}/api/lti/launch`)
  assert.equal(target.searchParams.get('response_mode'), 'form_post')
  return { state: target.searchParams.get('state'), nonce: target.searchParams.get('nonce') }
}

const launch = (state, token) => fetch(`${toolUrl}/api/lti/launch`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ state, id_token: token }),
})

function launchResult(res) {
  assert.equal(res.status, 302)
  const location = new URL(res.headers.get('location'))
  assert.equal(`${location.origin}${location.pathname}`, 'http://frontend.test/lti/launch')
  return Object.fromEntries(new URLSearchParams(location.hash.slice(1)))
}

test('a forged, replayed or mismatched launch is refused', async () => {
  const teacher = { sub: 'lms-t', email: 'teacher@uni.test', name: 'Teacher', instructor: true }
  const forger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  let { state, nonce } = await login()
  const forged = jwt.sign({ nonce }, forger.privateKey, { algorithm: 'RS256', keyid: 'plat-1', issuer: 'https://moodle.example.edu', audience: 'lets-collab-client', expiresIn: 300 })
  assert.equal((await launch(state, forged)).status, 401, 'wrong signature')
  assert.equal((await launch(state, idToken(nonce, teacher))).status, 400, 'state is single use')

  ;({ state, nonce } = await login())
  assert.equal((await launch(state, idToken('other-nonce', teacher))).status, 401, 'nonce must match')
  ;({ state, nonce } = await login())
  assert.equal((await launch(state, idToken(nonce, teacher, { [`${CLAIM}deployment_id`]: 'other' }))).status, 401, 'unknown deployment')
  assert.equal((await fetch(`${toolUrl}/api/lti/login?iss=https://evil.test&login_hint=x`, { redirect: 'manual' })).status, 400)
})

test('instructor and student launch into one exam room and the grade flows back', async () => {
  const teacher = { sub: 'lms-teacher-1', email: 'teacher1@uni.test', name: 'Dr Rao', instructor: true }
  const student = { sub: 'lms-student-9', email: 'student9@uni.test', name: 'Asha' }

  let { state, nonce } = await login()
  const t = launchResult(await launch(state, idToken(nonce, teacher)))
  assert.equal(t.role, 'instructor')
  ;({ state, nonce } = await login())
  const s = launchResult(await launch(state, idToken(nonce, student)))
  assert.equal(s.role, 'learner')
  assert.equal(s.link, t.link)

  // The student waits until the instructor opens the room from the same activity
  const waiting = await (await fetch(`${toolUrl}/api/lti/room?link=${encodeURIComponent(s.link)}`, { headers: { Authorization: `Bearer ${s.token}` } })).json()
  assert.equal(waiting.roomCode, null)

  const host = ioClient(toolUrl, { auth: { token: t.token }, transports: ['websocket'], forceNew: true })
  sockets.push(host)
  await once(host, 'connect')
  host.emit('create-room', { name: 'Dr Rao', mode: 'supervised', ltiLink: t.link })
  const { roomCode } = await once(host, 'room-created')
  const ready = await (await fetch(`${toolUrl}/api/lti/room?link=${encodeURIComponent(s.link)}`, { headers: { Authorization: `Bearer ${s.token}` } })).json()
  assert.equal(ready.roomCode, roomCode)

  const candidate = ioClient(toolUrl, { auth: { token: s.token }, transports: ['websocket'], forceNew: true })
  sockets.push(candidate)
  await once(candidate, 'connect')
  candidate.emit('join-room', roomCode, 'controller', { name: 'Asha' })
  await once(host, 'connection-request')
  host.emit('respond-join', { controllerId: candidate.id, approved: true, permission: 'view' }, roomCode)
  await once(candidate, 'join-approved')
  const question = once(candidate, 'new-exam-question')
  host.emit('host-push-question', { id: 'q1', type: 'mc', prompt: '2 + 2?', options: ['3', '4'], answerKey: '4', roomId: roomCode })
  await question
  const graded = once(candidate, 'exam-answer-result')
  candidate.emit('controller-submit-answer', { questionId: 'q1', answer: { text: '4' }, roomId: roomCode })
  assert.equal((await graded).correct, true)

  host.emit('kill-session', roomCode)
  await once(candidate, 'kill-session')
  for (let i = 0; i < 40 && received.scores.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 100))

  assert.equal(received.scores.length, 1)
  const [score] = received.scores
  assert.equal(score.auth, 'Bearer platform-access-token')
  assert.equal(score.type, 'application/vnd.ims.lis.v1.score+json')
  assert.deepEqual([score.body.userId, score.body.scoreGiven, score.body.scoreMaximum, score.body.gradingProgress], ['lms-student-9', 1, 1, 'FullyGraded'])

  // The grade request was authorised with a client assertion signed by the tool's published key
  const request = received.tokenRequests.at(-1)
  assert.equal(request.grant_type, 'client_credentials')
  const toolJwks = await (await fetch(`${toolUrl}/api/lti/jwks`)).json()
  const toolKey = crypto.createPublicKey({ key: toolJwks.keys[0], format: 'jwk' })
  const assertion = jwt.verify(request.client_assertion, toolKey, { algorithms: ['RS256'], audience: `${platformUrl}/token` })
  assert.equal(assertion.iss, 'lets-collab-client')
})
