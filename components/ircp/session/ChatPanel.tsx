'use client'

// The live session's chat panel. Messages are end-to-end encrypted by the page (lib/E2EChat.ts); this
// shows them decrypted when the key is there, and the host key fingerprint people can compare.
import type { Dispatch, FormEvent, Ref, SetStateAction } from 'react'
import { MessageSquare, Send, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isE2EMessage } from '@/lib/E2EChat'
import { quickChatEmojis, type ChatMessage } from '@/lib/session/model'

function messageTime(time: string) {
    const parsed = new Date(time)
    return isNaN(parsed.getTime()) ? time : parsed.toLocaleTimeString([], { hour12: false })
}

export function ChatPanel({ e2eFingerprint, messages, decrypted, ownSocketId, scrollRef, input, setInput, onSubmit, onClose }: {
    e2eFingerprint: string
    messages: ChatMessage[]
    decrypted: Record<string, string | null>
    ownSocketId?: string
    scrollRef: Ref<HTMLDivElement>
    input: string
    setInput: Dispatch<SetStateAction<string>>
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onClose: () => void
}) {
    return (
        <div className="fixed right-4 top-16 z-[500] flex h-[min(560px,calc(100vh-5rem))] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-[var(--border)] px-4">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-[var(--accent)]" />
                    <span className="text-sm font-bold text-[var(--text-primary)]">Session Chat</span>
                    <span
                        title={e2eFingerprint ? `End-to-end encrypted. Compare this host key fingerprint with other participants: ${e2eFingerprint}` : 'Waiting for the end-to-end encryption key'}
                        className={cn("rounded px-1.5 py-0.5 font-mono text-[9px]", e2eFingerprint ? "bg-[var(--success)]/15 text-[var(--success)]" : "bg-[var(--amber)]/15 text-[var(--amber)]")}
                    >
                        {e2eFingerprint ? `E2E ${e2eFingerprint.slice(0, 9)}` : 'E2E pending'}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close Session Chat"
                    className="rounded-md p-1 text-[var(--text-dim)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)]"
                >
                    <XCircle className="h-4 w-4" />
                </button>
            </div>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-center text-xs text-[var(--text-dim)]">
                        No messages yet.
                    </div>
                ) : (
                    messages.map(message => {
                        const mine = message.senderId === ownSocketId
                        return (
                            <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                                <div className={cn(
                                    "max-w-[82%] rounded-lg border px-3 py-2",
                                    mine
                                        ? "border-[var(--accent)]/40 bg-[var(--accent)]/15"
                                        : "border-[var(--border)] bg-[var(--bg)]"
                                )}>
                                    <div className="mb-1 flex items-center justify-between gap-3">
                                        <span className="truncate text-[10px] font-bold uppercase text-[var(--text-secondary)]">{message.senderName}</span>
                                        <span className="shrink-0 font-mono text-[9px] text-[var(--text-dim)]">{messageTime(message.time)}</span>
                                    </div>
                                    <p className="break-words text-sm leading-relaxed text-[var(--text-primary)] font-emoji">
                                        {isE2EMessage(message.text)
                                            ? (decrypted[message.id] ?? 'Encrypted message (waiting for the key)')
                                            : message.text}
                                    </p>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
            <div className="border-t border-[var(--border)] p-3">
                <div className="mb-2 flex gap-1">
                    {quickChatEmojis.map(emoji => (
                        <button
                            key={emoji}
                            type="button"
                            onClick={() => setInput(value => `${value}${emoji}`)}
                            className="flex h-7 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg)] text-sm hover:border-[var(--accent)] font-emoji"
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
                <form onSubmit={onSubmit} className="flex gap-2">
                    <input
                        value={input}
                        onChange={event => setInput(event.target.value)}
                        maxLength={1000}
                        aria-label="Chat message"
                        className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-emoji"
                        placeholder="Message everyone"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim()}
                        aria-label="Send Message"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-black disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Send className="h-4 w-4" />
                    </button>
                </form>
            </div>
        </div>
    )
}
