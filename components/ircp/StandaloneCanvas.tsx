'use client'

import React from 'react'
import { Tldraw, useEditor } from 'tldraw'
import 'tldraw/tldraw.css'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { X, Download, FilePlus } from 'lucide-react'
import { CryptoUtil } from '@/lib/CryptoUtil'

interface Props {
    peerId?: string
    isHost: boolean
    onClose: () => void
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
            
            <div className="relative flex-1 overflow-hidden tldraw-wrapper">
                <Tldraw 
                    persistenceKey={`collab-canvas-${peerId || 'local'}`}
                    components={{
                        SharePanel: () => null
                    }}
                >
                    <SyncEngine peerId={peerId} />
                </Tldraw>
            </div>
            
            <style dangerouslySetInnerHTML={{__html: `
                .tldraw-wrapper [class*="watermark"],
                .tldraw-wrapper [class*="badge"] {
                    display: none !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                    pointer-events: none !important;
                }
            `}} />
        </div>
    )
}
