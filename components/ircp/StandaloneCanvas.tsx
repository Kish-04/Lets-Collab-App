'use client'

import React from 'react'
import { Tldraw, useEditor } from 'tldraw'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { X, Download, FilePlus } from 'lucide-react'
import { CryptoUtil } from '@/lib/CryptoUtil'

interface Props {
    peerId?: string
    isHost: boolean
    onClose: () => void
}

class CanvasErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
    constructor(props: {children: React.ReactNode}) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true };
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error("Tldraw crashed. Often caused by AdBlockers hiding the canvas.", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center text-white p-8 text-center bg-[#111]">
                    <h2 className="text-2xl font-bold mb-4 text-red-500">Canvas Component Crashed</h2>
                    <p className="mb-4 text-[var(--text-secondary)]">This is usually caused by an <b>Ad Blocker</b> or browser extension aggressively hiding UI elements.</p>
                    <p className="mb-6 text-[var(--text-secondary)]">Please disable your Ad Blocker for this site, or try using an Incognito window.</p>
                    <button onClick={() => window.location.reload()} className="px-6 py-2 bg-[var(--accent)] text-black font-bold rounded-lg transition-transform hover:scale-105">
                        Reload Page
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

function SyncEngine({ peerId }: { peerId?: string }) {
    const editor = useEditor()
    
    React.useEffect(() => {
        if (!editor) return

        let isApplyingRemoteUpdate = false

        const unlisten = editor.store.listen((entry) => {
            if (isApplyingRemoteUpdate) return
            
            const changes = Object.values(entry.changes.added).filter(r => r.typeName !== 'instance' && r.typeName !== 'camera' && r.typeName !== 'pointer')
            const updates = Object.values(entry.changes.updated).map(u => u[1]).filter(r => r.typeName !== 'instance' && r.typeName !== 'camera' && r.typeName !== 'pointer')
            const removed = Object.values(entry.changes.removed).filter(r => r.typeName !== 'instance' && r.typeName !== 'camera' && r.typeName !== 'pointer')
            
            if (changes.length > 0 || updates.length > 0 || removed.length > 0) {
                const payload = {
                    added: Object.fromEntries(changes.map(c => [c.id, c])),
                    updated: Object.fromEntries(updates.map(u => [u.id, u])),
                    removed: Object.fromEntries(removed.map(r => [r.id, r]))
                }
                const roomId = new URLSearchParams(window.location.search).get('room') || 'default-secret';
                CryptoUtil.encrypt(JSON.stringify(payload), roomId).then(encrypted => {
                    dataChannelManager.send('ircp-tldraw', { encrypted }, peerId)
                });
            }
        }, { scope: 'document', source: 'user' })

        const handleRemoteDraw = async (payloadWrapper: any) => {
            isApplyingRemoteUpdate = true
            try {
                const roomId = new URLSearchParams(window.location.search).get('room') || 'default-secret';
                let payload = payloadWrapper;
                if (payloadWrapper.encrypted) {
                    const decrypted = await CryptoUtil.decrypt(payloadWrapper.encrypted, roomId);
                    payload = JSON.parse(decrypted);
                }
                editor.store.mergeRemoteChanges(() => {
                    const { added, updated, removed } = payload
                    if (added) editor.store.put(Object.values(added) as any)
                    if (updated) editor.store.put(Object.values(updated) as any)
                    if (removed) editor.store.remove(Object.keys(removed) as any)
                })
            } catch (e) {
                console.error("Failed to decrypt or apply remote draw", e);
            } finally {
                isApplyingRemoteUpdate = false
            }
        }

        dataChannelManager.on('ircp-tldraw', handleRemoteDraw)
        return () => {
            unlisten()
            dataChannelManager.off('ircp-tldraw', handleRemoteDraw)
        }
    }, [editor, peerId])

    return null
}

function CanvasDiagnostics() {
    React.useEffect(() => {
        const canvas = document.createElement('canvas')
        const webgl =
            canvas.getContext('webgl2') ||
            canvas.getContext('webgl') ||
            canvas.getContext('experimental-webgl')
        console.info(`[CanvasDiagnostics] WebGL available: ${Boolean(webgl)}`)
    }, [])

    return null
}

export function StandaloneCanvas({ peerId, isHost, onClose }: Props) {
    return (
        <div className="absolute inset-0 z-[100] flex flex-col bg-[#080810]">
            <div className="h-14 border-b border-[#222] bg-[#111] flex items-center justify-between px-4 shrink-0 relative z-[200]">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-[#222] rounded-lg transition-colors text-[var(--text-dim)] shadow-sm">
                        <X className="w-5 h-5" />
                    </button>
                    <span className="font-bold tracking-widest text-[var(--text-dim)]">CANVAS MODE</span>
                </div>
                <div className="flex items-center gap-4">
                    <button 
                        onClick={() => window.dispatchEvent(new CustomEvent('tldraw-save'))} 
                        className="p-2 bg-[var(--accent)] text-black hover:brightness-110 rounded-lg transition-all flex items-center gap-2 text-sm font-bold" 
                        title="Save Image"
                    >
                        <Download className="w-4 h-4" /> Save
                    </button>
                </div>
            </div>
            
            <div className="relative min-h-0 flex-1 overflow-hidden bg-white tldraw-wrapper">
                <CanvasErrorBoundary>
                    <div className="absolute inset-0 h-full w-full">
                        <Tldraw 
                            components={{
                                SharePanel: () => null
                            }}
                        >
                            <CanvasDiagnostics />
                            <SyncEngine peerId={peerId} />
                        </Tldraw>
                    </div>
                </CanvasErrorBoundary>
            </div>
        </div>
    )
}
