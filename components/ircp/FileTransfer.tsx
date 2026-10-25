'use client'

import React, { useState, useEffect, useRef } from 'react'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { File, UploadCloud, Download, Trash2 } from 'lucide-react'

// Peer-to-peer over the ircp-file data channel. Both sides refuse files above this size, and a
// received file is only saved when the user chooses to.
export const MAX_FILE_BYTES = 500 * 1024 * 1024
const CHUNK_BYTES = 16384
const READ_BYTES = 4 * 1024 * 1024 // the sender reads the file in slices instead of all at once

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

type ReceivedFile = { name: string, size: number, blob: Blob }

export function FileTransfer({ peerId }: { peerId?: string }) {
    const [status, setStatus] = useState<string>('Idle')
    const [progress, setProgress] = useState<number>(0)
    const [received, setReceived] = useState<ReceivedFile | null>(null)

    const fileChunksRef = useRef<ArrayBuffer[]>([])
    const currentFileNameRef = useRef<string>('')
    const currentFileSizeRef = useRef<number>(0)
    const receivedSizeRef = useRef<number>(0)
    const currentSenderRef = useRef<string>('')

    const settleStatus = (message: string) => {
        setStatus(message)
        setTimeout(() => { setStatus('Idle'); setProgress(0) }, 3000)
    }

    useEffect(() => {
        const resetIncoming = () => {
            fileChunksRef.current = []
            receivedSizeRef.current = 0
            currentFileSizeRef.current = 0
            currentSenderRef.current = ''
        }

        const handleMessage = (data: any, senderId: string) => {
            if (data instanceof ArrayBuffer) {
                if (!currentSenderRef.current || currentSenderRef.current !== senderId || currentFileSizeRef.current <= 0) return
                if (receivedSizeRef.current + data.byteLength > currentFileSizeRef.current) {
                    resetIncoming() // more data than announced: drop the transfer
                    settleStatus('Download failed — the sender sent more data than announced')
                    return
                }
                fileChunksRef.current.push(data)
                receivedSizeRef.current += data.byteLength
                setProgress(Math.min(100, Math.round((receivedSizeRef.current / currentFileSizeRef.current) * 100)))
                return
            }

            if (data.type === 'file-start') {
                const safeName = typeof data.name === 'string' && data.name.trim()
                    ? data.name.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180)
                    : 'shared-file'
                const safeSize = Number(data.size)
                if (!Number.isFinite(safeSize) || safeSize <= 0) return
                if (safeSize > MAX_FILE_BYTES) {
                    settleStatus(`Refused ${safeName}: larger than ${formatBytes(MAX_FILE_BYTES)}`)
                    return
                }
                setStatus(`Receiving ${safeName} (${formatBytes(safeSize)})...`)
                setProgress(0)
                resetIncoming()
                currentFileNameRef.current = safeName
                currentFileSizeRef.current = safeSize
                currentSenderRef.current = senderId
            } else if (data.type === 'file-end') {
                if (!currentSenderRef.current || currentSenderRef.current !== senderId) return
                if (receivedSizeRef.current < currentFileSizeRef.current) {
                    resetIncoming()
                    settleStatus('Download failed — incomplete data')
                    return
                }
                // Keep it until the user decides; nothing is written to disk without a click
                setReceived({ name: currentFileNameRef.current, size: receivedSizeRef.current, blob: new Blob(fileChunksRef.current) })
                resetIncoming()
                setStatus('Idle')
                setProgress(0)
            }
        }

        dataChannelManager.on('ircp-file', handleMessage)
        return () => dataChannelManager.off('ircp-file', handleMessage)
    }, [])

    const saveReceived = () => {
        if (!received) return
        const url = URL.createObjectURL(received.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = received.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setReceived(null)
    }

    const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (!file) return
        sendFile(file)
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        e.target.value = '' // allow sending the same file again
        if (!file) return
        sendFile(file)
    }

    const sendFile = async (file: File) => {
        if (file.size > MAX_FILE_BYTES) {
            settleStatus(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}`)
            return
        }
        if (!dataChannelManager.isOpen('ircp-file', peerId)) {
            settleStatus('No active peer connection — file not sent')
            return
        }

        setStatus(`Sending ${file.name}...`)
        setProgress(0)

        dataChannelManager.send('ircp-file', {
            type: 'file-start',
            name: file.name,
            size: file.size
        }, peerId)

        let offset = 0
        while (offset < file.size) {
            const slice = await file.slice(offset, offset + READ_BYTES).arrayBuffer()
            for (let start = 0; start < slice.byteLength; start += CHUNK_BYTES) {
                if (!dataChannelManager.isOpen('ircp-file', peerId)) {
                    settleStatus('Transfer failed — connection lost')
                    return
                }
                dataChannelManager.send('ircp-file', slice.slice(start, start + CHUNK_BYTES), peerId)
                // Native WebRTC backpressure: wait while more than 1 MB is queued
                await dataChannelManager.waitForBuffer('ircp-file', peerId, 1024 * 1024)
            }
            offset += slice.byteLength
            setProgress(Math.round((offset / file.size) * 100))
        }

        if (!dataChannelManager.isOpen('ircp-file', peerId)) {
            settleStatus('Transfer failed — connection lost')
            return
        }

        dataChannelManager.send('ircp-file', { type: 'file-end' }, peerId)
        settleStatus('Sent successfully!')
    }

    return (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-xs font-mono text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
                <File className="w-3.5 h-3.5" /> P2P File Transfer
            </h3>

            <div
                role="button"
                tabIndex={0}
                aria-label="Choose a file to send"
                onDrop={handleFileDrop}
                onDragOver={(e) => e.preventDefault()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('file-upload')?.click() }}
                className="border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--elevated)] transition-all rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer relative"
                onClick={() => {
                    (window as any).isSelectingFile = true;
                    document.getElementById('file-upload')?.click();
                    const onFocus = () => {
                        setTimeout(() => { (window as any).isSelectingFile = false; }, 500);
                        window.removeEventListener('focus', onFocus);
                    };
                    window.addEventListener('focus', onFocus);
                }}
            >
                <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    onChange={handleFileSelect}
                />
                <UploadCloud className="w-8 h-8 text-[var(--text-dim)] mb-2" />
                <p className="text-xs text-[var(--text-primary)] font-medium">Click or drag file to send securely</p>
                <p className="text-[10px] text-[var(--text-dim)] mt-1">Direct P2P transfer • up to {formatBytes(MAX_FILE_BYTES)}</p>
            </div>

            {received && (
                <div role="alert" className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 p-3">
                    <p className="text-[11px] text-[var(--text-primary)]">
                        Received <span className="font-mono">{received.name}</span> ({formatBytes(received.size)}). Only save files you expected.
                    </p>
                    <div className="mt-2 flex gap-2">
                        <button onClick={saveReceived} className="flex items-center gap-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-bold text-black">
                            <Download className="h-3 w-3" /> Save
                        </button>
                        <button onClick={() => setReceived(null)} className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                            <Trash2 className="h-3 w-3" /> Discard
                        </button>
                    </div>
                </div>
            )}

            {status !== 'Idle' && (
                <div className="bg-[var(--bg)]/80 rounded-lg p-3 border border-[var(--border)]">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono">{status}</span>
                        <span className="text-[10px] text-[var(--accent)] font-mono">{progress}%</span>
                    </div>
                    <div className="h-1 bg-[var(--border)] rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[var(--accent)] transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    )
}
