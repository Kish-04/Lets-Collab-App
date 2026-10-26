'use client'

// Built-in emoji picker of the session chat: category tabs, search by keyword, recently used, and
// arrow-key navigation in the grid. Escape closes it.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { Clock, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { allEmojis, emojiCategories } from './emojiData'

const RECENT_KEY = 'ircp_chat_recent_emojis'
const COLUMNS = 8

function readRecent(): string[] {
    try {
        const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
        return Array.isArray(stored) ? stored.filter(item => typeof item === 'string').slice(0, 16) : []
    } catch {
        return []
    }
}

function rememberRecent(emoji: string) {
    try {
        const next = [emoji, ...readRecent().filter(item => item !== emoji)].slice(0, 16)
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
        // Storage may be blocked (private window); recents are only a convenience
    }
}

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
    const [query, setQuery] = useState('')
    const [recent] = useState<string[]>(() => (typeof window === 'undefined' ? [] : readRecent()))
    const [category, setCategory] = useState<string>(() => (recent.length ? 'recent' : emojiCategories[0].id))
    const searchRef = useRef<HTMLInputElement>(null)
    const gridRef = useRef<HTMLDivElement>(null)

    useEffect(() => { searchRef.current?.focus() }, [])

    const tabs = useMemo(() => [
        ...(recent.length ? [{ id: 'recent', label: 'Recent', icon: null as string | null }] : []),
        ...emojiCategories.map(item => ({ id: item.id, label: item.label, icon: item.emojis[0].char })),
    ], [recent.length])

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle) {
            return allEmojis.filter(item => item.keywords.includes(needle) || item.char === needle).map(item => ({ char: item.char, name: item.keywords.split(' ')[0] }))
        }
        if (category === 'recent') return recent.map(char => ({ char, name: allEmojis.find(item => item.char === char)?.keywords.split(' ')[0] ?? 'emoji' }))
        const found = emojiCategories.find(item => item.id === category) ?? emojiCategories[0]
        return found.emojis.map(item => ({ char: item.char, name: item.keywords.split(' ')[0] }))
    }, [query, category, recent])

    const pick = (emoji: string) => {
        rememberRecent(emoji)
        onPick(emoji)
    }

    const focusCell = (index: number) => {
        const cells = gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]')
        if (!cells?.length) return
        cells[Math.max(0, Math.min(cells.length - 1, index))]?.focus()
    }

    const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement
        const index = Number(target.dataset.index ?? -1)
        if (index < 0) return
        const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }
        if (event.key in moves) {
            event.preventDefault()
            if (event.key === 'ArrowUp' && index < COLUMNS) searchRef.current?.focus()
            else focusCell(index + moves[event.key])
        } else if (event.key === 'Home') {
            event.preventDefault()
            focusCell(0)
        } else if (event.key === 'End') {
            event.preventDefault()
            focusCell(visible.length - 1)
        }
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            role="dialog"
            aria-label="Emoji picker"
            onKeyDown={event => {
                if (event.key === 'Escape' && !event.shiftKey) {
                    event.stopPropagation()
                    onClose()
                }
            }}
            className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-[var(--border-bright)] bg-[var(--surface)] shadow-2xl"
        >
            <div className="flex items-center gap-2 border-b border-[var(--border)] p-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 focus-within:border-[var(--accent)]">
                    <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-dim)]" aria-hidden />
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'ArrowDown') {
                                event.preventDefault()
                                focusCell(0)
                            } else if (event.key === 'Enter' && visible[0]) {
                                event.preventDefault()
                                pick(visible[0].char)
                            }
                        }}
                        placeholder="Search emoji"
                        aria-label="Search emoji"
                        className="h-8 min-w-0 flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-dim)]"
                    />
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close emoji picker"
                    className="rounded-md p-1.5 text-[var(--text-dim)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {!query && (
                <div role="tablist" aria-label="Emoji categories" className="flex gap-0.5 overflow-x-auto border-b border-[var(--border)] px-1.5 py-1 scrollbar-thin">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={category === tab.id}
                            aria-label={tab.label}
                            title={tab.label}
                            onClick={() => setCategory(tab.id)}
                            className={cn(
                                'flex h-8 w-9 shrink-0 items-center justify-center rounded-md text-base transition-colors font-emoji focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
                                category === tab.id ? 'bg-[var(--accent)]/15 ring-1 ring-[var(--accent)]/40' : 'opacity-70 hover:bg-[var(--elevated)] hover:opacity-100',
                            )}
                        >
                            {tab.icon ?? <Clock className="h-4 w-4 text-[var(--text-secondary)]" />}
                        </button>
                    ))}
                </div>
            )}

            <div className="px-2 pt-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                {query ? `${visible.length} result${visible.length === 1 ? '' : 's'}` : tabs.find(tab => tab.id === category)?.label}
            </div>
            <div
                ref={gridRef}
                onKeyDown={onGridKeyDown}
                role="grid"
                aria-label="Emoji"
                className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto p-2 scrollbar-thin"
            >
                {visible.length === 0 ? (
                    <p className="col-span-8 py-6 text-center text-xs text-[var(--text-dim)]">No emoji match &ldquo;{query}&rdquo;</p>
                ) : visible.map((item, index) => (
                    <button
                        key={`${item.char}-${index}`}
                        type="button"
                        data-emoji
                        data-index={index}
                        tabIndex={index === 0 ? 0 : -1}
                        onClick={() => pick(item.char)}
                        aria-label={item.name}
                        title={item.name}
                        className="flex aspect-square items-center justify-center rounded-md text-xl transition-transform font-emoji hover:scale-110 hover:bg-[var(--elevated)] focus-visible:bg-[var(--elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    >
                        {item.char}
                    </button>
                ))}
            </div>
        </motion.div>
    )
}
