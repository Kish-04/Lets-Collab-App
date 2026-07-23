'use client'

import React, { useState, useEffect, useRef } from 'react'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { MessageSquare, Send } from 'lucide-react'

type Message = {
    id: string;
    text: string;
    sender: 'me' | 'them';
    timestamp: number;
}

export function P2PChat({ peerId }: { peerId?: string }) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [isOpen, setIsOpen] = useState(false)
    const [unread, setUnread] = useState(0)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleMessage = (data: any, senderId: string) => {
            if (data.type === 'chat-msg') {
                setMessages(prev => [...prev, {
                    id: Math.random().toString(),
                    text: data.text,
                    sender: 'them',
                    timestamp: data.timestamp
                }])
                if (!isOpen) {
                    setUnread(prev => prev + 1)
                }
            }
        }

        dataChannelManager.on('ircp-chat', handleMessage)
        return () => dataChannelManager.off('ircp-chat', handleMessage)
    }, [isOpen])

    useEffect(() => {
        if (isOpen) {
            setUnread(0)
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages, isOpen])

    const sendMessage = (e: React.FormEvent) => {
        e.preventDefault()
        if (!input.trim()) return

        const msg: Message = {
            id: Math.random().toString(),
            text: input,
            sender: 'me',
            timestamp: Date.now()
        }

        dataChannelManager.send('ircp-chat', {
            type: 'chat-msg',
            text: msg.text,
            timestamp: msg.timestamp
        }, peerId)

        setMessages(prev => [...prev, msg])
        setInput('')
    }

    return (
        <div className="fixed bottom-4 left-4 z-50">
            {isOpen ? (
                <div className="w-80 bg-[#111] border border-[#222] rounded-xl flex flex-col overflow-hidden shadow-2xl">
                    <div className="p-3 border-b border-[#222] flex justify-between items-center bg-[#1a1a1a]">
                        <h3 className="text-xs font-mono text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-[var(--accent)]" /> P2P Chat
                        </h3>
                        <button onClick={() => setIsOpen(false)} className="text-[#555] hover:text-white transition-colors">
                            &times;
                        </button>
                    </div>

                    <div className="h-64 p-3 overflow-y-auto flex flex-col gap-2">
                        {messages.length === 0 ? (
                            <p className="text-[10px] text-center text-[#555] mt-auto mb-auto">E2E Encrypted Data Channel</p>
                        ) : (
                            messages.map(m => (
                                <div key={m.id} className={`flex flex-col max-w-[80%] ${m.sender === 'me' ? 'self-end' : 'self-start'}`}>
                                    <div className={`p-2 rounded-lg text-xs ${m.sender === 'me' ? 'bg-[var(--accent)]/20 text-white border border-[var(--accent)]/30' : 'bg-[#222] text-[var(--text-secondary)] border border-[#333]'}`}>
                                        {m.text}
                                    </div>
                                    <span className={`text-[8px] text-[#555] mt-1 ${m.sender === 'me' ? 'text-right' : 'text-left'}`}>
                                        {new Date(m.timestamp).toLocaleTimeString()}
                                    </span>
                                </div>
                            ))
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    <form onSubmit={sendMessage} className="p-2 border-t border-[#222] bg-[#1a1a1a] flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder="Encrypted message..."
                            className="flex-1 bg-[#222] border border-[#333] rounded-md px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent)]"
                        />
                        <button type="submit" className="bg-[var(--accent)] text-black p-1.5 rounded-md hover:opacity-80 transition-opacity">
                            <Send className="w-4 h-4" />
                        </button>
                    </form>
                </div>
            ) : (
                <button 
                    onClick={() => setIsOpen(true)}
                    className="w-12 h-12 bg-[#111] border border-[#222] hover:border-[var(--accent)] rounded-full flex items-center justify-center shadow-lg transition-all relative"
                >
                    <MessageSquare className="w-5 h-5 text-[var(--text-primary)]" />
                    {unread > 0 && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">
                            {unread}
                        </span>
                    )}
                </button>
            )}
        </div>
    )
}
