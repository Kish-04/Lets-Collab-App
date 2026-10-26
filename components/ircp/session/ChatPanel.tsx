'use client'

// The live session's chat panel. Messages are end-to-end encrypted by the page (lib/E2EChat.ts); this
// shows them decrypted when the key is there (never the ciphertext), and the host key fingerprint
// people can compare. Lines made on this device only (proctoring warnings, @pet answers) arrive as
// localOnly System messages and get their own look (components/ircp/session/chat/).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type Ref, type SetStateAction } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, Check, Copy, MessageSquare, Send, ShieldAlert, ShieldCheck, Smile, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatMessageMaxLength, quickChatEmojis, type ChatMessage } from '@/lib/session/model'
import { buildChatBlocks, toChatLine } from './chat/chatUtils'
import { ChatMessageGroup } from './chat/ChatMessageGroup'
import { EmojiPicker } from './chat/EmojiPicker'

export { useChatUnread } from './chat/chatUtils'

// Within this many pixels of the end the list counts as "at the bottom" and follows new messages
const STICK_THRESHOLD = 80
const MAX_INPUT_HEIGHT = 140

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
    if (!ref) return
    if (typeof ref === 'function') ref(value)
    else (ref as { current: T | null }).current = value
}

function EncryptionChip({ fingerprint }: { fingerprint: string }) {
    const [open, setOpen] = useState(false)
    const [copied, setCopied] = useState(false)
    const ready = Boolean(fingerprint)
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(fingerprint)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            setCopied(false)
        }
    }
    return (
        <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                aria-expanded={open}
                aria-label={ready ? `End-to-end encrypted. Host key fingerprint ${fingerprint}` : 'Waiting for the end-to-end encryption key'}
                className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
                    ready
                        ? 'border-[var(--emerald)]/35 bg-[var(--emerald)]/12 text-[var(--emerald)]'
                        : 'border-[var(--amber)]/35 bg-[var(--amber)]/12 text-[var(--amber)]',
                )}
            >
                {ready ? <ShieldCheck className="h-3 w-3" aria-hidden /> : <ShieldAlert className="h-3 w-3 animate-pulse" aria-hidden />}
                {ready ? 'Encrypted' : 'Securing…'}
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div
                        role="tooltip"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.12 }}
                        className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-[var(--border-bright)] bg-[var(--surface)] p-3 text-left shadow-2xl"
                    >
                        <p className="text-xs font-bold text-[var(--text-primary)]">
                            {ready ? 'End-to-end encrypted' : 'Waiting for the encryption key'}
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                            {ready
                                ? 'Only people in this session can read these messages; the server relays ciphertext. Compare this host key fingerprint with the others to rule out a swapped key.'
                                : 'The host shares the chat key when you join. Messages can be sent and read once it arrives.'}
                        </p>
                        {ready && (
                            <div className="mt-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
                                <code className="flex-1 font-mono text-[11px] tracking-wider text-[var(--emerald)]">{fingerprint}</code>
                                <button
                                    type="button"
                                    // Keep the tooltip open while clicking inside it
                                    onMouseDown={event => event.preventDefault()}
                                    onClick={copy}
                                    aria-label="Copy fingerprint"
                                    className="rounded p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)]"
                                >
                                    {copied ? <Check className="h-3 w-3 text-[var(--emerald)]" /> : <Copy className="h-3 w-3" />}
                                </button>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

function EmptyChat({ petAvailable }: { petAvailable: boolean }) {
    return (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="relative mb-4">
                <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-bright)] bg-gradient-to-br from-[var(--accent)]/20 to-[var(--violet)]/20 text-3xl shadow-[0_0_30px_var(--accent-glow)] font-emoji"
                    aria-hidden
                >
                    💬
                </motion.div>
                <motion.span
                    animate={{ rotate: [0, 14, -8, 14, 0] }}
                    transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.6 }}
                    className="absolute -right-3 -top-2 text-xl font-emoji"
                    aria-hidden
                >
                    👋
                </motion.span>
            </div>
            <p className="font-display text-sm font-bold text-[var(--text-primary)]">Say hello to the room</p>
            <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-[var(--text-secondary)]">
                Messages are end-to-end encrypted and visible to everyone in this session.
            </p>
            {petAvailable && (
                <p className="mt-3 rounded-full border border-[var(--violet)]/30 bg-[var(--violet)]/10 px-3 py-1 text-[11px] text-[var(--text-secondary)]">
                    Start with <span className="font-mono font-bold text-[var(--violet)]">@pet</span> to ask the AI assistant
                </p>
            )}
        </div>
    )
}

export function ChatPanel({
    e2eFingerprint, messages, decrypted, ownSocketId, scrollRef, input, setInput, onSubmit, onClose,
    controllerLabel = 'Controller', petAvailable = true,
}: {
    e2eFingerprint: string
    messages: ChatMessage[]
    decrypted: Record<string, string | null>
    ownSocketId?: string
    /** Optional: receives the scrolling list element. The panel scrolls itself. */
    scrollRef?: Ref<HTMLDivElement>
    input: string
    setInput: Dispatch<SetStateAction<string>>
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onClose: () => void
    /** What the non-host participant is called here: "Candidate" in a supervised exam. */
    controllerLabel?: string
    /** False hides the @pet hint (the assistant is off for candidates in supervised exams). */
    petAvailable?: boolean
}) {
    const listRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const formRef = useRef<HTMLFormElement>(null)
    const atBottomRef = useRef(true)
    const lastIdRef = useRef<string | undefined>(messages[messages.length - 1]?.id)
    const [newCount, setNewCount] = useState(0)
    const [pickerOpen, setPickerOpen] = useState(false)
    const [now, setNow] = useState(() => Date.now())

    // Relative times ("2 min ago") stay current
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000)
        return () => clearInterval(timer)
    }, [])

    useEffect(() => { inputRef.current?.focus() }, [])

    const setListRef = useCallback((node: HTMLDivElement | null) => {
        listRef.current = node
        assignRef(scrollRef, node)
    }, [scrollRef])

    const lines = useMemo(() => messages.map(message => toChatLine(message, decrypted, ownSocketId)), [messages, decrypted, ownSocketId])
    const blocks = useMemo(() => buildChatBlocks(lines), [lines])

    const scrollToBottom = useCallback((smooth: boolean) => {
        const list = listRef.current
        if (!list) return
        list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
        atBottomRef.current = true
        setNewCount(0)
    }, [])

    // First paint: start at the latest message
    useLayoutEffect(() => { scrollToBottom(false) }, [scrollToBottom])

    // New messages: follow them when at the bottom (or when they are one's own), otherwise count them
    useLayoutEffect(() => {
        // Counted from the previous last message, since the page keeps only the latest 100
        const previousLastId = lastIdRef.current
        lastIdRef.current = messages[messages.length - 1]?.id
        const previousIndex = previousLastId ? messages.findIndex(message => message.id === previousLastId) : -1
        const added = previousIndex >= 0 ? messages.length - 1 - previousIndex : (previousLastId ? messages.length : 0)
        if (added <= 0) {
            // Decryption filled in text or the history was replaced: keep the end in view if following
            if (atBottomRef.current) scrollToBottom(false)
            return
        }
        const latest = messages[messages.length - 1]
        if (atBottomRef.current || latest?.senderId === ownSocketId) scrollToBottom(true)
        else setNewCount(count => count + added)
    }, [messages, decrypted, ownSocketId, scrollToBottom])

    const onScroll = () => {
        const list = listRef.current
        if (!list) return
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < STICK_THRESHOLD
        atBottomRef.current = atBottom
        if (atBottom && newCount) setNewCount(0)
    }

    // The input grows with its content up to a few lines
    useLayoutEffect(() => {
        const field = inputRef.current
        if (!field) return
        field.style.height = 'auto'
        field.style.height = `${Math.min(field.scrollHeight, MAX_INPUT_HEIGHT)}px`
    }, [input])

    const insertAtCaret = (text: string) => {
        const field = inputRef.current
        const start = field?.selectionStart ?? input.length
        const end = field?.selectionEnd ?? input.length
        const next = `${input.slice(0, start)}${text}${input.slice(end)}`.slice(0, chatMessageMaxLength)
        setInput(next)
        requestAnimationFrame(() => {
            if (!field) return
            field.focus()
            const caret = Math.min(start + text.length, next.length)
            field.setSelectionRange(caret, caret)
        })
    }

    const remaining = chatMessageMaxLength - input.length
    const showCounter = remaining <= 200
    const canSend = input.trim().length > 0

    const submit = (event: FormEvent<HTMLFormElement>) => {
        setPickerOpen(false)
        atBottomRef.current = true
        onSubmit(event)
    }

    return (
        <motion.section
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            aria-label="Session chat"
            onKeyDown={event => {
                // Shift+Escape is the host's emergency revoke: let it through to the page
                if (event.key === 'Escape' && !event.shiftKey && !pickerOpen) {
                    event.stopPropagation()
                    onClose()
                }
            }}
            className="fixed inset-x-2 bottom-2 top-14 z-[500] flex flex-col overflow-hidden rounded-2xl border border-[var(--border-bright)] bg-[var(--surface)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:h-[min(620px,calc(100vh-5rem))] sm:w-[380px]"
        >
            {/* Header */}
            <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-gradient-to-r from-[var(--accent)]/[0.06] to-[var(--violet)]/[0.06] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]">
                        <MessageSquare className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <h2 className="font-display text-sm font-bold leading-tight text-[var(--text-primary)]">Session chat</h2>
                        <p className="truncate text-[10px] text-[var(--text-dim)]">
                            {messages.length === 0 ? 'No messages yet' : `${messages.length} message${messages.length === 1 ? '' : 's'}`}
                        </p>
                    </div>
                    <EncryptionChip fingerprint={e2eFingerprint} />
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close Session Chat"
                    className="rounded-lg p-1.5 text-[var(--text-dim)] transition-colors hover:bg-[var(--elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                    <X className="h-4 w-4" />
                </button>
            </header>

            {/* Messages */}
            <div className="relative min-h-0 flex-1">
                <div
                    ref={setListRef}
                    onScroll={onScroll}
                    role="log"
                    aria-live="polite"
                    aria-relevant="additions"
                    aria-label="Chat messages"
                    tabIndex={0}
                    className="h-full space-y-3 overflow-y-auto px-3 py-3 scrollbar-thin focus-visible:outline-none"
                >
                    {messages.length === 0 ? (
                        <EmptyChat petAvailable={petAvailable} />
                    ) : (
                        blocks.map(block => block.type === 'day' ? (
                            <div key={block.key} className="flex items-center gap-3 py-1" role="separator" aria-label={block.label}>
                                <div className="h-px flex-1 bg-[var(--border)]" />
                                <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                                    {block.label}
                                </span>
                                <div className="h-px flex-1 bg-[var(--border)]" />
                            </div>
                        ) : (
                            <ChatMessageGroup key={block.key} group={block.group} now={now} controllerLabel={controllerLabel} />
                        ))
                    )}
                </div>

                <AnimatePresence>
                    {newCount > 0 && (
                        <motion.button
                            type="button"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            onClick={() => scrollToBottom(true)}
                            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-black shadow-[0_6px_20px_var(--accent-glow)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                        >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                            {newCount} new message{newCount === 1 ? '' : 's'}
                        </motion.button>
                    )}
                </AnimatePresence>
            </div>

            {/* Composer */}
            <div className="relative border-t border-[var(--border)] bg-[var(--bg)]/40 p-2.5">
                <AnimatePresence>
                    {pickerOpen && (
                        <EmojiPicker
                            onPick={emoji => insertAtCaret(emoji)}
                            onClose={() => {
                                setPickerOpen(false)
                                inputRef.current?.focus()
                            }}
                        />
                    )}
                </AnimatePresence>

                {!e2eFingerprint && (
                    <p className="mb-2 flex items-center gap-1.5 rounded-lg border border-[var(--amber)]/25 bg-[var(--amber)]/10 px-2.5 py-1.5 text-[11px] text-[var(--amber)]">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Waiting for the encryption key from the host before messages can be sent.
                    </p>
                )}

                <div className="mb-2 flex gap-1 overflow-x-auto scrollbar-thin" role="group" aria-label="Quick reactions">
                    {quickChatEmojis.map(emoji => (
                        <button
                            key={emoji}
                            type="button"
                            onClick={() => insertAtCaret(emoji)}
                            aria-label={`Insert ${emoji}`}
                            className="flex h-7 w-8 shrink-0 items-center justify-center rounded-full text-base transition-transform font-emoji hover:scale-125 hover:bg-[var(--elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                        >
                            {emoji}
                        </button>
                    ))}
                </div>

                <form ref={formRef} onSubmit={submit} className="flex items-end gap-2">
                    <div className="flex min-w-0 flex-1 items-end gap-1 rounded-2xl border border-[var(--border)] bg-[var(--bg)] py-1 pl-1 pr-2 transition-colors focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_var(--accent-glow)]">
                        <button
                            type="button"
                            onClick={() => setPickerOpen(open => !open)}
                            aria-label={pickerOpen ? 'Close emoji picker' : 'Open emoji picker'}
                            aria-expanded={pickerOpen}
                            className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]',
                                pickerOpen ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--text-primary)]',
                            )}
                        >
                            <Smile className="h-[18px] w-[18px]" />
                        </button>
                        <textarea
                            ref={inputRef}
                            value={input}
                            rows={1}
                            onChange={event => setInput(event.target.value.slice(0, chatMessageMaxLength))}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                    event.preventDefault()
                                    if (canSend) formRef.current?.requestSubmit()
                                }
                            }}
                            maxLength={chatMessageMaxLength}
                            aria-label="Chat message"
                            aria-describedby="chat-composer-hint"
                            placeholder={petAvailable ? 'Message everyone, or @pet…' : 'Message everyone'}
                            className="max-h-[140px] min-h-[32px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-dim)] font-emoji scrollbar-thin"
                        />
                    </div>
                    <motion.button
                        type="submit"
                        disabled={!canSend}
                        whileTap={canSend ? { scale: 0.9 } : undefined}
                        aria-label="Send Message"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-black shadow-[0_4px_16px_var(--accent-glow)] transition-opacity disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                        <Send className="h-4 w-4 -translate-x-px translate-y-px" />
                    </motion.button>
                </form>

                <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-[10px] text-[var(--text-dim)]">
                    <span id="chat-composer-hint" className="hidden sm:inline">
                        <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> new line
                    </span>
                    {showCounter && (
                        <span
                            aria-live="polite"
                            className={cn('ml-auto font-mono', remaining <= 50 ? 'font-bold text-[var(--red)]' : 'text-[var(--amber)]')}
                        >
                            {input.length}/{chatMessageMaxLength}
                        </span>
                    )}
                </div>
            </div>
        </motion.section>
    )
}
