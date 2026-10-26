// Supervised (exam) proctoring policy shared by the anti-cheat engine, the proctoring hooks, the
// session page and the pet robot. Pure logic, no DOM or React, so it can be unit-tested in Node.

export type ProctoringSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface ProctoringRule {
    severity: ProctoringSeverity
    /** Risk points for the first event of this kind; repeats escalate (see ProctoringEscalator) */
    penalty: number
    /** Short text for the host and admins, e.g. "Looking away from the screen" */
    label: string
    /** What the candidate's pet robot tells them */
    pet: string
}

export const PROCTORING_RULES: Record<string, ProctoringRule> = {
    NO_FACE: { severity: 'high', penalty: 12, label: 'No face on camera', pet: "No face detected — please sit in front of the camera." },
    MULTIPLE_FACES: { severity: 'critical', penalty: 25, label: 'Another person in view', pet: 'Another person detected — you must be alone during the exam.' },
    LOOKING_AWAY: { severity: 'medium', penalty: 8, label: 'Looking away from the screen', pet: 'Looking away detected — please keep your eyes on the screen.' },
    FACE_OUT_OF_FRAME: { severity: 'low', penalty: 5, label: 'Face too far or partly out of frame', pet: 'Your face is too far or partly out of frame — please move back into view.' },
    CAMERA_DARK: { severity: 'high', penalty: 15, label: 'Camera covered or too dark', pet: 'Your camera looks covered or too dark — please uncover it or add light.' },
    CAMERA_FROZEN: { severity: 'high', penalty: 20, label: 'Camera image frozen', pet: 'Your camera image is frozen — please check your camera.' },
    CAMERA_OFF: { severity: 'critical', penalty: 25, label: 'Camera turned off or lost', pet: 'Your camera stopped — please turn it back on now.' },
    PHONE_DETECTED: { severity: 'critical', penalty: 25, label: 'Phone or unauthorised material on camera', pet: 'A phone or unauthorised material was detected — please put it away.' },
    VOICE_DETECTED: { severity: 'high', penalty: 12, label: 'Talking detected', pet: 'Talking detected — please stay silent during the exam.' },
    WHISPER_DETECTED: { severity: 'high', penalty: 12, label: 'Whispering detected', pet: 'Whispering detected — please stay silent during the exam.' },
    MULTIPLE_VOICES: { severity: 'critical', penalty: 20, label: 'More than one voice / conversation', pet: 'A conversation was detected — no one may talk to you during the exam.' },
    PHONE_AUDIO: { severity: 'high', penalty: 15, label: 'Phone ringing or dialing', pet: 'A phone sound was detected — please switch your phone off.' },
    LOUD_NOISE: { severity: 'low', penalty: 4, label: 'Loud background noise', pet: 'Loud noise detected — please make sure your room is quiet.' },
    MIC_OFF: { severity: 'critical', penalty: 25, label: 'Microphone muted or lost', pet: 'Your microphone stopped — please turn it back on now.' },
    TAB_SWITCHED: { severity: 'high', penalty: 20, label: 'Left the exam window', pet: 'You left the exam window — please stay on this screen.' },
    FULLSCREEN_EXIT: { severity: 'medium', penalty: 10, label: 'Exited full screen', pet: 'You exited full screen — please return to full screen.' },
    CLIPBOARD: { severity: 'medium', penalty: 10, label: 'Clipboard / copy-paste activity', pet: 'Copy and paste are not allowed during the exam.' },
    DEVTOOLS: { severity: 'high', penalty: 20, label: 'Developer tools shortcut', pet: 'Developer tools are not allowed during the exam.' },
    SCREEN_CAPTURE: { severity: 'high', penalty: 15, label: 'Screenshot key pressed', pet: 'Screenshots are not allowed during the exam.' },
    SUSPICIOUS_SHORTCUT: { severity: 'low', penalty: 5, label: 'Window-switching shortcut', pet: 'Please do not use window-switching shortcuts during the exam.' },
    REMOTE_DESKTOP: { severity: 'critical', penalty: 30, label: 'Remote desktop / remote-control app', pet: 'A remote-control or recording app was detected — please close it.' },
    VIRTUAL_MACHINE: { severity: 'high', penalty: 15, label: 'Running inside a virtual machine', pet: 'This device looks like a virtual machine — the host has been told.' },
    SECOND_SCREEN: { severity: 'high', penalty: 30, label: 'Second display connected', pet: 'A second display was detected — please disconnect it.' },
    IDENTITY_MISMATCH: { severity: 'critical', penalty: 30, label: 'Face does not match enrolled Face ID', pet: 'Your face did not match your Face ID — the host has been told.' },
    TYPING_ANOMALY: { severity: 'low', penalty: 2, label: 'Typing pattern anomaly', pet: 'Unusual typing pattern detected.' },
}

const FALLBACK_RULE: ProctoringRule = { severity: 'medium', penalty: 10, label: 'Suspicious activity', pet: 'Suspicious activity detected — please focus on your exam.' }

// Every detector's own event names, mapped to one kind so duplicates (same moment seen by the engine
// and a hook) and repeats are counted together.
const ALIASES: Record<string, string> = {
    LOOK_AWAY: 'LOOKING_AWAY', EYE_DARTING: 'LOOKING_AWAY', GAZE_AWAY: 'LOOKING_AWAY',
    FORBIDDEN_OBJECT: 'PHONE_DETECTED', OBJECT_DETECTED: 'PHONE_DETECTED', BOOK_DETECTED: 'PHONE_DETECTED',
    TALKING_DETECTED: 'VOICE_DETECTED', SPEECH_DETECTED: 'VOICE_DETECTED',
    WHISPER: 'WHISPER_DETECTED', CONVERSATION: 'MULTIPLE_VOICES',
    SUSPICIOUS_NOISE: 'LOUD_NOISE', FACE_TOO_FAR: 'FACE_OUT_OF_FRAME', FACE_PARTIAL: 'FACE_OUT_OF_FRAME',
    CAMERA_COVERED: 'CAMERA_DARK', CAMERA_ENDED: 'CAMERA_OFF', MIC_MUTED: 'MIC_OFF',
    BLUR_EVENT: 'TAB_SWITCHED', CLIPBOARD_CHANGE: 'CLIPBOARD', BANNED_PROCESS: 'REMOTE_DESKTOP',
    PRINT_SCREEN: 'SCREEN_CAPTURE', MULTI_MONITOR: 'SECOND_SCREEN', SYSTEM: 'TYPING_ANOMALY',
}

export function proctoringKind(type: string) {
    const upper = String(type || '').trim().toUpperCase()
    return ALIASES[upper] || upper
}

export function proctoringRule(type: string): ProctoringRule {
    return PROCTORING_RULES[proctoringKind(type)] || FALLBACK_RULE
}

const SEVERITY_ORDER: ProctoringSeverity[] = ['low', 'medium', 'high', 'critical']

export interface EscalatedEvent {
    kind: string
    severity: ProctoringSeverity
    penalty: number
    /** How many times this kind was seen inside the escalation window, this one included */
    count: number
    escalated: boolean
}

/**
 * Repeats of the same violation cost more: x1, x1.5, x2, ... up to x3 within a 10-minute window, and
 * the severity goes up one step from the third occurrence and to critical from the fifth.
 */
export class ProctoringEscalator {
    private history = new Map<string, number[]>()
    constructor(private windowMs = 10 * 60 * 1000, private maxPenalty = 60) {}

    record(type: string, basePenalty?: number, now = Date.now()): EscalatedEvent {
        const kind = proctoringKind(type)
        const rule = proctoringRule(kind)
        const times = (this.history.get(kind) || []).filter(t => now - t < this.windowMs)
        times.push(now)
        this.history.set(kind, times)
        const count = times.length
        const base = Number.isFinite(basePenalty) && (basePenalty as number) > 0 ? (basePenalty as number) : rule.penalty
        const multiplier = Math.min(3, 1 + 0.5 * (count - 1))
        const penalty = Math.min(this.maxPenalty, Math.round(base * multiplier))
        let level = SEVERITY_ORDER.indexOf(rule.severity)
        if (count >= 3) level += 1
        if (count >= 5) level = SEVERITY_ORDER.length - 1
        const severity = SEVERITY_ORDER[Math.min(level, SEVERITY_ORDER.length - 1)]
        return { kind, severity, penalty, count, escalated: count > 1 }
    }

    countOf(type: string, now = Date.now()) {
        return (this.history.get(proctoringKind(type)) || []).filter(t => now - t < this.windowMs).length
    }
}

/**
 * Turns a per-frame yes/no signal into a sustained detection: it fires only when at least `ratio` of
 * the samples in the last `windowMs` were positive and the window is (nearly) full, so one bad frame
 * never raises an alarm. After firing it stays quiet for `cooldownMs` even if the condition persists.
 */
export class SustainedSignal {
    private samples: Array<{ t: number; on: boolean }> = []
    private lastFiredAt = -Infinity
    private firstSampleAt = -Infinity

    constructor(private windowMs: number, private ratio = 0.8, private cooldownMs = 8000, private minSamples = 3) {}

    update(on: boolean, now = Date.now()): boolean {
        if (this.samples.length === 0) this.firstSampleAt = now
        this.samples.push({ t: now, on })
        const cutoff = now - this.windowMs
        while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift()
        if (!on) return false
        if (now - this.firstSampleAt < this.windowMs * 0.9) return false
        if (this.samples.length < this.minSamples) return false
        if (now - this.lastFiredAt < this.cooldownMs) return false
        const positive = this.samples.filter(s => s.on).length
        if (positive / this.samples.length < this.ratio) return false
        this.lastFiredAt = now
        return true
    }

    reset() {
        this.samples = []
        this.firstSampleAt = -Infinity
    }
}

// ---------------------------------------------------------------------------------------------------
// Camera frame health (covered / dark / frozen), computed on a small grayscale thumbnail
// ---------------------------------------------------------------------------------------------------

export const CAMERA_HEALTH = {
    /** Mean luma (0-255) under this is too dark to proctor (a covered lens reads ~0-15) */
    DARK_MEAN: 28,
    /** Luma standard deviation under this means a uniform image (lens covered by a finger/sticker) */
    UNIFORM_STDDEV: 7,
    /** Mean absolute luma difference between samples 500 ms apart under this means identical frames.
     *  Live sensors show noise of ~1-4 even when the person sits perfectly still. */
    FROZEN_DIFF: 0.35,
}

/** Grayscale luma (0-255) of an RGBA buffer */
export function toLuma(rgba: ArrayLike<number>): Float32Array {
    const out = new Float32Array(Math.floor(rgba.length / 4))
    for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
    return out
}

export function lumaStats(luma: ArrayLike<number>) {
    if (luma.length === 0) return { mean: 0, stddev: 0 }
    let sum = 0
    for (let i = 0; i < luma.length; i++) sum += luma[i]
    const mean = sum / luma.length
    let variance = 0
    for (let i = 0; i < luma.length; i++) variance += (luma[i] - mean) ** 2
    return { mean, stddev: Math.sqrt(variance / luma.length) }
}

export function lumaDifference(a: ArrayLike<number>, b: ArrayLike<number>) {
    if (a.length === 0 || a.length !== b.length) return Infinity
    let sum = 0
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
    return sum / a.length
}

export function cameraFrameProblem(luma: ArrayLike<number>): 'dark' | 'uniform' | null {
    const { mean, stddev } = lumaStats(luma)
    if (mean < CAMERA_HEALTH.DARK_MEAN) return 'dark'
    if (stddev < CAMERA_HEALTH.UNIFORM_STDDEV) return 'uniform'
    return null
}

// ---------------------------------------------------------------------------------------------------
// Pet robot message queue
// ---------------------------------------------------------------------------------------------------

export interface PetQueueOptions {
    show: (text: string) => void
    clear: () => void
    /** Identical messages (same key) inside this window are dropped */
    repeatMs?: number
    minMs?: number
    maxMs?: number
    maxQueued?: number
    /** Pause between two messages so the bubble visibly changes and the warning sound replays */
    gapMs?: number
    now?: () => number
    setTimer?: (fn: () => void, ms: number) => unknown
    clearTimer?: (handle: unknown) => void
}

/**
 * Shows pet messages one at a time so a burst of detections does not overwrite itself, and drops
 * repeats of the same message (key) seen in the last `repeatMs`.
 */
export class PetMessageQueue {
    private queue: Array<{ text: string; key: string }> = []
    private current: { text: string; key: string } | null = null
    private timer: unknown = null
    private lastSeen = new Map<string, number>()
    private opts: Required<PetQueueOptions>

    constructor(options: PetQueueOptions) {
        this.opts = {
            repeatMs: 20000, minMs: 4500, maxMs: 9000, maxQueued: 5, gapMs: 300,
            now: () => Date.now(),
            setTimer: (fn, ms) => setTimeout(fn, ms),
            clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
            ...options,
        } as Required<PetQueueOptions>
    }

    /** Duration a message stays up: long enough to read (about 15 characters per second) */
    displayMs(text: string) {
        return Math.max(this.opts.minMs, Math.min(this.opts.maxMs, 1500 + text.length * 65))
    }

    push(text: string, key = text): boolean {
        const clean = String(text || '').trim()
        if (!clean) return false
        const now = this.opts.now()
        const last = this.lastSeen.get(key)
        if (last !== undefined && now - last < this.opts.repeatMs) return false
        if (this.current?.key === key || this.queue.some(item => item.key === key)) return false
        this.lastSeen.set(key, now)
        if (this.lastSeen.size > 200) this.lastSeen.delete(this.lastSeen.keys().next().value as string)
        this.queue.push({ text: clean, key })
        // Keep the newest messages when a burst overflows the queue
        while (this.queue.length > this.opts.maxQueued) this.queue.shift()
        if (!this.current && !this.timer) this.next()
        return true
    }

    get pending() { return this.queue.length }
    get showing() { return this.current?.text ?? null }

    private next() {
        this.timer = null
        const item = this.queue.shift()
        if (!item) {
            this.current = null
            this.opts.clear()
            return
        }
        this.current = item
        this.opts.show(item.text)
        this.timer = this.opts.setTimer(() => {
            this.current = null
            if (this.queue.length === 0) {
                this.timer = null
                this.opts.clear()
                return
            }
            // Clear briefly between messages so the pet re-triggers its warning animation and sound
            this.opts.clear()
            this.timer = this.opts.setTimer(() => this.next(), this.opts.gapMs)
        }, this.displayMs(item.text))
    }

    dispose() {
        if (this.timer) this.opts.clearTimer(this.timer)
        this.timer = null
        this.queue = []
        this.current = null
    }
}

// The candidate's own pet beeps through the speakers; audio detectors ignore the microphone for that
// long so the pet's warning cannot be reported as "talking" (a feedback loop).
let petAudioUntil = 0
export function suppressAudioProctoringFor(ms: number, now = Date.now()) {
    petAudioUntil = Math.max(petAudioUntil, now + Math.max(0, ms))
}
export function audioProctoringSuppressed(now = Date.now()) {
    return now < petAudioUntil
}
