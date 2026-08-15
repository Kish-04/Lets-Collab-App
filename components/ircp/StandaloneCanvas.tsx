'use client'

import React, { useRef, useEffect } from 'react'
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw'
import "@excalidraw/excalidraw/index.css"
import { dataChannelManager } from '@/lib/DataChannelManager'
import { X, Download } from 'lucide-react'
import { CryptoUtil } from '@/lib/CryptoUtil'

interface Props {
    peerId?: string
    isHost: boolean
    onClose: () => void
}

class CanvasErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, errorMsg: string}> {
    constructor(props: {children: React.ReactNode}) {
        super(props);
        this.state = { hasError: false, errorMsg: '' };
    }

    static getDerivedStateFromError(error: any) {
        return { hasError: true, errorMsg: error?.message || String(error) };
    }

    componentDidCatch(error: any, errorInfo: any) {
        console.error("Excalidraw crashed.", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex-1 flex flex-col items-center justify-center text-white p-8 text-center bg-[#111]">
                    <h2 className="text-2xl font-bold mb-4 text-red-500">Canvas Component Crashed</h2>
                    <p className="mb-4 text-[var(--text-secondary)]">Error: <b>{this.state.errorMsg}</b></p>
                    <button onClick={() => window.location.reload()} className="px-6 py-2 bg-[var(--accent)] text-black font-bold rounded-lg transition-transform hover:scale-105">
                        Reload Page
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export function StandaloneCanvas({ peerId, isHost, onClose }: Props) {
    const excalidrawAPIRef = useRef<any>(null);
    const isApplyingRemoteUpdateRef = useRef(false);
    const lastSentElementsVersionRef = useRef<number>(0);

    // Calculate a naive version hash for elements to avoid sending redundant updates
    const getElementsVersion = (elements: any[]) => {
        return elements.reduce((acc, el) => acc + (el.version || 0), 0);
    }

    const onChange = (elements: readonly any[], appState: any) => {
        if (isApplyingRemoteUpdateRef.current) return;
        
        const currentVersion = getElementsVersion(elements as any[]);
        if (currentVersion === lastSentElementsVersionRef.current) return;
        lastSentElementsVersionRef.current = currentVersion;

        const payload = { elements };
        const roomId = new URLSearchParams(window.location.search).get('room') || 'default-secret';
        
        CryptoUtil.encrypt(JSON.stringify(payload), roomId).then(encrypted => {
            dataChannelManager.send('ircp-excalidraw', { encrypted }, peerId)
        }).catch(err => console.error("Encryption failed for Excalidraw payload:", err));
    };

    useEffect(() => {
        const handleRemoteDraw = async (payloadWrapper: any) => {
            if (!excalidrawAPIRef.current) return;
            
            try {
                const roomId = new URLSearchParams(window.location.search).get('room') || 'default-secret';
                let payload = payloadWrapper;
                if (payloadWrapper.encrypted) {
                    const decrypted = await CryptoUtil.decrypt(payloadWrapper.encrypted, roomId);
                    payload = JSON.parse(decrypted);
                }
                
                isApplyingRemoteUpdateRef.current = true;
                
                // Excalidraw handles merging elements based on version/versionNonce automatically
                excalidrawAPIRef.current.updateScene({
                    elements: payload.elements
                });
                
                // Update our local version tracker so we don't echo back
                lastSentElementsVersionRef.current = getElementsVersion(payload.elements);
                
            } catch (e) {
                console.error("Failed to decrypt or apply remote draw", e);
            } finally {
                // Slight delay to allow Excalidraw's internal React updates to settle
                setTimeout(() => {
                    isApplyingRemoteUpdateRef.current = false;
                }, 50);
            }
        }

        dataChannelManager.on('ircp-excalidraw', handleRemoteDraw)
        return () => {
            dataChannelManager.off('ircp-excalidraw', handleRemoteDraw)
        }
    }, [peerId]);

    const handleSave = async () => {
        if (!excalidrawAPIRef.current) return;
        try {
            const elements = excalidrawAPIRef.current.getSceneElements();
            if (!elements || elements.length === 0) return;
            
            const blob = await exportToBlob({
                elements,
                mimeType: "image/png",
                appState: excalidrawAPIRef.current.getAppState()
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `whiteboard-${new Date().toISOString().slice(0,10)}.png`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Failed to save Excalidraw image:", err);
        }
    };

    // To hide Excalidraw's watermark, we can inject a small CSS override globally here
    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .excalidraw .layer-ui__wrapper .FixedSideContainer--bottom-right {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
            .excalidraw .excalidraw__canvas {
                background: white !important;
            }
        `;
        document.head.appendChild(style);
        return () => {
            document.head.removeChild(style);
        };
    }, []);

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
                        onClick={handleSave} 
                        className="p-2 bg-[var(--accent)] text-black hover:brightness-110 rounded-lg transition-all flex items-center gap-2 text-sm font-bold" 
                        title="Save Image"
                    >
                        <Download className="w-4 h-4" /> Save
                    </button>
                </div>
            </div>
            
            <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
                <CanvasErrorBoundary>
                    <div className="absolute inset-0 h-full w-full">
                        <Excalidraw
                            excalidrawAPI={(api) => { excalidrawAPIRef.current = api; }}
                            onChange={onChange}
                        />
                    </div>
                </CanvasErrorBoundary>
            </div>
        </div>
    )
}
