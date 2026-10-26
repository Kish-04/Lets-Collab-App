// Types, constants and small helpers of the live session page (app/session/page.tsx).
import { Eye, MousePointer, Keyboard, Zap } from 'lucide-react'

export type Role = "host" | "controller" | "admin"
export type PermissionLevel = "view" | "mouse" | "keyboard" | "full"
export type ConnectionState = "idle" | "waiting" | "connecting" | "connected"
// Detectors name the same situation differently (no_face / NO_FACE, look_away / LOOKING_AWAY,
// forbidden_object / PHONE_DETECTED); one canonical name per situation
export function canonicalProctoringType(type: string) {
    const upper = String(type || '').toUpperCase()
    if (['LOOK_AWAY', 'LOOKING_AWAY', 'EYE_DARTING'].includes(upper)) return 'LOOKING_AWAY'
    if (['FORBIDDEN_OBJECT', 'PHONE_DETECTED', 'OBJECT_DETECTED'].includes(upper)) return 'PHONE_DETECTED'
    return upper
}

// Server room events carry an ISO time (server/roomUtils.js nowTime); older servers sent only a local
// "HH:MM:SS", which is anchored to today so it sorts with device logs. Anything else gets the fallback
// (default now) so a caller re-reading the same event can keep the time it gave it the first time.
export function roomTimeToIso(time: string, fallback?: string) {
    const raw = String(time || '').trim()
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && !Number.isNaN(Date.parse(raw))) return raw
    const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(raw)
    if (!match) return fallback || new Date().toISOString()
    const at = new Date()
    at.setHours(Number(match[1]), Number(match[2]), Number(match[3]), 0)
    return at.toISOString()
}

export type LogEntry = {
    time: string // ISO 8601 string
    type: "system" | "user" | "input" | "permission" | "anticheat" | "chain" | "chat" | "quality" | "recording"
    message: string
}
export type ParticipantQuality = {
    latency: number | null
    fps: number | null
    packetLoss: number | null
    health: "excellent" | "good" | "fair" | "poor" | "unknown"
}
export type Participant = {
    id: string
    socketId: string
    name: string
    email?: string | null
    initials?: string
    role: "controller"
    permission: PermissionLevel
    clipboardAllowed: boolean
    joinedAt: number
    quality?: ParticipantQuality
}
export type JoinRequest = {
    id: string
    socketId: string
    name: string
    email?: string | null
    initials?: string
    device?: string
    ip?: string
    requestedAt: number
}
export type ChatMessage = {
    id: string
    time: string // ISO 8601 string
    senderId: string
    senderName: string
    role: "host" | "controller" | "admin"
    text: string
    // Made on this device only (proctoring warnings, @pet answers); never sent, kept across session-state
    localOnly?: boolean
}
export type EvidenceItem = {
    id?: string
    time?: string // ISO 8601 string
    timestamp?: string // ISO 8601 string
    type: string
    by?: string
    label?: string
    message?: string
}

export const permissionLevels = [
    { id: "view" as const, label: "View Only", icon: Eye },
    { id: "mouse" as const, label: "Mouse Only", icon: MousePointer },
    { id: "keyboard" as const, label: "Keyboard Only", icon: Keyboard },
    { id: "full" as const, label: "Full Control", icon: Zap },
]

// One-tap reactions above the chat input; the full picker is components/ircp/session/chat/EmojiPicker
export const quickChatEmojis = ['👍', '❤️', '😂', '🎉', '🔥', '👀', '✅', '🙏', '💡', '🚀']
// The server keeps at most this many characters of a plain-text message (server/index.js chat-message)
export const chatMessageMaxLength = 1000
// Prefixes the page gives its device-only lines (pushLocalChatLine), so the chat can style them
export const petChatPrefix = '🐶 [Pet AI]:'
export const warningChatPrefix = '⚠️ [System Warning]:'

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
// Secure aggregation with differential privacy (DP-FedAvg): every update is clipped to L2 norm 1 and
// the aggregate carries Gaussian noise of std sigma; each device adds its share (lib/dpAccountant.ts).
// NEXT_PUBLIC_FL_DP_NOISE=0 turns the noise off. The epsilon budget is per exam session on a device:
// at the defaults (noise 1, epsilon 10, delta 1e-5) a device joins at most 3 rounds of one session.
export const FL_CLIP_NORM = 1
export const FL_NOISE_MULTIPLIER = process.env.NEXT_PUBLIC_FL_DP_NOISE ? Number(process.env.NEXT_PUBLIC_FL_DP_NOISE) : 1
export const FL_DP_DELTA = 1e-5
export const FL_EPSILON_BUDGET = Number(process.env.NEXT_PUBLIC_FL_EPSILON_BUDGET || 10)
// Noise is split across at least this many devices (the server's FL_MIN_PARTICIPANTS)
export const FL_NOISE_SHARES = Math.max(1, Number(process.env.NEXT_PUBLIC_FL_MIN_PARTICIPANTS || 3))
export const FL_DP_ROUNDS_KEY = 'ircp_fl_dp_rounds'

// Rounds this device has contributed to in one session (kept across reloads of that session)
export const dpRoundsInMemory = new Map<string, number>()
export function dpRoundsUsed(room: string) {
    try {
        const stored = Number(localStorage.getItem(`${FL_DP_ROUNDS_KEY}:${room}`))
        if (Number.isFinite(stored) && stored > 0) return stored
    } catch { /* storage blocked: fall back to this page */ }
    return dpRoundsInMemory.get(room) || 0
}
export function recordDpRound(room: string) {
    const rounds = dpRoundsUsed(room) + 1
    dpRoundsInMemory.set(room, rounds)
    try { localStorage.setItem(`${FL_DP_ROUNDS_KEY}:${room}`, String(rounds)) } catch { /* kept in memory */ }
    return rounds
}

export function formatDuration(s: number) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function ConnectionQualityMeter({ latency }: { latency: number }) {
    const bars = 4
    const active = latency < 50 ? 4 : latency < 100 ? 3 : latency < 150 ? 2 : 1
    const color = latency < 50 ? "var(--emerald)" : latency < 150 ? "var(--amber)" : "var(--red)"
    return (
        <div className="flex items-end gap-0.5 h-4">
            {Array.from({ length: bars }).map((_, i) => (
                <div key={i} className="w-1 rounded-sm transition-all"
                    style={{ height: `${((i + 1) / bars) * 100}%`, backgroundColor: i < active ? color : "var(--border)" }} />
            ))}
        </div>
    )
}

export function hasTurnServer(servers: RTCIceServer[]) {
    return servers.some(server => {
        const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
        return urls.some(url => typeof url === 'string' && /^turns?:/i.test(url))
    })
}
