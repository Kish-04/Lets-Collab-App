'use client'

// One run of chat lines from the same sender: avatar, name and role badge once, then the bubbles.
// System lines, proctoring warnings and @pet answers have their own look.
import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Bot, Check, Copy, Info, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    clockTime, initialsOf, isEmojiOnly, participantHue, relativeTime, roleBadge, splitLinks,
    type ChatGroup, type ChatLine,
} from './chatUtils'

function MessageText({ text }: { text: string }) {
    return (
        <>
            {splitLinks(text).map((part, index) => part.type === 'link' ? (
                <a
                    key={index}
                    href={part.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
                >
                    {part.value}
                </a>
            ) : (
                <span key={index}>{part.value}</span>
            ))}
        </>
    )
}

function CopyButton({ text, className }: { text: string; className?: string }) {
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            setCopied(false)
        }
    }
    return (
        <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Copied' : 'Copy message'}
            title={copied ? 'Copied' : 'Copy message'}
            className={cn(
                'flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-sm transition-opacity hover:text-[var(--text-primary)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
                className,
            )}
        >
            {copied ? <Check className="h-3 w-3 text-[var(--emerald)]" /> : <Copy className="h-3 w-3" />}
        </button>
    )
}

function Avatar({ name, seed }: { name: string; seed: string }) {
    const hue = participantHue(seed)
    return (
        <div
            aria-hidden
            className="flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-black text-white shadow-sm ring-2 ring-[var(--surface)]"
            style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 70% 42%))` }}
        >
            {initialsOf(name)}
        </div>
    )
}

function Badge({ label, className }: { label: string; className: string }) {
    return (
        <span className={cn('rounded-full border px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-wide', className)}>
            {label}
        </span>
    )
}

function Bubble({ line, own, first, last, now }: { line: ChatLine; own: boolean; first: boolean; last: boolean; now: number }) {
    const waiting = line.text === null
    const emojiOnly = !waiting && isEmojiOnly(line.text!)
    return (
        <div className={cn('group/msg relative flex items-end gap-1.5', own ? 'flex-row-reverse' : 'flex-row')}>
            <div
                title={`${line.date.toLocaleString()}`}
                className={cn(
                    'relative max-w-[85%] whitespace-pre-wrap break-words text-sm leading-relaxed font-emoji',
                    emojiOnly
                        ? 'px-1 text-3xl leading-tight'
                        : cn(
                            'px-3 py-1.5 shadow-sm',
                            own
                                ? 'bg-[var(--accent)] text-black'
                                : 'border border-[var(--border)] bg-[var(--elevated)] text-[var(--text-primary)]',
                            own
                                ? cn('rounded-2xl', !first && 'rounded-tr-md', !last && 'rounded-br-md', last && 'rounded-br-sm')
                                : cn('rounded-2xl', !first && 'rounded-tl-md', !last && 'rounded-bl-md', last && 'rounded-bl-sm'),
                        ),
                    waiting && 'italic',
                )}
            >
                {waiting ? (
                    <span className={cn('inline-flex items-center gap-1.5', own ? 'text-black/70' : 'text-[var(--text-secondary)]')}>
                        <Lock className="h-3 w-3 shrink-0 animate-pulse" aria-hidden />
                        Encrypted message (waiting for the key)
                    </span>
                ) : (
                    <MessageText text={line.text!} />
                )}
            </div>
            <div className={cn('flex shrink-0 items-center gap-1 pb-0.5', own ? 'flex-row-reverse' : 'flex-row')}>
                {!waiting && <CopyButton text={line.text!} className="opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 [@media(hover:none)]:opacity-100" />}
                <time
                    dateTime={line.message.time}
                    className="font-mono text-[9px] text-[var(--text-dim)] opacity-0 transition-opacity group-hover/msg:opacity-100"
                >
                    {relativeTime(line.date, now)}
                </time>
            </div>
        </div>
    )
}

export function ChatMessageGroup({ group, now, controllerLabel }: { group: ChatGroup; now: number; controllerLabel: string }) {
    const badge = roleBadge(group.kind, group.role, controllerLabel)
    const first = group.lines[0]

    if (group.kind === 'system') {
        return (
            <div className="flex flex-col items-center gap-1.5 py-1">
                {group.lines.map(line => (
                    <div key={line.message.id} role="note" className="flex max-w-[92%] items-start gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg)]/60 px-3 py-1 text-center text-[11px] text-[var(--text-secondary)]">
                        <Info className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-dim)]" aria-hidden />
                        <span className="break-words font-emoji">{line.text ? <MessageText text={line.text} /> : 'System notice'}</span>
                        <span className="shrink-0 font-mono text-[9px] text-[var(--text-dim)]">{clockTime(line.date)}</span>
                    </div>
                ))}
            </div>
        )
    }

    if (group.kind === 'warning') {
        return (
            <div className="space-y-1.5">
                {group.lines.map(line => (
                    <motion.div
                        key={line.message.id}
                        role="alert"
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-start gap-2.5 rounded-xl border border-[var(--amber)]/35 border-l-4 border-l-[var(--amber)] bg-[var(--amber)]/10 px-3 py-2"
                    >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" aria-hidden />
                        <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex items-center gap-2">
                                <Badge {...badge} />
                                <span className="text-[10px] text-[var(--text-dim)]">Only you can see this</span>
                                <span className="ml-auto font-mono text-[9px] text-[var(--text-dim)]">{clockTime(line.date)}</span>
                            </div>
                            <p className="break-words text-xs leading-relaxed text-[var(--text-primary)] font-emoji">{line.text}</p>
                        </div>
                    </motion.div>
                ))}
            </div>
        )
    }

    if (group.kind === 'pet') {
        return (
            <div className="flex items-start gap-2">
                <div aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--violet)] to-[var(--accent)] text-base shadow-[0_0_14px_var(--violet-glow)] font-emoji">
                    🐶
                </div>
                <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1.5">
                        <span className="text-xs font-bold text-[var(--text-primary)]">Pet</span>
                        <Badge {...badge} />
                        <span className="text-[10px] text-[var(--text-dim)]">· private to you</span>
                    </div>
                    <div className="space-y-1">
                        {group.lines.map(line => (
                            <div key={line.message.id} className="group/msg flex items-end gap-1.5">
                                <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-[var(--violet)]/35 bg-gradient-to-br from-[var(--violet)]/15 to-[var(--accent)]/5 px-3 py-2 text-sm leading-relaxed text-[var(--text-primary)] font-emoji">
                                    <Bot className="mb-0.5 mr-1 inline h-3.5 w-3.5 text-[var(--violet)]" aria-hidden />
                                    <MessageText text={line.text ?? ''} />
                                </div>
                                <CopyButton text={line.text ?? ''} className="opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 [@media(hover:none)]:opacity-100" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )
    }

    const own = group.kind === 'own'
    return (
        <div className={cn('flex gap-2', own ? 'flex-row-reverse' : 'flex-row')}>
            {own ? null : <Avatar name={group.senderName} seed={group.senderId || group.senderName} />}
            <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5', own ? 'items-end' : 'items-start')}>
                <div className={cn('mb-0.5 flex items-center gap-1.5 px-1', own && 'flex-row-reverse')}>
                    <span className="max-w-[140px] truncate text-xs font-bold text-[var(--text-primary)]">{own ? 'You' : group.senderName}</span>
                    <Badge {...badge} />
                    <time dateTime={first.message.time} className="font-mono text-[9px] text-[var(--text-dim)]">{clockTime(first.date)}</time>
                </div>
                <div className="flex w-full flex-col gap-0.5">
                    {group.lines.map((line, index) => (
                        <Bubble
                            key={line.message.id}
                            line={line}
                            own={own}
                            first={index === 0}
                            last={index === group.lines.length - 1}
                            now={now}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}
