'use client'

import { useMemo, useState } from 'react'
import { Activity, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ActivityEntry = {
    time: string
    type: string
    message: string
    source: 'device' | 'room'
}

type Filter = 'all' | 'system' | 'proctoring'

const PROCTORING_TYPES = new Set(['anticheat', 'permission'])

function displayTime(time: string) {
    const parsed = new Date(time)
    return isNaN(parsed.getTime()) ? time : parsed.toLocaleTimeString([], { hour12: false })
}

// Session log that used to be tracked but never shown: connection, chat-key, screen-share and
// federated-learning messages for everyone; the room's proctoring log and risk score for the host.
export function SessionActivityPanel({
    entries,
    isHost,
    riskScore,
    onClose,
}: {
    entries: ActivityEntry[]
    isHost: boolean
    riskScore: number | null
    onClose: () => void
}) {
    const [filter, setFilter] = useState<Filter>('all')
    const visible = useMemo(() => entries
        .filter(entry => isHost || !PROCTORING_TYPES.has(entry.type))
        .filter(entry => filter === 'all'
            || (filter === 'proctoring' ? PROCTORING_TYPES.has(entry.type) : !PROCTORING_TYPES.has(entry.type)))
        .slice(-150)
        .reverse(), [entries, filter, isHost])

    const filters: Filter[] = isHost ? ['all', 'system', 'proctoring'] : ['all']

    return (
        <div
            role="dialog"
            aria-label="Session activity"
            className="fixed right-4 top-16 z-[500] flex h-[min(560px,calc(100vh-5rem))] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        >
            <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
                <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-[var(--accent)]" />
                    <span className="text-sm font-bold text-[var(--text-primary)]">Session activity</span>
                    {isHost && riskScore !== null && (
                        <span
                            title="Room risk score from proctoring alerts (0-100)"
                            className={cn(
                                'rounded px-1.5 py-0.5 font-mono text-[9px]',
                                riskScore >= 70 ? 'bg-[var(--red)]/15 text-[var(--red)]'
                                    : riskScore >= 30 ? 'bg-[var(--amber)]/15 text-[var(--amber)]'
                                        : 'bg-[var(--success)]/15 text-[var(--success)]',
                            )}
                        >
                            RISK {Math.round(riskScore)}
                        </span>
                    )}
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close session activity"
                    className="rounded-md p-1 text-[var(--text-dim)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
                >
                    <XCircle className="h-4 w-4" />
                </button>
            </div>
            {filters.length > 1 && (
                <div className="flex gap-1.5 border-b border-[var(--border)] px-4 py-2">
                    {filters.map(option => (
                        <button
                            key={option}
                            onClick={() => setFilter(option)}
                            aria-pressed={filter === option}
                            className={cn(
                                'rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase',
                                filter === option
                                    ? 'border-transparent bg-[var(--accent)] text-black'
                                    : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                            )}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            )}
            <ol className="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
                {visible.length === 0 ? (
                    <li className="flex h-full items-center justify-center text-center text-xs text-[var(--text-dim)]">Nothing to show yet.</li>
                ) : visible.map((entry, index) => (
                    <li key={`${entry.time}-${index}`} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
                        <div className="mb-0.5 flex items-center justify-between gap-3">
                            <span className={cn(
                                'text-[9px] font-bold uppercase',
                                PROCTORING_TYPES.has(entry.type) ? 'text-[var(--amber)]' : 'text-[var(--text-secondary)]',
                            )}>
                                {entry.type}{entry.source === 'room' ? ' · room' : ''}
                            </span>
                            <span className="shrink-0 font-mono text-[9px] text-[var(--text-dim)]">{displayTime(entry.time)}</span>
                        </div>
                        <p className="break-words text-xs text-[var(--text-primary)]">{entry.message}</p>
                    </li>
                ))}
            </ol>
        </div>
    )
}
