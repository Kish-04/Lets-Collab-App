// Multi-client integration tests against the real signaling server (in-process, no database, mock chain).
// Run: node --test tests/realtime.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { loadTs, repoRoot } from './helpers/loadTs.mjs'

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'realtime_test_jwt_secret_with_more_than_32_chars',
  MONGO_URI: 'mongodb://127.0.0.1:1/realtime-test',
  MONGO_CONNECT_TIMEOUT_MS: '250',
  RPC_URL: 'http://127.0.0.1:9',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:9',
  CHAIN_RPC_URL: 'http://127.0.0.1:9',
  CONTRACT_ADDRESS: '',
  ALLOW_MOCK_BLOCKCHAIN: 'true',
  FL_MIN_PARTICIPANTS: '3',
  FL_JOIN_WINDOW_MS: '3000',
  FL_SUBMIT_WINDOW_MS: '5000',
  MOCK_STORE_FILE: path.join(os.tmpdir(), `drcsfa-realtime-${Date.now()}.json`),
})

const require = createRequire(path.join(repoRoot, 'server', 'index.js'))
const { io: ioClient } = createRequire(path.join(repoRoot, 'package.json'))('socket.io-client')
const { server } = require('./index.js')
const mockStore = require('./mockStore.js')
const { signJwt } = require('./config.js')
const secagg = await loadTs('lib/secureAggregation.ts')
const { E2EChatSession, isE2EMessage } = await loadTs('lib/E2EChat.ts')

let baseUrl
const sockets = []

before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
  await new Promise(resolve => setTimeout(resolve, 600)) // let the DB/chain fall back to mock mode
})

after(async () => {
  sockets.forEach(s => s.disconnect())
  server.close()
  await require('mongoose').disconnect().catch(() => {})
  setTimeout(() => process.exit(0), 200).unref()
})

function user(name, role = 'user') {
  const created = mockStore.createUser({ name, email: `${name.toLowerCase()}-${Date.now()}@test.local`, password: 'x', isVerified: true, role })
  return { ...created, token: signJwt({ id: created._id }) }
}

async function connect(account) {
  const socket = ioClient(baseUrl, { auth: { token: account.token }, transports: ['websocket'], forceNew: true })
  sockets.push(socket)
  await once(socket, 'connect')
  return socket
}

function once(socket, event, predicate = () => true, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timed out waiting for ${event}`)) }, timeout)
    function handler(...args) {
      if (!predicate(...args)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(args.length > 1 ? args : args[0])
    }
    socket.on(event, handler)
  })
}

const noEvent = (socket, event, wait = 600) => new Promise((resolve, reject) => {
  const handler = () => reject(new Error(`unexpected ${event}`))
  socket.on(event, handler)
  setTimeout(() => { socket.off(event, handler); resolve() }, wait)
})

async function supervisedRoom(controllerCount) {
  const host = await connect(user('Host'))
  host.emit('create-room', { name: 'Host', mode: 'supervised' })
  const { roomCode } = await once(host, 'room-created')
  const controllers = []
  for (let i = 0; i < controllerCount; i++) {
    const c = await connect(user(`Cand${i}`))
    c.emit('join-room', roomCode, 'controller', { name: `Cand${i}` })
    await once(host, 'connection-request')
    host.emit('respond-join', { controllerId: c.id, approved: true, permission: 'full' }, roomCode)
    await once(c, 'join-approved')
    controllers.push(c)
  }
  return { host, controllers, roomCode }
}

test('secure aggregation completes and is exact when a participant drops mid-round', async () => {
  const { host, controllers, roomCode } = await supervisedRoom(3)
  const LEN = 41
  const base = Array.from({ length: LEN }, (_, i) => Math.cos(i) * 0.2)
  const participants = [host, ...controllers].map((socket, i) => ({
    socket,
    n: [10, 25, 5, 40][i],
    delta: Array.from({ length: LEN }, () => (Math.random() - 0.5) * 0.06),
  }))
  const dropper = participants[2]

  for (const p of participants) {
    const state = {}
    p.socket.on('fl-round-open', async ({ round, baseRound }) => {
      state.keys = await secagg.createRoundKeys()
      state.seed = crypto.getRandomValues(new Uint8Array(32))
      state.contribution = secagg.buildContribution(p.delta, p.n, 1, 0)
      p.socket.emit('fl-join', { roomId: roomCode, round, publicKey: state.keys.publicKey, baseRound, vectorLength: LEN + 1, initWeights: base })
    })
    p.socket.on('fl-round-keys', async ({ round, peers }) => {
      state.peers = peers
      const { shares } = await secagg.prepareShares({ keys: state.keys, selfSeed: state.seed, peers, roomId: roomCode, round })
      p.socket.emit('fl-shares', { roomId: roomCode, round, shares })
    })
    p.socket.on('fl-round-masking', async ({ round, peers, shares }) => {
      if (p === dropper) return p.socket.disconnect() // drops after sharing keys, before submitting
      state.held = await secagg.openShares({ keys: state.keys, received: shares, peers: state.peers, roomId: roomCode, round })
      const masked = await secagg.maskVector({ values: state.contribution, keys: state.keys, selfSeed: state.seed, selfId: p.socket.id, peers, roomId: roomCode, round })
      p.socket.emit('fl-submit', { roomId: roomCode, round, masked })
    })
    p.socket.on('fl-unmask', ({ round, survivors, dropped }) => {
      p.socket.emit('fl-unmask-shares', { roomId: roomCode, round, shares: secagg.revealShares(state.held, survivors, dropped) })
    })
  }

  const aggregated = once(host, 'federated-aggregate', () => true, 20000)
  host.emit('fl-round-start', { roomId: roomCode })
  const result = await aggregated

  const survivors = participants.filter(p => p !== dropper)
  const totalN = survivors.reduce((t, p) => t + p.n, 0)
  const expected = base.map((w, i) => w + survivors.reduce((t, p) => t + p.delta[i] * p.n, 0) / totalN)
  assert.equal(result.contributorCount, 3)
  assert.equal(result.droppedCount, 1)
  assert.equal(result.sampleCount, totalN)
  assert.ok(Math.max(...expected.map((v, i) => Math.abs(v - result.weights[i]))) < 1e-3)
})

test('chat is end-to-end encrypted and a late joiner can read the history', async () => {
  const { host, controllers, roomCode } = await supervisedRoom(1)
  const clients = new Map()
  const attach = (socket) => {
    const session = new E2EChatSession(roomCode)
    const state = { session, announced: false, keyed: null }
    state.keyed = new Promise(resolve => { state.resolveKeyed = resolve })
    socket.on('session-state', async () => {
      if (state.announced) return
      state.announced = true
      socket.emit('e2e-announce', { roomId: roomCode, publicKey: await session.init() })
    })
    socket.on('e2e-roster', async ({ hostId, members }) => {
      if (hostId !== socket.id) return
      for (const share of await session.hostHandleRoster(socket.id, members)) socket.emit('e2e-key-share', { roomId: roomCode, ...share })
      state.resolveKeyed()
    })
    socket.on('e2e-key-share', async ({ payload }) => { await session.receiveKeyring(payload); state.resolveKeyed() })
    clients.set(socket, state)
    return state
  }
  const hostState = attach(host)
  host.emit('get-session-state')
  const aliceState = attach(controllers[0])
  // Trigger fresh room state for both so they announce
  host.emit('access-granted', 'full', {}, roomCode)
  await Promise.all([hostState.keyed, aliceState.keyed])

  const relayed = once(host, 'chat-message')
  controllers[0].emit('chat-message', { roomId: roomCode, text: await aliceState.session.encrypt('meet me at question 4') })
  const message = await relayed
  assert.ok(isE2EMessage(message.text), 'server relays ciphertext')
  assert.ok(!message.text.includes('question'), 'plaintext never reaches the server')
  assert.equal(await hostState.session.decrypt(message.text), 'meet me at question 4')

  // Bob joins after the message was sent: he gets the ciphertext history and, once keyed, can read it
  const bob = await connect(user('Bob'))
  const bobState = attach(bob)
  const history = once(bob, 'session-state', state => (state.messages || []).length > 0)
  bob.emit('join-room', roomCode, 'controller', { name: 'Bob' })
  await once(host, 'connection-request')
  host.emit('respond-join', { controllerId: bob.id, approved: true, permission: 'view' }, roomCode)
  const state = await history
  await bobState.keyed
  assert.equal(await bobState.session.decrypt(state.messages.at(-1).text), 'meet me at question 4')
})

test('an admin can view a candidate camera; unrelated sockets cannot inject signaling', async () => {
  const { controllers, roomCode } = await supervisedRoom(1)
  const candidate = controllers[0]
  const admin = await connect(user('Admin', 'admin'))
  const intruder = await connect(user('Intruder'))

  // Relays without a matching admin request are dropped
  intruder.emit('controller-observation-offer', { adminId: admin.id, offer: { type: 'offer', sdp: 'x' } })
  await noEvent(admin, 'observer-offer')

  const requested = once(candidate, 'controller-observation-requested')
  admin.emit('request-controller-observation', { roomId: roomCode, targetId: candidate.id })
  const { adminId } = await requested
  assert.equal(adminId, admin.id)

  const offer = once(admin, 'observer-offer')
  candidate.emit('controller-observation-offer', { adminId, offer: { type: 'offer', sdp: 'v=0' } })
  const received = await offer
  assert.equal(received.hostId, candidate.id)

  const answer = once(candidate, 'observer-answer')
  admin.emit('observer-answer', { hostId: candidate.id, answer: { type: 'answer', sdp: 'v=0' } })
  assert.equal((await answer).observerId, admin.id)

  const candidateIce = once(admin, 'observer-ice-candidate')
  candidate.emit('controller-observation-ice-candidate', { adminId, candidate: { candidate: 'c1' } })
  assert.equal((await candidateIce).fromId, candidate.id)

  const adminIce = once(candidate, 'observer-ice-candidate')
  admin.emit('observer-ice-candidate', { targetId: candidate.id, candidate: { candidate: 'a1' } })
  assert.equal((await adminIce).fromId, admin.id)

  const ended = once(candidate, 'controller-observation-ended')
  admin.emit('end-controller-observation')
  assert.equal((await ended).adminId, admin.id)
})

test('panic revoke drops every controller to view-only and tells them why', async () => {
  const { host, controllers, roomCode } = await supervisedRoom(2)
  const revoked = controllers.map(c => Promise.all([
    once(c, 'access-granted', permission => permission === 'view'),
    once(c, 'system-warning', message => /revoked all remote control/i.test(message)),
  ]))
  host.emit('access-granted', 'view', { reason: 'panic' }, roomCode)
  await Promise.all(revoked)
})

test('a controller cannot take the host role unless the host asked for a swap', async () => {
  const { host, controllers: [candidate], roomCode } = await supervisedRoom(1)
  const takeover = noEvent(host, 'role-swap-completed')
  candidate.emit('accept-role-swap', { roomId: roomCode })
  candidate.emit('accept-role-swap', { targetId: host.id, roomId: roomCode })
  await takeover

  // A real request from the host, answered by the controller, still swaps roles
  const requested = once(candidate, 'role-swap-requested')
  host.emit('request-role-swap', { targetId: candidate.id, roomId: roomCode })
  assert.equal((await requested).fromId, host.id)
  const completed = once(host, 'role-swap-completed')
  candidate.emit('accept-role-swap', { targetId: host.id, roomId: roomCode })
  assert.equal((await completed).newHostId, candidate.id)
})

test('a burst of alerts sends one chain transaction, not one per alert', async () => {
  const { host, controllers: [candidate], roomCode } = await supervisedRoom(1)
  const anchored = []
  host.on('chain-log', entry => { if (entry.type === 'permission_violation') anchored.push(entry) })
  for (let i = 0; i < 10; i++) host.emit('permission-violation', { roomCode, controllerId: candidate.id, action: `spam ${i}` })
  await new Promise(resolve => setTimeout(resolve, 1500))
  assert.equal(anchored.length, 1)
})

test('the room activity log reaches the host but never a candidate', async () => {
  const { host, controllers: [candidate], roomCode } = await supervisedRoom(1)
  const candidateStates = []
  candidate.on('session-state', state => candidateStates.push(state))
  const leaked = noEvent(candidate, 'room-event', 1000)
  const seen = once(host, 'room-event', event => /blocked/.test(event.message))
  host.emit('permission-violation', { roomCode, controllerId: candidate.id, action: 'Win+R' })
  assert.match((await seen).message, /Win\+R/)
  await leaked
  host.emit('access-granted', 'view', {}, roomCode) // triggers a fresh session-state for everyone
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.ok(candidateStates.length > 0)
  assert.ok(candidateStates.every(state => state.events === undefined))
})

test('a host that drops can resume its room, and a dropped controller comes back approved', async () => {
  const hostAccount = user('GraceHost')
  const candAccount = user('GraceCand')
  let host = await connect(hostAccount)
  host.emit('create-room', { name: 'GraceHost', mode: 'supervised' })
  const { roomCode } = await once(host, 'room-created')
  let candidate = await connect(candAccount)
  candidate.emit('join-room', roomCode, 'controller', { name: 'GraceCand' })
  await once(host, 'connection-request')
  host.emit('respond-join', { controllerId: candidate.id, approved: true, permission: 'keyboard' }, roomCode)
  await once(candidate, 'join-approved')

  // Host connection drops: the room is held, not killed
  const reconnecting = once(candidate, 'host-reconnecting')
  const killed = noEvent(candidate, 'kill-session', 800)
  host.disconnect()
  await reconnecting
  await killed

  host = await connect(hostAccount)
  const resumed = once(candidate, 'host-resumed')
  const renegotiate = once(host, 'controller-joined', ({ controllerId }) => controllerId === candidate.id)
  host.emit('resume-host', { roomId: roomCode })
  assert.equal((await once(host, 'room-created')).roomCode, roomCode)
  await resumed
  await renegotiate

  // Controller connection drops and comes back: approved again with its permission, no host prompt
  candidate.disconnect()
  await once(host, 'controller-left')
  candidate = await connect(candAccount)
  const noPrompt = noEvent(host, 'connection-request', 800)
  candidate.emit('join-room', roomCode, 'controller', { name: 'GraceCand' })
  assert.equal((await once(candidate, 'join-approved')).permission, 'keyboard')
  await noPrompt

  // Leaving on purpose gives the seat up: the next join asks the host again
  candidate.emit('leave-session')
  await once(host, 'controller-left')
  candidate = await connect(candAccount)
  const prompt = once(host, 'connection-request')
  candidate.emit('join-room', roomCode, 'controller', { name: 'GraceCand' })
  await prompt

  // Someone else cannot take over a held room
  const intruder = await connect(user('Intruder'))
  intruder.emit('resume-host', { roomId: roomCode })
  await once(intruder, 'resume-failed')
})

test('an administrator cannot silently join a collaboration room', async () => {
  const host = await connect(user('CollabHost'))
  host.emit('create-room', { name: 'CollabHost', mode: 'collaboration' })
  const { roomCode } = await once(host, 'room-created')
  const admin = await connect(user('Watcher', 'admin'))
  const asked = once(host, 'admin-observation-request')
  const noState = noEvent(admin, 'session-state', 800)
  admin.emit('join-room', roomCode, 'admin', { name: 'Administrator' })
  await once(admin, 'observation-pending')
  assert.equal((await asked).observerId, admin.id)
  await noState // no room state (participants, chat, E2E roster) before the host agrees

  const granted = once(admin, 'observation-granted')
  host.emit('respond-observation', { observerId: admin.id, approved: true }, roomCode)
  assert.equal((await granted).roomCode, roomCode)
})

test('Code Black needs the room code and a reason, and is anchored', async () => {
  const { host, roomCode } = await supervisedRoom(1)
  const admin = await connect(user('Purger', 'admin'))
  admin.emit('secret-delete-recordings', { roomId: roomCode })
  assert.match(await once(admin, 'admin-error'), /refused/)
  admin.emit('secret-delete-recordings', { roomId: roomCode, confirmCode: 'WRONG', reason: 'privacy request' })
  assert.match(await once(admin, 'admin-error'), /refused/)

  const anchored = once(host, 'chain-log', entry => entry.type === 'evidence_purged')
  admin.emit('secret-delete-recordings', { roomId: roomCode, confirmCode: roomCode.toLowerCase(), reason: 'privacy request' })
  assert.match((await once(admin, 'admin-action-complete')).message, /Purged \d+ evidence item/)
  await anchored
})

test('session verification checks the signed audit chain even without a blockchain', async () => {
  const { host, controllers: [candidate], roomCode } = await supervisedRoom(1)
  host.emit('permission-violation', { roomCode, controllerId: candidate.id, action: 'Alt+Tab' })
  await new Promise(resolve => setTimeout(resolve, 200))
  const admin = user('Auditor', 'admin')
  const res = await fetch(`${baseUrl}/api/sessions/${roomCode}/verify`, { headers: { Authorization: `Bearer ${admin.token}` } })
  const report = await res.json()
  assert.equal(res.status, 200)
  assert.equal(report.signedChain.status, 'intact')
  assert.ok(report.signedChain.length >= 3) // ROOM_CREATED, USER_JOINED, PERMISSION_VIOLATION
  assert.equal(report.intact, true)

  const key = await (await fetch(`${baseUrl}/api/audit/public-key`)).json()
  assert.equal(key.keyId, report.signedChain.keyId)
  assert.match(key.publicKey, /BEGIN PUBLIC KEY/)
})

test('a flood of socket events from one connection is cut off, then it recovers', async () => {
  const flooder = await connect(user('Flooder'))
  let answered = 0
  flooder.on('sessions-count', () => { answered += 1 })
  const limited = once(flooder, 'rate-limited')
  for (let i = 0; i < 1500; i++) flooder.emit('get-session-count')
  await limited
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.ok(answered < 1000, `answered ${answered} of 1500`)

  await new Promise(resolve => setTimeout(resolve, 1500)) // the bucket refills
  const again = once(flooder, 'sessions-count')
  flooder.emit('get-session-count')
  await again
})

test('malformed events from any socket do not crash the server', async () => {
  const { host, roomCode } = await supervisedRoom(1)
  const stranger = await connect(user('Stranger'))
  for (const event of ['accept-role-swap', 'reject-role-swap', 'request-role-swap', 'controller-draft-answer', 'admin-warn-user', 'secret-delete-recordings']) {
    stranger.emit(event)
    stranger.emit(event, null)
  }
  host.emit('access-granted', 'view', null, roomCode)
  await new Promise(resolve => setTimeout(resolve, 300))
  // The server is still alive and serving rooms
  const probe = await connect(user('Probe'))
  probe.emit('create-room', { name: 'Probe', mode: 'collaboration' })
  assert.match((await once(probe, 'room-created')).roomCode, /^[A-Z0-9]{4,}$/)
})

test('an admin false-positive verdict reaches the device as a training label', async () => {
  const { controllers, roomCode } = await supervisedRoom(1)
  const adminAccount = user('Reviewer', 'admin')
  const admin = await connect(adminAccount)
  await new Promise(resolve => setTimeout(resolve, 300)) // admin socket joins the admins room asynchronously

  const live = once(admin, 'system-alert', payload => payload.room === roomCode)
  controllers[0].emit('system-alert', { room: roomCode, type: 'anticheat_violation', event: 'NO_FACE', message: 'No face', penalty: 10, features: [1, 0.8, 0.15] })
  const alert = await live
  assert.ok(alert._id, 'live alerts carry their stored id')

  const correction = once(controllers[0], 'fl-label-correction')
  const res = await fetch(`${baseUrl}/api/admin/alerts/${alert._id}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAccount.token}` },
    body: JSON.stringify({ falsePositive: true }),
  })
  assert.equal((await res.json()).labelSent, true)
  const label = await correction
  assert.deepEqual(label.features, [1, 0.8, 0.15])
  assert.equal(label.label, 0)
})

test('exam answer keys never reach candidates and grading happens on the server', async () => {
  const { host, controllers, roomCode } = await supervisedRoom(1)
  const candidate = controllers[0]

  // A candidate cannot push questions to the room
  candidate.emit('host-push-question', { id: 'fake', type: 'freeform', prompt: 'Injected', roomId: roomCode })
  await noEvent(candidate, 'new-exam-question')

  const received = once(candidate, 'new-exam-question')
  host.emit('host-push-question', { id: 'q1', type: 'mc', prompt: '2 + 2?', options: ['3', '4'], answerKey: '4', roomId: roomCode })
  const question = await received
  assert.equal(question.id, 'q1')
  assert.equal(question.answerKey, undefined, 'answer key is stripped for candidates')

  const result = once(candidate, 'exam-answer-result')
  const hostView = once(host, 'host-live-answer-update', update => update.answer?.isFinal)
  candidate.emit('controller-submit-answer', { questionId: 'q1', answer: { text: '4' }, roomId: roomCode })
  assert.deepEqual(await result, { questionId: 'q1', correct: true })
  assert.equal((await hostView).answer.correct, true)

  // A submitted answer is final, and the question is not re-sent in later room state
  candidate.emit('controller-submit-answer', { questionId: 'q1', answer: { text: '3' }, roomId: roomCode })
  await noEvent(candidate, 'exam-answer-result')
  const state = once(candidate, 'session-state')
  host.emit('access-granted', 'view', {}, roomCode)
  assert.deepEqual((await state).examQuestions, [])
})

test('a freeform answer padded with guesses is not graded correct', async () => {
  const { host, controllers: [candidate], roomCode } = await supervisedRoom(1)
  const received = once(candidate, 'new-exam-question')
  host.emit('host-push-question', { id: 'cap', type: 'freeform', prompt: 'Capital of France?', answerKey: 'paris|city of paris', roomId: roomCode })
  await received
  const result = once(candidate, 'exam-answer-result')
  candidate.emit('controller-submit-answer', { questionId: 'cap', answer: { text: 'london paris berlin rome' }, roomId: roomCode })
  assert.deepEqual(await result, { questionId: 'cap', correct: false })
})

test('a 2 MB voice answer is delivered instead of dropping the connection', async () => {
  const { host, controllers: [candidate], roomCode } = await supervisedRoom(1)
  const received = once(candidate, 'new-exam-question')
  host.emit('host-push-question', { id: 'voice', type: 'freeform', prompt: 'Explain aloud', roomId: roomCode })
  await received
  const disconnected = noEvent(candidate, 'disconnect', 1500)
  const hostView = once(host, 'host-live-answer-update', update => update.questionId === 'voice')
  candidate.emit('controller-submit-answer', { questionId: 'voice', answer: { text: '', audio: `data:audio/webm;base64,${'A'.repeat(2 * 1024 * 1024)}` }, roomId: roomCode })
  assert.ok((await hostView).answer.audio.length > 2 * 1024 * 1024)
  await disconnected
})

test('a controller cannot write draft answers into another room', async () => {
  const roomA = await supervisedRoom(1)
  const roomB = await supervisedRoom(1)
  const received = once(roomB.controllers[0], 'new-exam-question')
  roomB.host.emit('host-push-question', { id: 'qb', type: 'freeform', prompt: 'B only', roomId: roomB.roomCode })
  await received
  const injected = noEvent(roomB.host, 'host-live-answer-update', 800)
  roomA.controllers[0].emit('controller-draft-answer', { questionId: 'qb', answer: { text: 'injected' }, roomId: roomB.roomCode })
  await injected
})

test('TURN relay credentials are only issued to signed-in users', async () => {
  process.env.TURN_URLS = 'turn:turn.example.test:3478'
  process.env.TURN_SECRET = 'realtime-test-turn-secret'
  try {
    const anonymous = await (await fetch(`${baseUrl}/api/turn/credentials`)).json()
    assert.ok(anonymous.every(server => !JSON.stringify(server.urls).includes('turn:')), 'no relay for anonymous callers')
    const signedIn = await (await fetch(`${baseUrl}/api/turn/credentials`, { headers: { Authorization: `Bearer ${user('TurnUser').token}` } })).json()
    assert.ok(signedIn.some(server => JSON.stringify(server.urls).includes('turn:') && server.credential))
  } finally {
    delete process.env.TURN_URLS
    delete process.env.TURN_SECRET
  }
})

test('a host connection that opens a second room closes the first instead of orphaning it', async () => {
  const { host, controllers: [candidate], roomCode } = await supervisedRoom(1)
  const ended = once(candidate, 'kill-session')
  host.emit('create-room', { name: 'Host', mode: 'collaboration' })
  const { roomCode: second } = await once(host, 'room-created')
  assert.notEqual(second, roomCode)
  await ended

  // ...and a hosting connection cannot quietly become a controller elsewhere
  const other = await supervisedRoom(0)
  host.emit('join-room', other.roomCode, 'controller', { name: 'Host' })
  assert.match((await once(host, 'join-denied')).reason, /hosting/)
})

test('evidence uploads are not publicly readable', async () => {
  const res = await fetch(`${baseUrl}/uploads/evidence/anything.png`)
  assert.equal(res.status, 403)
})

test('violation evidence must be an image or video from a member of the room', async () => {
  const host = await connect(user('EvidenceHost'))
  host.emit('create-room', { name: 'EvidenceHost', mode: 'supervised' })
  const { roomCode } = await once(host, 'room-created')
  const member = user('EvidenceCand')
  const candidate = await connect(member)
  candidate.emit('join-room', roomCode, 'controller', { name: 'EvidenceCand' })
  await once(host, 'connection-request')
  host.emit('respond-join', { controllerId: candidate.id, approved: true, permission: 'view' }, roomCode)
  await once(candidate, 'join-approved')

  const upload = (token, type, name) => {
    const form = new FormData()
    form.append('evidenceFile', new Blob(['<script>alert(1)</script>'], { type }), name)
    form.append('roomCode', roomCode)
    return fetch(`${baseUrl}/api/admin/upload-violation-screenshot`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  }
  const outsider = user('Outsider')
  assert.equal((await upload(outsider.token, 'image/png', 'shot.png')).status, 403)
  assert.equal((await upload(outsider.token, 'text/html', 'evil.html')).status, 415)
  assert.equal((await upload(outsider.token, 'image/svg+xml', 'evil.svg')).status, 415)

  // A member's PNG is stored under a server-chosen name, whatever the client called it
  const ok = await upload(member.token, 'image/png', '../../evil.html')
  assert.equal(ok.status, 200)
  assert.match((await ok.json()).url, /^\/uploads\/evidence\/\d+-[0-9a-f-]{36}\.png$/)
})
