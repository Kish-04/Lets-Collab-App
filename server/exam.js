// Exam questions and answers: sanitising, grading, time limits, what candidates see, archiving and scores.
// Everything here is pure (no sockets): server/index.js wires it to the exam events.

// ── Exams ──────────────────────────────────────────────────────────────────────
const EXAM_TYPES = new Set(['freeform', 'mc', 'poll', 'code']);
// A submission sent just before the deadline still counts if it arrives within this window
const EXAM_GRACE_MS = 3000;
const MIN_TIME_LIMIT_SEC = 10;
const MAX_TIME_LIMIT_SEC = 4 * 60 * 60;

const clampText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : undefined);

function normalizeTimeLimit(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(MAX_TIME_LIMIT_SEC, Math.max(MIN_TIME_LIMIT_SEC, seconds));
}

// The host's question as the server keeps it. sentAt/deadline/closedAt are set here, never taken from
// the payload, so the host's clock does not matter.
function sanitizeExamQuestion(payload = {}, now = Date.now()) {
  const id = clampText(payload.id, 100);
  if (!id || !EXAM_TYPES.has(payload.type) || typeof payload.prompt !== 'string' || !payload.prompt.trim()) return null;
  const options = Array.isArray(payload.options)
    ? payload.options.slice(0, 20).map(o => String(o).slice(0, 500).trim()).filter(Boolean)
    : undefined;
  // A choice question needs at least two choices to be answerable
  if ((payload.type === 'mc' || payload.type === 'poll') && (!options || options.length < 2)) return null;
  const timeLimitSec = normalizeTimeLimit(payload.timeLimitSec);
  return {
    id,
    type: payload.type,
    prompt: payload.prompt.slice(0, 5000),
    options: payload.type === 'mc' || payload.type === 'poll' ? options : undefined,
    language: payload.type === 'code' ? clampText(payload.language, 40) : undefined,
    starterCode: payload.type === 'code' ? clampText(payload.starterCode, 20000) : undefined,
    voicePrompt: clampText(payload.voicePrompt, 3 * 1024 * 1024),
    // A poll has no right answer
    answerKey: payload.type === 'poll' ? undefined : (clampText(payload.answerKey, 2000) || '').trim() || undefined,
    timeLimitSec,
    sentAt: now,
    deadline: timeLimitSec ? now + timeLimitSec * 1000 : null,
    closedAt: null,
  };
}

/** Open = not closed by the host and not past its deadline (plus the grace window). */
function isQuestionOpen(question, now = Date.now()) {
  if (!question || question.closedAt) return false;
  return !question.deadline || now <= question.deadline + EXAM_GRACE_MS;
}

function remainingMs(question, now = Date.now()) {
  if (!question.deadline) return null;
  if (question.closedAt) return 0;
  return Math.max(0, question.deadline - now);
}

// What candidates receive: never the answer key, and time as "milliseconds left" (clock-skew free)
function publicExamQuestion(question, now = Date.now()) {
  const { answerKey, sentAt, deadline, closedAt, ...rest } = question;
  return { ...rest, remainingMs: remainingMs(question, now), closed: !isQuestionOpen(question, now) };
}

// What the host receives: everything, plus the same timing fields
function hostExamQuestion(question, now = Date.now()) {
  return { ...question, remainingMs: remainingMs(question, now), closed: !isQuestionOpen(question, now) };
}

// Room state is sent on every room event: voice prompts (up to 3 MB each) are left out of it and
// delivered once (new-exam-question / exam-state). The client keeps the copy it already has.
function withoutVoice(question) {
  if (!question.voicePrompt) return question;
  const { voicePrompt, ...rest } = question;
  return { ...rest, hasVoicePrompt: true };
}

function sanitizeExamAnswer(answer = {}) {
  const source = answer && typeof answer === 'object' ? answer : {};
  return {
    text: clampText(source.text, 50000),
    options: Array.isArray(source.options) ? source.options.slice(0, 20).map(o => String(o).slice(0, 500)) : undefined,
    audio: clampText(source.audio, 5 * 1024 * 1024),
    // Output of a run in the candidate's own session: shown to the host, never used for grading
    output: clampText(source.output, 20000),
  };
}

/** Server-side grading (the candidate never sees the key); null when it cannot be graded automatically. */
// Answers are compared exactly after normalising case, whitespace and trailing punctuation; a key may
// list accepted alternatives separated by "|" (e.g. "paris|city of paris"). Substring matching let a
// candidate pass by padding the answer with guesses.
function normalizeExamText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;,]+$/, '').trim();
}

function gradeExamAnswer(question, answer) {
  if (!question || !question.answerKey || question.type === 'poll') return null;
  // Code is not run on the server and the "output" field is whatever the candidate's browser sent,
  // so it is never trusted for a pass: code with a key waits for the host's review.
  if (question.type === 'code') return null;
  const accepted = String(question.answerKey).split('|').map(normalizeExamText).filter(Boolean);
  if (accepted.length === 0) return null;
  return accepted.includes(normalizeExamText(answer?.text));
}

/** A final answer to a keyed question that the server could not grade (code): the host decides. */
function needsReview(question, entry) {
  return Boolean(question && question.answerKey && question.type !== 'poll' && entry?.isFinal && (entry.correct === null || entry.correct === undefined));
}

function answersFor(room, questionId) {
  if (!room.exam.answers[questionId]) room.exam.answers[questionId] = {};
  return room.exam.answers[questionId];
}

function participantFields(participant, previous) {
  return {
    controllerName: participant?.name || previous?.controllerName || 'Unknown',
    email: participant?.email || previous?.email || undefined,
  };
}

function finalise(question, entry, now, extra = {}) {
  const correct = gradeExamAnswer(question, entry);
  const finalEntry = { ...entry, isFinal: true, correct, submittedAt: now, timestamp: now, ...extra };
  finalEntry.needsReview = needsReview(question, finalEntry);
  return finalEntry;
}

/**
 * A candidate's draft (sent while typing). Returns { ok, entry, audioChanged } or { ok: false, reason }.
 * No audio field keeps the stored recording; audio: null removes it.
 */
function recordExamDraft(room, questionId, controllerId, rawAnswer, participant, now = Date.now()) {
  const question = room.exam?.questions.find(q => q.id === questionId);
  if (!question) return { ok: false, reason: 'unknown' };
  if (!isQuestionOpen(question, now)) return { ok: false, reason: 'closed' };
  const answers = answersFor(room, questionId);
  const previous = answers[controllerId];
  if (previous?.isFinal) return { ok: false, reason: 'final' };
  const audioChanged = Object.prototype.hasOwnProperty.call(rawAnswer || {}, 'audio');
  const draft = sanitizeExamAnswer(rawAnswer);
  answers[controllerId] = {
    ...draft,
    audio: audioChanged ? draft.audio : previous?.audio,
    ...participantFields(participant, previous),
    isFinal: false,
    timestamp: now,
  };
  return { ok: true, entry: answers[controllerId], audioChanged };
}

/**
 * A candidate's final answer. One submission per question; after the time limit (plus grace) it is
 * refused and the last saved draft is submitted instead (reason 'closed', finalised lists those).
 */
function submitExamAnswer(room, questionId, controllerId, rawAnswer, participant, now = Date.now()) {
  const question = room.exam?.questions.find(q => q.id === questionId);
  if (!question) return { ok: false, reason: 'unknown' };
  const answers = answersFor(room, questionId);
  // An answer submitted for the candidate when the question closed counts as 'closed' (too late)
  if (answers[controllerId]?.isFinal) return { ok: false, reason: answers[controllerId].autoSubmitted ? 'closed' : 'final', finalised: [] };
  if (!isQuestionOpen(question, now)) {
    return { ok: false, reason: 'closed', finalised: closeExamQuestion(room, questionId, now) || [] };
  }
  const previous = answers[controllerId];
  const answer = sanitizeExamAnswer(rawAnswer);
  // A submit without a new recording keeps the one already saved with the draft
  if (!Object.prototype.hasOwnProperty.call(rawAnswer || {}, 'audio')) answer.audio = previous?.audio;
  answers[controllerId] = finalise(question, { ...answer, ...participantFields(participant, previous) }, now);
  return { ok: true, entry: answers[controllerId], question };
}

/**
 * Closes a question (host action or time limit): every open draft becomes the final answer, marked
 * autoSubmitted. Returns [[controllerId, entry], ...] for those, or null if it was already closed.
 */
function closeExamQuestion(room, questionId, now = Date.now()) {
  const question = room.exam?.questions.find(q => q.id === questionId);
  if (!question || question.closedAt) return null;
  question.closedAt = question.deadline && now > question.deadline ? Math.min(now, question.deadline + EXAM_GRACE_MS) : now;
  const answers = answersFor(room, questionId);
  const finalised = [];
  Object.entries(answers).forEach(([controllerId, entry]) => {
    if (!entry || entry.isFinal) return;
    answers[controllerId] = finalise(question, entry, now, { autoSubmitted: true });
    finalised.push([controllerId, answers[controllerId]]);
  });
  return finalised;
}

/** Closes every question still open (end of the session), so drafts count in the scores. */
function finalizeOpenExam(room, now = Date.now()) {
  const finalised = [];
  (room.exam?.questions || []).forEach((question) => {
    if (question.closedAt) return;
    const done = closeExamQuestion(room, question.id, now);
    if (done) finalised.push(...done.map(([controllerId, entry]) => [question.id, controllerId, entry]));
  });
  return finalised;
}

/** The host marks a submitted answer right or wrong (code review, or overriding the key). */
function gradeExamManually(room, questionId, controllerId, correct) {
  const question = room.exam?.questions.find(q => q.id === questionId);
  const entry = room.exam?.answers[questionId]?.[controllerId];
  if (!question || question.type === 'poll' || !entry?.isFinal || typeof correct !== 'boolean') return null;
  entry.correct = correct;
  entry.gradedBy = 'host';
  entry.needsReview = false;
  return entry;
}

// What is kept of an exam when the session is archived: questions with keys and every final answer,
// without bulky voice recordings
function examArchive(room) {
  const answers = {};
  Object.entries(room.exam?.answers || {}).forEach(([questionId, byController]) => {
    answers[questionId] = {};
    Object.entries(byController).forEach(([controllerId, entry]) => {
      const participant = room.controllers.get(controllerId);
      const { audio, ...rest } = entry || {};
      answers[questionId][controllerId] = {
        ...rest,
        hadAudio: Boolean(audio),
        name: participant?.name || rest.controllerName,
        email: participant?.email || rest.email,
      };
    });
  });
  return {
    questions: (room.exam?.questions || []).map(({ voicePrompt, ...question }) => question),
    answers,
  };
}

// Questions in room state: the host sees all of them (with keys); a candidate sees the open ones it
// has not submitted yet. Voice prompts are left out (see withoutVoice).
function examQuestionsFor(room, targetSocket, now = Date.now()) {
  const questions = room.exam?.questions || [];
  if (targetSocket?.id === room.hostSocketId) return questions.map(q => withoutVoice(hostExamQuestion(q, now)));
  return questions
    .filter(q => isQuestionOpen(q, now) && !room.exam.answers[q.id]?.[targetSocket?.id]?.isFinal)
    .map(q => withoutVoice(publicExamQuestion(q, now)));
}

/**
 * Everything one socket needs to rebuild its exam view after a reload or reconnect.
 * Host: every question and every candidate's latest answer. Candidate: its open questions with its
 * own saved draft, and the results of what it already submitted.
 */
function examStateFor(room, targetSocket, now = Date.now()) {
  const questions = room.exam?.questions || [];
  if (targetSocket?.id === room.hostSocketId) {
    const answers = {};
    Object.entries(room.exam?.answers || {}).forEach(([questionId, byController]) => {
      answers[questionId] = { ...byController };
    });
    return { role: 'host', questions: questions.map(q => hostExamQuestion(q, now)), answers };
  }
  const id = targetSocket?.id;
  const results = {};
  const open = [];
  questions.forEach((question) => {
    const entry = room.exam.answers[question.id]?.[id];
    if (entry?.isFinal) {
      if (typeof entry.correct === 'boolean') results[question.id] = entry.correct;
      return;
    }
    if (!isQuestionOpen(question, now)) return;
    const draft = entry ? { text: entry.text, options: entry.options, audio: entry.audio, output: entry.output } : undefined;
    open.push({ ...publicExamQuestion(question, now), draft });
  });
  return { role: 'candidate', questions: open, results };
}

function examSummary(room) {
  const answers = Object.values(room.exam?.answers || {});
  return {
    questions: (room.exam?.questions || []).length,
    drafts: answers.reduce((sum, byController) => sum + Object.values(byController).filter(a => !a?.isFinal).length, 0),
    submitted: answers.reduce((sum, byController) => sum + Object.values(byController).filter(a => a?.isFinal).length, 0),
  };
}

// Exam result per candidate: correct answers out of the graded questions (those with an answer key, or
// that the host marked by hand). pending = some answer still waits for the host's review.
function examScores(room) {
  const graded = (room.exam?.questions || []).filter(q => q.type !== 'poll' && (
    q.answerKey || Object.values(room.exam.answers[q.id] || {}).some(a => a?.gradedBy === 'host')
  ));
  if (graded.length === 0) return [];
  const byEmail = new Map();
  graded.forEach((question) => {
    Object.values(room.exam.answers[question.id] || {}).forEach((answer) => {
      if (!answer?.isFinal || !answer.email) return;
      const score = byEmail.get(answer.email) || { given: 0, pending: false };
      if (answer.correct === true) score.given += 1;
      if (needsReview(question, answer)) score.pending = true;
      byEmail.set(answer.email, score);
    });
  });
  return Array.from(byEmail.entries()).map(([email, { given, pending }]) => ({ email, given, maximum: graded.length, pending }));
}

// Exam answers are keyed by socket id; a reconnecting candidate keeps (and stays locked by) its own
function moveExamAnswers(room, fromId, toId) {
  if (!fromId || fromId === toId) return;
  Object.values(room.exam?.answers || {}).forEach((byController) => {
    if (!byController[fromId]) return;
    byController[toId] = byController[fromId];
    delete byController[fromId];
  });
}

module.exports = {
  EXAM_TYPES, EXAM_GRACE_MS, MIN_TIME_LIMIT_SEC, MAX_TIME_LIMIT_SEC,
  clampText, normalizeTimeLimit, sanitizeExamQuestion, isQuestionOpen, remainingMs, publicExamQuestion, hostExamQuestion,
  sanitizeExamAnswer, normalizeExamText, gradeExamAnswer, needsReview,
  recordExamDraft, submitExamAnswer, closeExamQuestion, finalizeOpenExam, gradeExamManually,
  examArchive, examQuestionsFor, examStateFor, examSummary, examScores, moveExamAnswers,
};
