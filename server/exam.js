// Exam questions and answers: sanitising, grading, what candidates see, archiving and scores.

// ── Exams ──────────────────────────────────────────────────────────────────────
const EXAM_TYPES = new Set(['freeform', 'mc', 'poll', 'code']);

const clampText = (value, max) => (typeof value === 'string' ? value.slice(0, max) : undefined);

function sanitizeExamQuestion(payload) {
  const id = clampText(payload.id, 100);
  if (!id || !EXAM_TYPES.has(payload.type) || typeof payload.prompt !== 'string' || !payload.prompt.trim()) return null;
  return {
    id,
    type: payload.type,
    prompt: payload.prompt.slice(0, 5000),
    options: Array.isArray(payload.options) ? payload.options.slice(0, 20).map(o => String(o).slice(0, 500)) : undefined,
    language: clampText(payload.language, 40),
    starterCode: clampText(payload.starterCode, 20000),
    voicePrompt: clampText(payload.voicePrompt, 3 * 1024 * 1024),
    answerKey: clampText(payload.answerKey, 2000),
  };
}

// What candidates receive: never the answer key
function publicExamQuestion({ answerKey, ...question }) {
  return question;
}

function sanitizeExamAnswer(answer = {}) {
  return {
    text: clampText(answer.text, 50000),
    options: Array.isArray(answer.options) ? answer.options.slice(0, 20).map(o => String(o).slice(0, 500)) : undefined,
    audio: clampText(answer.audio, 5 * 1024 * 1024),
    output: clampText(answer.output, 20000),
  };
}

/** Server-side grading (the candidate never sees the key); null when the question has no key. */
// Answers are compared exactly after normalising case, whitespace and trailing punctuation; a key may
// list accepted alternatives separated by "|" (e.g. "paris|city of paris"). Substring matching let a
// candidate pass by padding the answer with guesses.
function normalizeExamText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;,]+$/, '').trim();
}

function gradeExamAnswer(question, answer) {
  if (!question.answerKey) return null;
  const accepted = String(question.answerKey).split('|').map(normalizeExamText).filter(Boolean);
  if (accepted.length === 0) return null;
  // Code output is produced in the candidate's browser, so this checks what they report, not a
  // server-side run; the host sees the code itself in the live view
  const given = normalizeExamText(question.type === 'code' ? answer.output : answer.text);
  return accepted.includes(given);
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
      answers[questionId][controllerId] = { ...rest, hadAudio: Boolean(audio), name: participant?.name, email: participant?.email };
    });
  });
  return {
    questions: (room.exam?.questions || []).map(({ voicePrompt, ...question }) => question),
    answers,
  };
}

function examQuestionsFor(room, targetSocket) {
  const questions = room.exam?.questions || [];
  if (targetSocket?.id === room.hostSocketId) return questions;
  return questions
    .filter(q => !room.exam.answers[q.id]?.[targetSocket?.id]?.isFinal)
    .map(publicExamQuestion);
}

function examSummary(room) {
  const answers = Object.values(room.exam?.answers || {});
  return {
    questions: (room.exam?.questions || []).length,
    drafts: answers.reduce((sum, byController) => sum + Object.values(byController).filter(a => !a?.isFinal).length, 0),
    submitted: answers.reduce((sum, byController) => sum + Object.values(byController).filter(a => a?.isFinal).length, 0),
  };
}

// Exam result per candidate: correct answers out of the questions that have an answer key
function examScores(room) {
  const graded = (room.exam?.questions || []).filter(q => q.answerKey);
  if (graded.length === 0) return [];
  const byEmail = new Map();
  graded.forEach((question) => {
    Object.values(room.exam.answers[question.id] || {}).forEach((answer) => {
      if (!answer?.isFinal || !answer.email) return;
      byEmail.set(answer.email, (byEmail.get(answer.email) || 0) + (answer.correct ? 1 : 0));
    });
  });
  return Array.from(byEmail.entries()).map(([email, given]) => ({ email, given, maximum: graded.length }));
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

module.exports = { EXAM_TYPES, clampText, sanitizeExamQuestion, publicExamQuestion, sanitizeExamAnswer, normalizeExamText, gradeExamAnswer, examArchive, examQuestionsFor, examSummary, examScores, moveExamAnswers };
