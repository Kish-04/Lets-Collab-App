/** Mirrors `ExamQuestion` in the web app (components/ircp/exam/ExamHostDashboard.tsx). */
export type ExamQuestionType = 'freeform' | 'mc' | 'poll' | 'code';

export type ExamQuestion = {
  id: string;
  type: ExamQuestionType;
  prompt: string;
  options?: string[];
  language?: string;
  starterCode?: string;
  /** Data URL of a recorded voice prompt (web only; not played on mobile). */
  voicePrompt?: string;
  /** Present in the payload the server relays; never shown to the candidate. */
  answerKey?: string;
  roomId?: string;
};

/** Same answer object the web candidate sends with controller-draft-answer / controller-submit-answer. */
export type ExamAnswer = {
  text?: string;
  output?: string;
  audio?: string;
};

export function isExamQuestion(value: unknown): value is ExamQuestion {
  const q = value as ExamQuestion | null;
  return Boolean(
    q && typeof q.id === 'string' && typeof q.prompt === 'string'
    && (q.type === 'freeform' || q.type === 'mc' || q.type === 'poll' || q.type === 'code'),
  );
}
