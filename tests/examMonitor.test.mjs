// Silent exam monitor: an administrator watches every candidate of a supervised exam without the
// host or the candidates being told, every start/stop is logged for admins only, and an admin
// message is the one visible action. In-process server, no database, mock chain.
// Run: node --test tests/examMonitor.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { repoRoot } from './helpers/loadTs.mjs'

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'monitor_test_jwt_secret_with_more_than_32_chars',
  MONGO_URI: 'mongodb://127.0.0.1:1/monitor-test',
  MONGO_CONNECT_TIMEOUT_MS: '250',
  RPC_URL: 'http://127.0.0.1:9',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:9',
  CHAIN_RPC_URL: 'http://127.0.0.1:9',
  CONTRACT_ADDRESS: '',
  ALLOW_MOCK_BLOCKCHAIN: 'true',
  MOCK_STORE_FILE: path.join(os.tmpdir(), `drcsfa-monitor-${Date.now()}.json`),
})

const require = createRequire(path.join(repoRoot, 'server', 'index.js'))
const { io: ioClient } = createRequire(path.join(repoRoot, 'package.json'))('socket.io-client')
const { server } = require('./index.js')
const mockStore = require('./mockStore.js')
const { signJwt } = require('./config.js')

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
  const created = mockStore.createUser({ name, email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`, password: 'x', isVerified: true, role })
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

const noEvent = (socket, event, wait = 700) => new Promise((resolve, reject) => {
  const handler = (...args) => reject(new Error(`unexpected ${event}: ${JSON.stringify(args).slice(0, 200)}`))
  socket.on(event, handler)
  setTimeout(() => { socket.off(event, handler); resolve() }, wait)
})

const ack = (socket, event, payload) => new Promise(resolve => socket.emit(event, payload, resolve))

async function room(mode, controllerCount) {
  const host = await connect(user('Host'))
  host.emit('create-room', { name: 'Host', mode })
  const { roomCode } = await once(host, 'room-created')
  const controllers = []
  for (let i = 0; i < controllerCount; i++) controllers.push(await addCandidate(host, roomCode, `Cand${i}`))
  return { host, controllers, roomCode }
}

async function addCandidate(host, roomCode, name) {
  const c = await connect(user(name))
  c.emit('join-room', roomCode, 'controller', { name })
  await once(host, 'connection-request')
  host.emit('respond-join', { controllerId: c.id, approved: true, permission: 'view' }, roomCode)
  await once(c, 'join-approved')
  return c
}

test('silent monitor: several candidate feeds, nothing shown to the host or candidates, admin-only log', async () => {
  const { host, controllers: [a, b], roomCode } = await room('supervised', 2)
  const admin = await connect(user('Admin', 'admin'))
  await new Promise(resolve => setTimeout(resolve, 300)) // settle join events

  const quiet = [noEvent(host, 'room-event', 1500), noEvent(host, 'session-state', 1500), noEvent(a, 'session-state', 1500), noEvent(b, 'session-state', 1500)]

  const reply = await ack(admin, 'monitor-exam', { roomId: roomCode })
  assert.equal(reply.ok, true)
  assert.equal(reply.roomId, roomCode)
  assert.deepEqual(reply.candidates.map(c => c.id).sort(), [a.id, b.id].sort())
  assert.ok(reply.candidates.every(c => typeof c.name === 'string' && 'email' in c))

  const requestedA = once(a, 'controller-observation-requested')
  const requestedB = once(b, 'controller-observation-requested')
  admin.emit('request-controller-observation', { roomId: roomCode, targetId: a.id, silent: true })
  admin.emit('request-controller-observation', { roomId: roomCode, targetId: b.id, silent: true })
  assert.deepEqual(await requestedA, { adminId: admin.id, silent: true })
  assert.deepEqual(await requestedB, { adminId: admin.id, silent: true })

  // Both feeds stay open at once: each candidate's offer and ICE reach the admin
  const offers = []
  admin.on('observer-offer', payload => offers.push(payload))
  a.emit('controller-observation-offer', { adminId: admin.id, offer: { type: 'offer', sdp: 'a' }, streams: { camera: 'cam-a', screen: 'scr-a' } })
  b.emit('controller-observation-offer', { adminId: admin.id, offer: { type: 'offer', sdp: 'b' } })
  const iceFromB = once(admin, 'observer-ice-candidate', p => p.fromId === b.id)
  b.emit('controller-observation-ice-candidate', { adminId: admin.id, candidate: { candidate: 'x' } })
  await iceFromB
  await new Promise(resolve => setTimeout(resolve, 200))
  const offerA = offers.find(o => o.hostId === a.id)
  assert.equal(offerA.targetType, 'controller')
  assert.deepEqual(offerA.streams, { camera: 'cam-a', screen: 'scr-a' })
  assert.ok(offers.find(o => o.hostId === b.id))

  // The answer reaches the right candidate
  const answered = once(a, 'observer-answer')
  admin.emit('observer-answer', { hostId: a.id, answer: { type: 'answer', sdp: 'ans' } })
  assert.equal((await answered).observerId, admin.id)

  // Ending one feed leaves the other running
  const endedA = once(a, 'controller-observation-ended')
  admin.emit('end-controller-observation', { targetId: a.id })
  await endedA
  const stillB = once(admin, 'observer-ice-candidate', p => p.fromId === b.id)
  b.emit('controller-observation-ice-candidate', { adminId: admin.id, candidate: { candidate: 'y' } })
  await stillB

  await Promise.all(quiet)

  // Accountability: admins see the monitoring log; the host's events never mention it
  admin.emit('get-sessions')
  const sessions = await once(admin, 'sessions-update', list => list.some(s => s.id === roomCode && s.monitorLog?.length >= 4))
  const session = sessions.find(s => s.id === roomCode)
  assert.deepEqual(session.monitorLog.map(e => e.action).slice(0, 4), ['monitor-started', 'feed-started', 'feed-started', 'feed-stopped'])
  assert.ok(session.events.every(e => !/administrator/i.test(e.message)))
  assert.equal(session.observerCount, 0)
})

test('silent monitor roster follows candidates joining and leaving', async () => {
  const { host, controllers: [a], roomCode } = await room('supervised', 1)
  const admin = await connect(user('Admin', 'admin'))
  const reply = await ack(admin, 'monitor-exam', { roomId: roomCode })
  assert.equal(reply.candidates.length, 1)

  const grown = once(admin, 'monitor-roster', p => p.roomId === roomCode && p.candidates.length === 2)
  const c = await addCandidate(host, roomCode, 'Late')
  assert.ok((await grown).candidates.some(x => x.id === c.id && x.name === 'Late'))

  const shrunk = once(admin, 'monitor-roster', p => p.roomId === roomCode && p.candidates.length === 1)
  a.disconnect()
  assert.equal((await shrunk).candidates[0].id, c.id)

  // After stop-monitor-exam no more rosters arrive
  admin.emit('stop-monitor-exam', { roomId: roomCode })
  await new Promise(resolve => setTimeout(resolve, 200))
  const silent = noEvent(admin, 'monitor-roster', 1000)
  await addCandidate(host, roomCode, 'Later')
  await silent
})

test('silent monitor is refused in collaboration rooms and for non-admins', async () => {
  const { roomCode } = await room('collaboration', 0)
  const admin = await connect(user('Admin', 'admin'))
  const collab = await ack(admin, 'monitor-exam', { roomId: roomCode })
  assert.equal(collab.ok, false)

  const exam = await room('supervised', 1)
  const outsider = await connect(user('Nosy'))
  const refused = await ack(outsider, 'monitor-exam', { roomId: exam.roomCode })
  assert.equal(refused.ok, false)
  const noRequest = noEvent(exam.controllers[0], 'controller-observation-requested', 800)
  outsider.emit('request-controller-observation', { roomId: exam.roomCode, targetId: exam.controllers[0].id, silent: true })
  await noRequest
})

test('an administrator message reaches the whole room as "Administrator"', async () => {
  const { host, controllers: [a], roomCode } = await room('supervised', 1)
  const admin = await connect(user('Admin', 'admin'))
  const atHost = once(host, 'admin-message')
  const atCandidate = once(a, 'admin-message')
  const reply = await ack(admin, 'admin-room-chat', { roomId: roomCode, text: `  ${'x'.repeat(1200)}  ` })
  assert.equal(reply.ok, true)
  const [h, c] = await Promise.all([atHost, atCandidate])
  assert.equal(h.senderName, 'Administrator')
  assert.equal(h.roomId, roomCode)
  assert.equal(h.text.length, 1000)
  assert.equal(c.id, reply.id)

  const empty = await ack(admin, 'admin-room-chat', { roomId: roomCode, text: '   ' })
  assert.equal(empty.ok, false)
  const outsider = await connect(user('Nosy'))
  const refused = await ack(outsider, 'admin-room-chat', { roomId: roomCode, text: 'hi' })
  assert.equal(refused.ok, false)
})
