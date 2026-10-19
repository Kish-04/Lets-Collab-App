'use client'

import { useEffect, useState } from 'react'
import { ClipboardCopy, ClipboardPaste, XCircle } from 'lucide-react'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { cn } from '@/lib/utils'

export const CLIPBOARD_CHANNEL = 'ircp-clipboard'
export const MAX_CLIPBOARD_CHARS = 64 * 1024

type Incoming = { text: string, from: string }

// Text clipboard sharing over a peer-to-peer data channel (never through the server). Sending is
// an explicit click, and a received clipboard is only copied when the receiver clicks Copy.
export function ClipboardSync({
    canSend,
    acceptFrom,
    describePeer,
    onLog,
}: {
    canSend: boolean
    acceptFrom: (peerId: string) => boolean
    describePeer: (peerId: string) => string
    onLog: (message: string) => void
}) {
    const [incoming, setIncoming] = useState<Incoming | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        const handle = (data: any, peerId: string) => {
            if (!data || data.type !== 'clipboard' || typeof data.text !== 'string') return
            if (!acceptFrom(peerId)) return // e.g. a controller without clipboard permission
            setCopied(false)
            setIncoming({ text: data.text.slice(0, MAX_CLIPBOARD_CHARS), from: describePeer(peerId) })
        }
        dataChannelManager.on(CLIPBOARD_CHANNEL, handle)
        return () => dataChannelManager.off(CLIPBOARD_CHANNEL, handle)
    }, [acceptFrom, describePeer])

    const sendClipboard = async () => {
        if (!dataChannelManager.isOpen(CLIPBOARD_CHANNEL)) {
            onLog('Clipboard not sent: no connected peer')
            return
        }
        try {
            const text = await navigator.clipboard.readText()
            if (!text) {
                onLog('Clipboard is empty or does not contain text')
                return
            }
            if (text.length > MAX_CLIPBOARD_CHARS) {
                onLog(`Clipboard not sent: larger than ${MAX_CLIPBOARD_CHARS / 1024} KB of text`)
                return
            }
            dataChannelManager.send(CLIPBOARD_CHANNEL, { type: 'clipboard', text })
            onLog(`Clipboard sent (${text.length} characters)`)
        } catch {
            onLog('Clipboard access was blocked by the browser')
        }
    }

    const copyIncoming = async () => {
        if (!incoming) return
        try {
            await navigator.clipboard.writeText(incoming.text)
            setCopied(true)
            setTimeout(() => setIncoming(null), 1200)
        } catch {
            onLog('Could not write to the clipboard')
        }
    }

    return (
        <>
            <button
                onClick={sendClipboard}
                disabled={!canSend}
                aria-label="Send my clipboard"
                title={canSend ? 'Send my clipboard text to the session' : 'The host has not allowed clipboard sharing'}
                className={cn(
                    'p-1.5 rounded-lg border transition-colors',
                    canSend ? 'text-[var(--text-secondary)] border-[var(--border)] hover:text-[var(--text-primary)]' : 'opacity-40 cursor-not-allowed text-[var(--text-dim)] border-[var(--border)]',
                )}
            >
                <ClipboardPaste className="w-4 h-4" />
            </button>
            {incoming && (
                <div role="alert" className="fixed bottom-24 right-4 z-[600] w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--accent)]/40 bg-[var(--surface)] p-3 shadow-2xl">
                    <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[var(--text-primary)]">Clipboard from {incoming.from}</span>
                        <button onClick={() => setIncoming(null)} aria-label="Dismiss clipboard" className="text-[var(--text-dim)] hover:text-[var(--text-primary)]">
                            <XCircle className="h-4 w-4" />
                        </button>
                    </div>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--bg)] p-2 font-mono text-[10px] text-[var(--text-secondary)]">
                        {incoming.text.length > 600 ? `${incoming.text.slice(0, 600)}…` : incoming.text}
                    </pre>
                    <button onClick={copyIncoming} className="mt-2 flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-bold text-black">
                        <ClipboardCopy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy'}
                    </button>
                </div>
            )}
        </>
    )
}
