// Exam rules without sockets: grading, time limits, closing, manual review, scores, and the client helpers.
// Run: node --test tests/exam.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { loadTs, repoRoot } from './helpers/loadTs.mjs'

const require = createRequire(path.join(repoRoot, 'server', 'index.js'))
const exam = require('./exam.js')
const client = await loadTs('lib/examClient.ts')

const T0 = 1_000_000

function room(questions = []) {
  return {
    hostSocketId: 'host',
    controllers: new Map([['c1', { name: 'Ana', email: 'ana@test.local' }], ['c2', { name: 'Ben', email: 'ben@test.local' }]]),
    exam: { questions, answers: {} },
  }
}

const q = (payload, now = T0) => exam.sanitizeExamQuestion({ prompt: 'Q?', ...payload }, now)

test('text and multiple-choice answers are graded exactly, polls never', () => {
  const freeform = q({ id: 'f', type: 'freeform', answerKey: 'paris|city of paris' })
  assert.equal(exam.gradeExamAnswer(freeform, { text: '  Paris. ' }), true)
  assert.equal(exam.gradeExamAnswer(freeform, { text: 'City of  PARIS' }), true)
  assert.equal(exam.gradeExamAnswer(freeform, { text: 'london paris' }), false)
  const mc = q({ id: 'm', type: 'mc', options: ['3', '4'], answerKey: '4' })
  assert.equal(exam.gradeExamAnswer(mc, { text: '4' }), true)
  assert.equal(exam.gradeExamAnswer(mc, { text: '3' }), false)
  const poll = q({ id: 'p', type: 'poll', options: ['a', 'b'], answerKey: 'a' })
  assert.equal(poll.answerKey, undefined, 'a poll has no key')
  assert.equal(exam.gradeExamAnswer(poll, { text: 'a' }), null)
  assert.equal(exam.gradeExamAnswer(q({ id: 'n', type: 'freeform' }), { text: 'x' }), null)
})

test('code is never passed on the output the candidate reports', () => {
  const code = q({ id: 'c', type: 'code', language: 'python', answerKey: '42' })
  assert.equal(exam.gradeExamAnswer(code, { text: 'print(1)', output: '42' }), null)
  const r = room([code])
  const result = exam.submitExamAnswer(r, 'c', 'c1', { text: 'print(1)', output: '42' }, r.controllers.get('c1'), T0 + 1000)
  assert.equal(result.ok, true)
  assert.equal(result.entry.correct, null)
  assert.equal(result.entry.needsReview, true)
  assert.deepEqual(exam.examScores(r), [{ email: 'ana@test.local', given: 0, maximum: 1, pending: true }])
  // The host reviews it
  assert.ok(exam.gradeExamManually(r, 'c', 'c1', true))
  assert.deepEqual(exam.examScores(r), [{ email: 'ana@test.local', given: 1, maximum: 1, pending: false }])
})

test('questions are validated: choices need two options, time limits are bounded', () => {
  assert.equal(q({ id: 'm', type: 'mc', options: ['only one', ' '] }), null)
  assert.equal(q({ id: 'x', type: 'essay' }), null)
  assert.equal(q({ id: 'e', type: 'freeform', prompt: '   ' }), null)
  assert.equal(q({ id: 't', type: 'freeform', timeLimitSec: 3 }).timeLimitSec, exam.MIN_TIME_LIMIT_SEC)
  assert.equal(q({ id: 't', type: 'freeform', timeLimitSec: 999999 }).timeLimitSec, exam.MAX_TIME_LIMIT_SEC)
  assert.equal(q({ id: 't', type: 'freeform', timeLimitSec: 'soon' }).deadline, null)
  // The deadline comes from the server clock, never from the payload
  const timed = q({ id: 't', type: 'freeform', timeLimitSec: 60, deadline: 1, sentAt: 1 })
  assert.equal(timed.deadline, T0 + 60_000)
  assert.equal(timed.sentAt, T0)
})

test('candidates get time left and never the key; the host gets everything', () => {
  const timed = q({ id: 't', type: 'freeform', timeLimitSec: 60, answerKey: 'k', voicePrompt: 'data:audio/webm;base64,AAAA' })
  const pub = exam.publicExamQuestion(timed, T0 + 15_000)
  assert.equal(pub.answerKey, undefined)
  assert.equal(pub.deadline, undefined)
  assert.equal(pub.remainingMs, 45_000)
  assert.equal(pub.closed, false)
  const r = room([timed])
  const [forCandidate] = exam.examQuestionsFor(r, { id: 'c1' }, T0)
  assert.equal(forCandidate.voicePrompt, undefined, 'room state leaves voice prompts out')
  assert.equal(forCandidate.hasVoicePrompt, true)
  const [forHost] = exam.examQuestionsFor(r, { id: 'host' }, T0)
  assert.equal(forHost.answerKey, 'k')
  assert.deepEqual(exam.examQuestionsFor(r, { id: 'c1' }, T0 + 60_000 + exam.EXAM_GRACE_MS + 1), [], 'a timed-out question is gone for candidates')
})

test('a submission inside the grace window counts; a late one is refused and the draft is submitted', () => {
  const timed = q({ id: 't', type: 'freeform', timeLimitSec: 60, answerKey: 'yes' })
  const r = room([timed])
  assert.equal(exam.recordExamDraft(r, 't', 'c1', { text: 'yes' }, r.controllers.get('c1'), T0 + 10_000).ok, true)
  assert.equal(exam.recordExamDraft(r, 't', 'c2', { text: 'no' }, r.controllers.get('c2'), T0 + 10_000).ok, true)

  const onTime = exam.submitExamAnswer(r, 't', 'c2', { text: 'yes' }, r.controllers.get('c2'), T0 + 60_000 + 1000)
  assert.equal(onTime.ok, true)
  assert.equal(onTime.entry.correct, true)

  const late = exam.submitExamAnswer(r, 't', 'c1', { text: 'changed my mind' }, r.controllers.get('c1'), T0 + 60_000 + exam.EXAM_GRACE_MS + 1)
  assert.equal(late.ok, false)
  assert.equal(late.reason, 'closed')
  assert.equal(late.finalised.length, 1)
  const kept = r.exam.answers.t.c1
  assert.equal(kept.text, 'yes', 'the last saved draft, not the late answer')
  assert.equal(kept.isFinal, true)
  assert.equal(kept.autoSubmitted, true)
  assert.equal(kept.correct, true)
  // Drafts are refused too once it is closed, and a second submission never replaces the first
  assert.equal(exam.recordExamDraft(r, 't', 'c1', { text: 'x' }, null, T0 + 70_000).ok, false)
  assert.equal(exam.submitExamAnswer(r, 't', 'c2', { text: 'no' }, null, T0 + 20_000).reason, 'final')
})

test('closing a question finalises drafts once; the end of the session closes the rest', () => {
  const a = q({ id: 'a', type: 'freeform', answerKey: 'x' })
  const b = q({ id: 'b', type: 'mc', options: ['1', '2'], answerKey: '2' })
  const r = room([a, b])
  exam.recordExamDraft(r, 'a', 'c1', { text: 'x' }, r.controllers.get('c1'), T0)
  exam.recordExamDraft(r, 'b', 'c1', { text: '2' }, r.controllers.get('c1'), T0)
  const closed = exam.closeExamQuestion(r, 'a', T0 + 5)
  assert.equal(closed.length, 1)
  assert.equal(exam.closeExamQuestion(r, 'a', T0 + 6), null, 'already closed')
  assert.equal(exam.isQuestionOpen(a, T0 + 7), false)
  const rest = exam.finalizeOpenExam(r, T0 + 10)
  assert.deepEqual(rest.map(([questionId, controllerId]) => [questionId, controllerId]), [['b', 'c1']])
  assert.deepEqual(exam.examScores(r), [{ email: 'ana@test.local', given: 2, maximum: 2, pending: false }])
})

test('a reconnecting candidate gets its draft and results; the host gets every answer', () => {
  const a = q({ id: 'a', type: 'freeform', answerKey: 'x' })
  const b = q({ id: 'b', type: 'code', language: 'python', starterCode: 'pass' })
  const r = room([a, b])
  exam.submitExamAnswer(r, 'a', 'old', { text: 'x' }, r.controllers.get('c1'), T0)
  exam.recordExamDraft(r, 'b', 'old', { text: 'print(1)', audio: 'data:a' }, r.controllers.get('c1'), T0)
  exam.moveExamAnswers(r, 'old', 'c1')
  const candidate = exam.examStateFor(r, { id: 'c1' }, T0 + 1)
  assert.deepEqual(candidate.results, { a: true })
  assert.deepEqual(candidate.questions.map(question => question.id), ['b'])
  assert.equal(candidate.questions[0].draft.text, 'print(1)')
  assert.equal(candidate.questions[0].answerKey, undefined)
  const host = exam.examStateFor(r, { id: 'host' }, T0 + 1)
  assert.equal(host.questions.length, 2)
  assert.equal(host.answers.a.c1.controllerName, 'Ana')
  assert.equal(host.answers.b.c1.audio, 'data:a')
})

test('client: deadlines are local, merges keep voice prompts, the countdown formats', () => {
  const received = client.withLocalDeadline({ id: 'q', type: 'freeform', prompt: 'p', remainingMs: 5000 }, 100)
  assert.equal(received.endsAt, 5100)
  assert.equal(client.secondsLeft(received, 100), 5)
  assert.equal(client.secondsLeft(received, 6000), 0)
  assert.equal(client.secondsLeft({ endsAt: null }, 0), null)
  const merged = client.mergeExamQuestions(
    [{ id: 'q', type: 'freeform', prompt: 'p', voicePrompt: 'data:v', endsAt: 5100 }],
    [{ id: 'q', type: 'freeform', prompt: 'p', hasVoicePrompt: true, remainingMs: 5000 }],
    1000,
  )
  assert.equal(merged[0].voicePrompt, 'data:v')
  assert.equal(merged[0].endsAt, 5100, 'the earlier local deadline wins')
  assert.deepEqual(client.mergeExamQuestions([{ id: 'gone' }], []), [])
  assert.equal(client.formatCountdown(65), '1:05')
  assert.equal(client.formatCountdown(3725), '1:02:05')
})

test('client: results rows, scores and a CSV that spreadsheets cannot execute', () => {
  const questions = [
    { id: 'a', type: 'freeform', prompt: 'Capital?', answerKey: 'paris' },
    { id: 'b', type: 'code', prompt: 'Print 42', answerKey: '42' },
    { id: 'p', type: 'poll', prompt: 'Fun?', options: ['yes', 'no'] },
  ]
  const answers = {
    a: { c1: { text: '=HYPERLINK("x")', isFinal: true, correct: false, controllerName: 'Ana', email: 'ana@test.local' } },
    b: { c1: { text: 'print(42)', isFinal: true, correct: null, needsReview: true, controllerName: 'Ana' } },
    p: { c1: { text: 'yes', isFinal: true, correct: null, controllerName: 'Ana' }, c2: { text: 'yes', isFinal: false, controllerName: 'Ben' } },
  }
  const rows = client.examResultRows(questions, answers)
  assert.deepEqual(rows.map(row => [row.name, row.correct, row.pending]), [['Ana', 0, 1], ['Ben', 0, 0]])
  assert.deepEqual(rows[0].statuses, { a: 'wrong', b: 'review', p: 'submitted' })
  assert.equal(client.gradedQuestionCount(questions, answers), 2)
  assert.deepEqual(client.optionTally(questions[2], answers), { yes: 2, no: 0 })
  const csv = client.examResultsCsv(questions, answers)
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/)
  assert.equal(csv.split('\r\n').length, 5)
})

test('client: code runs report "not enabled" instead of a sandbox error', async () => {
  const disabled = await client.runExamCode('python', 'print(1)', async () => new Response(JSON.stringify({ run: { output: '', stderr: 'x' }, disabled: true }), { status: 403 }))
  assert.deepEqual(disabled, { output: client.CODE_EXECUTION_DISABLED, available: false })
  const missing = await client.runExamCode('python', 'print(1)', async () => new Response('<html>404</html>', { status: 404 }))
  assert.equal(missing.available, false)
  const offline = await client.runExamCode('python', 'print(1)', async () => { throw new TypeError('Failed to fetch') })
  assert.equal(offline.output, client.CODE_EXECUTION_DISABLED)
  const ran = await client.runExamCode('python', 'print(1)', async () => new Response(JSON.stringify({ run: { output: '1\n', stderr: '' } })))
  assert.deepEqual(ran, { output: '1\n', available: true })
})
