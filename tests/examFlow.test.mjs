// Exam flow against the real signaling server: closing questions, manual review of code, late
// submissions, and host / candidate reconnects that rebuild the exam view from the server's copy.
// Run: node --test tests/examFlow.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { repoRoot } from './helpers/loadTs.mjs'

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'exam_flow_test_jwt_secret_with_more_than_32_chars',
  MONGO_URI: 'mongodb://127.0.0.1:1/exam-flow-test',
  MONGO_CONNECT_TIMEOUT_MS: '250',
  RPC_URL: 'http://127.0.0.1:9',
  SEPOLIA_RPC_URL: 'http://127.0.0.1:9',
  CHAIN_RPC_URL: 'http://127.0.0.1:9',
  CONTRACT_ADDRESS: '',
  ALLOW_MOCK_BLOCKCHAIN: 'true',
  MOCK_STORE_FILE: path.join(os.tmpdir(), `drcsfa-examflow-${Date.now()}.json`),
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

function user(name) {
  const created = mockStore.createUser({ name, email: `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`, password: 'x', isVerified: true, role: 'user' })
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

async function supervisedRoom() {
  const hostAccount = user('Host')
  const candAccount = user('Cand')
  const host = await connect(hostAccount)
  host.emit('create-room', { name: 'Host', mode: 'supervised' })
  const { roomCode } = await once(host, 'room-created')
  const candidate = await connect(candAccount)
  candidate.emit('join-room', roomCode, 'controller', { name: 'Cand' })
  await once(host, 'connection-request')
  host.emit('respond-join', { controllerId: candidate.id, approved: true, permission: 'view' }, roomCode)
  await once(candidate, 'join-approved')
  return { host, candidate, roomCode, hostAccount, candAccount }
}

async function push(host, candidate, question) {
  const received = once(candidate, 'new-exam-question', q => q.id === question.id)
  host.emit('host-push-question', question)
  return received
}

test('code output reported by the candidate does not pass; the host reviews it', async () => {
  const { host, candidate, roomCode } = await supervisedRoom()
  await push(host, candidate, { id: 'code1', type: 'code', prompt: 'Print 42', language: 'python', answerKey: '42', roomId: roomCode })

  const noResult = noEvent(candidate, 'exam-answer-result', 800)
  const submitted = once(host, 'host-live-answer-update', update => update.answer?.isFinal)
  candidate.emit('controller-submit-answer', { questionId: 'code1', answer: { text: 'print(1)', output: '42' }, roomId: roomCode })
  const { answer } = await submitted
  assert.equal(answer.correct, null)
  assert.equal(answer.needsReview, true)
  await noResult

  // Only the host can mark it
  candidate.emit('host-grade-answer', { questionId: 'code1', controllerId: candidate.id, correct: true, roomId: roomCode })
  await noEvent(candidate, 'exam-answer-result', 500)
  const result = once(candidate, 'exam-answer-result')
  const hostView = once(host, 'host-live-answer-update', update => update.answer?.gradedBy === 'host')
  host.emit('host-grade-answer', { questionId: 'code1', controllerId: candidate.id, correct: false, roomId: roomCode })
  assert.deepEqual(await result, { questionId: 'code1', correct: false })
  assert.equal((await hostView).answer.needsReview, false)
})

test('the host closes a question: the draft is submitted and later answers are refused', async () => {
  const { host, candidate, roomCode } = await supervisedRoom()
  const pushed = await push(host, candidate, { id: 'cap', type: 'freeform', prompt: 'Capital of France?', answerKey: 'paris', timeLimitSec: 600, roomId: roomCode })
  assert.ok(pushed.remainingMs > 590_000 && pushed.remainingMs <= 600_000, 'time left is sent, not a server timestamp')
  assert.equal(pushed.deadline, undefined)

  const drafted = once(host, 'host-live-answer-update')
  candidate.emit('controller-draft-answer', { questionId: 'cap', answer: { text: 'Paris' }, roomId: roomCode })
  await drafted

  // Only the host can close it
  candidate.emit('host-close-question', { questionId: 'cap', roomId: roomCode })
  await noEvent(candidate, 'exam-question-closed', 500)

  const closed = once(candidate, 'exam-question-closed')
  const graded = once(candidate, 'exam-answer-result')
  const hostView = once(host, 'host-live-answer-update', update => update.answer?.autoSubmitted)
  const state = once(candidate, 'session-state')
  host.emit('host-close-question', { questionId: 'cap', roomId: roomCode })
  assert.deepEqual(await closed, { questionId: 'cap', reason: 'host' })
  assert.deepEqual(await graded, { questionId: 'cap', correct: true })
  assert.equal((await hostView).answer.text, 'Paris')
  assert.deepEqual((await state).examQuestions, [])

  const rejected = once(candidate, 'exam-submit-rejected')
  candidate.emit('controller-submit-answer', { questionId: 'cap', answer: { text: 'London' }, roomId: roomCode })
  assert.equal((await rejected).questionId, 'cap')
})

test('a host that reconnects gets every question and answer back', async () => {
  const { host: firstHost, candidate, roomCode, hostAccount } = await supervisedRoom()
  await push(firstHost, candidate, { id: 'mc1', type: 'mc', prompt: '2 + 2?', options: ['3', '4'], answerKey: '4', roomId: roomCode })
  await push(firstHost, candidate, { id: 'free', type: 'freeform', prompt: 'Why?', roomId: roomCode })
  const answered = once(firstHost, 'host-live-answer-update', update => update.answer?.isFinal)
  candidate.emit('controller-submit-answer', { questionId: 'mc1', answer: { text: '4' }, roomId: roomCode })
  await answered
  const drafted = once(firstHost, 'host-live-answer-update', update => update.questionId === 'free')
  candidate.emit('controller-draft-answer', { questionId: 'free', answer: { text: 'because' }, roomId: roomCode })
  await drafted

  const reconnecting = once(candidate, 'host-reconnecting')
  firstHost.disconnect()
  await reconnecting
  const host = await connect(hostAccount)
  const examState = once(host, 'exam-state')
  host.emit('resume-host', { roomId: roomCode })
  const exam = await examState
  assert.equal(exam.role, 'host')
  assert.deepEqual(exam.questions.map(q => q.id), ['mc1', 'free'])
  assert.equal(exam.questions[0].answerKey, '4')
  assert.equal(exam.answers.mc1[candidate.id].correct, true)
  assert.equal(exam.answers.mc1[candidate.id].controllerName, 'Cand')
  assert.equal(exam.answers.free[candidate.id].text, 'because')
  assert.equal(exam.answers.free[candidate.id].isFinal, false)
})

test('a candidate that reconnects mid-exam gets its draft and results back', async () => {
  const { host, candidate: first, roomCode, candAccount } = await supervisedRoom()
  await push(host, first, { id: 'done', type: 'freeform', prompt: 'One', answerKey: 'one', roomId: roomCode })
  await push(host, first, { id: 'open', type: 'code', prompt: 'Two', language: 'python', starterCode: 'pass', roomId: roomCode })
  const graded = once(first, 'exam-answer-result')
  first.emit('controller-submit-answer', { questionId: 'done', answer: { text: 'one' }, roomId: roomCode })
  await graded
  const drafted = once(host, 'host-live-answer-update', update => update.questionId === 'open')
  first.emit('controller-draft-answer', { questionId: 'open', answer: { text: 'print(2)' }, roomId: roomCode })
  await drafted

  first.disconnect()
  await once(host, 'controller-left')
  const candidate = await connect(candAccount)
  const examState = once(candidate, 'exam-state')
  candidate.emit('join-room', roomCode, 'controller', { name: 'Cand' })
  const exam = await examState
  assert.equal(exam.role, 'candidate')
  assert.deepEqual(exam.results, { done: true })
  assert.deepEqual(exam.questions.map(q => q.id), ['open'])
  assert.equal(exam.questions[0].draft.text, 'print(2)')

  // Still locked out of the question it already submitted
  candidate.emit('controller-submit-answer', { questionId: 'done', answer: { text: 'two' }, roomId: roomCode })
  await noEvent(candidate, 'exam-answer-result', 600)
})
