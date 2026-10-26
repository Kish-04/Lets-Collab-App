// Pure helpers of the session chat: what kind of line a message is, who sent it (badge, colour,
// initials), how its time reads, and safe link detection. No React state here except useChatUnread.
import { useMemo, useRef, useState, useEffect } from 'react'
import { isE2EMessage } from '@/lib/E2EChat'
import { petChatPrefix, warningChatPrefix, type ChatMessage } from '@/lib/session/model'

export type ChatLineKind = 'own' | 'other' | 'system' | 'warning' | 'pet'

export type ChatLine = {
    message: ChatMessage
    kind: ChatLineKind
    // null while an end-to-end encrypted message cannot be decrypted yet (never the ciphertext)
    text: string | null
    date: Date
}

export type ChatGroup = {
    key: string
    kind: ChatLineKind
    senderId: string
    senderName: string
    role: ChatMessage['role']
    lines: ChatLine[]
}

export type ChatBlock =
    | { type: 'day'; key: string; label: string }
    | { type: 'group'; key: string; group: ChatGroup }

// Consecutive messages of one sender closer together than this share one header and avatar
const GROUP_WINDOW_MS = 5 * 60 * 1000

function parseTime(time: string) {
    const parsed = new Date(time)
    return isNaN(parsed.getTime()) ? new Date() : parsed
}

/** Classifies a message and returns the text that may be shown (decrypted, prefix removed). */
export function toChatLine(message: ChatMessage, decrypted: Record<string, string | null>, ownSocketId?: string): ChatLine {
    const date = parseTime(message.time)
    const raw = isE2EMessage(message.text) ? (decrypted[message.id] ?? null) : message.text
    if (message.localOnly || message.senderId === 'system') {
        const body = raw ?? ''
        if (body.startsWith(petChatPrefix)) return { message, kind: 'pet', text: body.slice(petChatPrefix.length).trim(), date }
        if (body.startsWith(warningChatPrefix)) return { message, kind: 'warning', text: body.slice(warningChatPrefix.length).trim(), date }
        return { message, kind: 'system', text: body, date }
    }
    return { message, kind: message.senderId === ownSocketId ? 'own' : 'other', text: raw, date }
}

function sameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function dayLabel(date: Date, now = new Date()) {
    if (sameDay(date, now)) return 'Today'
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (sameDay(date, yesterday)) return 'Yesterday'
    return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function clockTime(date: Date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function relativeTime(date: Date, now: number) {
    const seconds = Math.round((now - date.getTime()) / 1000)
    if (seconds < 45) return 'just now'
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 6) return `${hours} h ago`
    return clockTime(date)
}

/** Day separators plus runs of messages by the same sender. */
export function buildChatBlocks(lines: ChatLine[]): ChatBlock[] {
    const blocks: ChatBlock[] = []
    let lastDay: Date | null = null
    let current: ChatGroup | null = null
    for (const line of lines) {
        if (!lastDay || !sameDay(lastDay, line.date)) {
            blocks.push({ type: 'day', key: `day-${line.message.id}`, label: dayLabel(line.date) })
            lastDay = line.date
            current = null
        }
        const previous: ChatLine | undefined = current?.lines[current.lines.length - 1]
        const joins = current
            && current.kind === line.kind
            && current.senderId === line.message.senderId
            && (line.kind === 'own' || line.kind === 'other')
            && previous
            && line.date.getTime() - previous.date.getTime() < GROUP_WINDOW_MS
        if (joins && current) {
            current.lines.push(line)
        } else {
            current = {
                key: `group-${line.message.id}`,
                kind: line.kind,
                senderId: line.message.senderId,
                senderName: line.message.senderName,
                role: line.message.role,
                lines: [line],
            }
            blocks.push({ type: 'group', key: current.key, group: current })
        }
    }
    return blocks
}

export function initialsOf(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

/** A stable hue per participant, so one person keeps one colour for the whole session. */
export function participantHue(seed: string) {
    let hash = 0
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
    return Math.abs(hash) % 360
}

export type RoleBadge = { label: string; className: string }

export function roleBadge(kind: ChatLineKind, role: ChatMessage['role'], controllerLabel: string): RoleBadge {
    if (kind === 'pet') return { label: 'Pet AI', className: 'border-[var(--violet)]/40 bg-[var(--violet)]/15 text-[var(--violet)]' }
    if (kind === 'warning') return { label: 'Proctoring', className: 'border-[var(--amber)]/40 bg-[var(--amber)]/15 text-[var(--amber)]' }
    if (kind === 'system') return { label: 'System', className: 'border-[var(--border-bright)] bg-[var(--elevated)] text-[var(--text-secondary)]' }
    if (role === 'host') return { label: 'Host', className: 'border-[var(--accent)]/40 bg-[var(--accent)]/12 text-[var(--accent)]' }
    if (role === 'admin') return { label: 'Administrator', className: 'border-[var(--red)]/40 bg-[var(--red)]/12 text-[var(--red)]' }
    return { label: controllerLabel, className: 'border-[var(--emerald)]/40 bg-[var(--emerald)]/12 text-[var(--emerald)]' }
}

export type TextPart = { type: 'text'; value: string } | { type: 'link'; value: string; href: string }

const LINK_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi
const TRAILING_PUNCTUATION = /[).,;:!?\]}]+$/

/** Splits text into plain parts and http(s) links. Anything else (javascript:, data:) stays text. */
export function splitLinks(text: string): TextPart[] {
    const parts: TextPart[] = []
    let last = 0
    for (const match of text.matchAll(LINK_PATTERN)) {
        const start = match.index ?? 0
        let candidate = match[0]
        const trailing = candidate.match(TRAILING_PUNCTUATION)?.[0] ?? ''
        // Keep a closing bracket that belongs to the URL itself, e.g. wiki links with (parentheses)
        if (trailing) candidate = candidate.slice(0, candidate.length - trailing.length)
        const href = candidate.toLowerCase().startsWith('www.') ? `https://${candidate}` : candidate
        let valid = false
        try {
            const url = new URL(href)
            valid = url.protocol === 'http:' || url.protocol === 'https:'
        } catch {
            valid = false
        }
        if (!valid) continue
        if (start > last) parts.push({ type: 'text', value: text.slice(last, start) })
        parts.push({ type: 'link', value: candidate, href })
        last = start + candidate.length
    }
    if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
    return parts
}

// Built from a string: the project targets ES6, where TypeScript rejects \p{...} regex literals
const EMOJI_ONLY = new RegExp('^(?:\\p{Extended_Pictographic}|\\p{Emoji_Component}|\\u200d|\\ufe0f|\\s)+$', 'u')

/** True when the text is only emoji (up to a few), shown larger like modern messengers do. */
export function isEmojiOnly(text: string) {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > 24) return false
    return EMOJI_ONLY.test(trimmed) && !/^[\d#*\s]+$/.test(trimmed)
}

/**
 * Messages that arrived while the chat was closed. Everything present while it is open counts as read;
 * one's own messages never count. The page can show the number on its chat button.
 */
export function useChatUnread(messages: ChatMessage[], open: boolean, ownSocketId?: string) {
    const seenRef = useRef<Set<string>>(new Set())
    const [version, setVersion] = useState(0)
    useEffect(() => {
        if (!open) return
        let changed = false
        for (const message of messages) {
            if (!seenRef.current.has(message.id)) {
                seenRef.current.add(message.id)
                changed = true
            }
        }
        if (changed) setVersion(v => v + 1)
    }, [messages, open])
    return useMemo(() => {
        if (open) return 0
        return messages.filter(message => !seenRef.current.has(message.id) && message.senderId !== ownSocketId).length
        // version re-runs this after the seen set changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, open, ownSocketId, version])
}
