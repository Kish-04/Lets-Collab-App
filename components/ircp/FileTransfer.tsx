'use client'

import React, { useState, useEffect, useRef } from 'react'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { File, UploadCloud } from 'lucide-react'

export function FileTransfer({ peerId }: { peerId?: string }) {
    const [status, setStatus] = useState<string>('Idle')
    const [progress, setProgress] = useState<number>(0)
    const [incomingFile, setIncomingFile] = useState<{ name: string, size: number } | null>(null)
    
    const fileChunksRef = useRef<ArrayBuffer[]>([])
    const currentFileNameRef = useRef<string>('')
    const currentFileSizeRef = useRef<number>(0)
    const receivedSizeRef = useRef<number>(0)
    const currentSenderRef = useRef<string>('')

    useEffect(() => {
        const handleMessage = (data: any, senderId: string) => {
            if (data instanceof ArrayBuffer) {
                if (!currentSenderRef.current || currentSenderRef.current !== senderId || currentFileSizeRef.current <= 0) return
                fileChunksRef.current.push(data)
                receivedSizeRef.current += data.byteLength
                setProgress(Math.min(100, Math.round((receivedSizeRef.current / currentFileSizeRef.current) * 100)))
                return
            }
            
            if (data.type === 'file-start') {
                const safeName = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 180) : 'shared-file'
                const safeSize = Number(data.size)
                if (!Number.isFinite(safeSize) || safeSize <= 0) return
                setStatus(`Receiving ${safeName}...`)
                setProgress(0)
                setIncomingFile({ name: safeName, size: safeSize })
                currentFileNameRef.current = safeName
                currentFileSizeRef.current = safeSize
                receivedSizeRef.current = 0
                fileChunksRef.current = []
                currentSenderRef.current = senderId
            } else if (data.type === 'file-end') {
                if (!currentSenderRef.current || currentSenderRef.current !== senderId) return
                setStatus('Download complete!')
                const blob = new Blob(fileChunksRef.current)
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = currentFileNameRef.current
                a.click()
                URL.revokeObjectURL(url)
                setTimeout(() => {
                    setStatus('Idle')
                    setIncomingFile(null)
                    setProgress(0)
                    currentSenderRef.current = ''
                }, 3000)
            }
        }

        dataChannelManager.on('ircp-file', handleMessage)
        return () => dataChannelManager.off('ircp-file', handleMessage)
    }, [])

    const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (!file) return
        sendFile(file)
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        sendFile(file)
    }

    const sendFile = async (file: File) => {
        setStatus(`Sending ${file.name}...`)
        setProgress(0)
        
        dataChannelManager.send('ircp-file', {
            type: 'file-start',
            name: file.name,
            size: file.size
        }, peerId)

        const chunkSize = 16384 // 16KB
        const buffer = await file.arrayBuffer()
        let offset = 0

        while (offset < buffer.byteLength) {
            const chunk = buffer.slice(offset, offset + chunkSize)
            dataChannelManager.send('ircp-file', chunk, peerId)
            offset += chunk.byteLength
            setProgress(Math.round((offset / buffer.byteLength) * 100))
            
            // Native WebRTC backpressure handling: Wait if buffer exceeds 1MB
            await dataChannelManager.waitForBuffer('ircp-file', peerId, 1024 * 1024)
        }

        dataChannelManager.send('ircp-file', { type: 'file-end' }, peerId)
        setStatus('Sent successfully!')
        setTimeout(() => setStatus('Idle'), 3000)
    }

    return (
        <div className="bg-[#111] border border-[#222] rounded-xl p-4 flex flex-col gap-3">
            <h3 className="text-xs font-mono text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
                <File className="w-3.5 h-3.5" /> P2P File Transfer
            </h3>
            
            <div 
                onDrop={handleFileDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-[#333] hover:border-[var(--accent)] hover:bg-[#1a1a1a] transition-all rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer relative"
                onClick={() => document.getElementById('file-upload')?.click()}
            >
                <input 
                    type="file" 
                    id="file-upload" 
                    className="hidden" 
                    onChange={handleFileSelect} 
                />
                <UploadCloud className="w-8 h-8 text-[#555] mb-2" />
                <p className="text-xs text-[var(--text-primary)] font-medium">Click or drag file to send securely</p>
                <p className="text-[10px] text-[#555] mt-1">Direct P2P transfer • No size limit</p>
            </div>

            {status !== 'Idle' && (
                <div className="bg-black/50 rounded-lg p-3 border border-[#222]">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono">{status}</span>
                        <span className="text-[10px] text-[var(--accent)] font-mono">{progress}%</span>
                    </div>
                    <div className="h-1 bg-[#222] rounded-full overflow-hidden">
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
