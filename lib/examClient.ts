// Client side of the exam: question timing, merging server updates, running code and exporting results.
// No React here, so it can be unit tested (tests/exam.test.mjs).
import { getAuthHeaders } from './utils'

export type ExamQuestionType = 'freeform' | 'mc' | 'poll' | 'code'

export interface ExamQuestion {
    id: string
    type: ExamQuestionType
    prompt: string
    options?: string[]
    language?: string
    starterCode?: string
    voicePrompt?: string
    answerKey?: string
    /** Time limit chosen by the host when sending the question (seconds) */
    timeLimitSec?: number
    /** From the server: milliseconds left when the message was sent (null = no limit) */
    remainingMs?: number | null
    /** Local clock time the question closes, derived from remainingMs on receipt */
    endsAt?: number | null
    closed?: boolean
    /** Room state leaves voice prompts out; this says one exists */
    hasVoicePrompt?: boolean
    /** A candidate's saved draft, sent back after a reconnect */
    draft?: ExamAnswer
}

export interface ExamAnswer {
    text?: string
    options?: string[]
    audio?: string | null
    output?: string
    isFinal?: boolean
    correct?: boolean | null
    needsReview?: boolean
    autoSubmitted?: boolean
    gradedBy?: string
    controllerName?: string
    email?: string
    timestamp?: number
    submittedAt?: number
}

export type ExamAnswers = Record<string, Record<string, ExamAnswer>>

/** Converts the server's "milliseconds left" into a local deadline (immune to clock differences). */
export function withLocalDeadline(question: ExamQuestion, receivedAt = Date.now()): ExamQuestion {
    if (typeof question.remainingMs !== 'number') return { ...question, endsAt: question.endsAt ?? null }
    return { ...question, endsAt: receivedAt + question.remainingMs }
}

/**
 * Merges the question list from room state into what the client already has: the server's list is
 * authoritative for which questions exist, but voice prompts (left out of room state) and an earlier
 * local deadline are kept.
 */
export function mergeExamQuestions(previous: ExamQuestion[], incoming: ExamQuestion[] | undefined, receivedAt = Date.now()): ExamQuestion[] {
    if (!Array.isArray(incoming)) return previous
    const known = new Map(previous.map(question => [question.id, question]))
    return incoming.map((raw) => {
        const question = withLocalDeadline(raw, receivedAt)
        const before = known.get(question.id)
        if (!before) return question
        return {
            ...question,
            voicePrompt: question.voicePrompt ?? before.voicePrompt,
            draft: question.draft ?? before.draft,
            // Network delay only ever makes the newer estimate later; keep the earlier one
            endsAt: question.closed ? receivedAt : (typeof before.endsAt === 'number' && typeof question.endsAt === 'number' ? Math.min(before.endsAt, question.endsAt) : question.endsAt),
        }
    })
}

/** Seconds left on a question, or null when it has no time limit. */
export function secondsLeft(question: Pick<ExamQuestion, 'endsAt' | 'closed'>, now = Date.now()): number | null {
    if (question.closed) return 0
    if (typeof question.endsAt !== 'number') return null
    return Math.max(0, Math.ceil((question.endsAt - now) / 1000))
}

export function formatCountdown(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds))
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const rest = String(s % 60).padStart(2, '0')
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`
}

export const CODE_EXECUTION_DISABLED = 'Code execution is not enabled on this server.'

/**
 * Runs code through the web app's /api/execute route. It only exists where the Next.js server runs
 * (not in the desktop app's static build) and is off in production unless the operator enables it,
 * so "not available" is reported as such rather than as an error in the candidate's code.
 */
export async function runExamCode(language: string, code: string, fetchImpl: typeof fetch = fetch): Promise<{ output: string; available: boolean }> {
    if (typeof window !== 'undefined' && window.location?.protocol === 'file:') return { output: CODE_EXECUTION_DISABLED, available: false }
    let res: Response
    try {
        res = await fetchImpl('/api/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ language, files: [{ content: code }] }),
        })
    } catch {
        return { output: CODE_EXECUTION_DISABLED, available: false }
    }
    let data: any = null
    try { data = await res.json() } catch { /* not our route (static host, 404 page) */ }
    if (!data || typeof data !== 'object' || !data.run || data.disabled || res.status === 404) {
        return { output: CODE_EXECUTION_DISABLED, available: false }
    }
    const output = data.run.output || data.run.stderr || (res.ok ? 'No output' : `Run failed (${res.status})`)
    return { output, available: true }
}

/** Status of one candidate's answer for the results table. */
export function answerStatus(question: ExamQuestion, answer?: ExamAnswer): 'correct' | 'wrong' | 'review' | 'submitted' | 'draft' | 'none' {
    if (!answer) return 'none'
    if (!answer.isFinal) return 'draft'
    if (answer.correct === true) return 'correct'
    if (answer.correct === false) return 'wrong'
    if (question.type !== 'poll' && (answer.needsReview || question.answerKey)) return 'review'
    return 'submitted'
}

export interface ExamCandidateRow {
    controllerId: string
    name: string
    email?: string
    statuses: Record<string, ReturnType<typeof answerStatus>>
    correct: number
    pending: number
}

/** One row per candidate who answered anything; questions without a key or a grade do not count. */
export function examResultRows(questions: ExamQuestion[], answers: ExamAnswers): ExamCandidateRow[] {
    const rows = new Map<string, ExamCandidateRow>()
    questions.forEach((question) => {
        Object.entries(answers[question.id] || {}).forEach(([controllerId, answer]) => {
            const row = rows.get(controllerId) || { controllerId, name: answer.controllerName || 'Unknown', email: answer.email, statuses: {}, correct: 0, pending: 0 }
            if (answer.controllerName) row.name = answer.controllerName
            if (answer.email) row.email = answer.email
            const status = answerStatus(question, answer)
            row.statuses[question.id] = status
            if (status === 'correct') row.correct += 1
            if (status === 'review') row.pending += 1
            rows.set(controllerId, row)
        })
    })
    return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Number of questions that count towards a score (have a key, or a host grade). */
export function gradedQuestionCount(questions: ExamQuestion[], answers: ExamAnswers): number {
    return questions.filter(q => q.type !== 'poll' && (q.answerKey || Object.values(answers[q.id] || {}).some(a => a.gradedBy === 'host'))).length
}

const csvCell = (value: unknown) => {
    const text = value === undefined || value === null ? '' : String(value)
    // Leading = + - @ would run as a formula in a spreadsheet
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Results as CSV: one row per candidate and question, with the answer text and its grade. */
export function examResultsCsv(questions: ExamQuestion[], answers: ExamAnswers): string {
    const header = ['Candidate', 'Email', 'Question', 'Type', 'Answer', 'Status', 'Auto-submitted', 'Submitted at']
    const lines = [header.map(csvCell).join(',')]
    questions.forEach((question, index) => {
        Object.values(answers[question.id] || {}).forEach((answer) => {
            lines.push([
                answer.controllerName || 'Unknown',
                answer.email || '',
                `Q${index + 1}: ${question.prompt}`,
                question.type,
                answer.text ?? (answer.options || []).join('; '),
                answerStatus(question, answer),
                answer.autoSubmitted ? 'yes' : '',
                answer.submittedAt ? new Date(answer.submittedAt).toISOString() : '',
            ].map(csvCell).join(','))
        })
    })
    return lines.join('\r\n')
}

/** Votes per option for a poll or multiple-choice question. */
export function optionTally(question: ExamQuestion, answers: ExamAnswers): Record<string, number> {
    const tally: Record<string, number> = Object.fromEntries((question.options || []).map(option => [option, 0]))
    Object.values(answers[question.id] || {}).forEach((answer) => {
        if (answer.text && answer.text in tally) tally[answer.text] += 1
    })
    return tally
}
