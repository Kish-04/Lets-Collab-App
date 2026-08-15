'use client'

import React, { useRef, useEffect, useState } from 'react'
import { Excalidraw, exportToBlob, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw'
import "@excalidraw/excalidraw/index.css"
import { dataChannelManager } from '@/lib/DataChannelManager'
import { X, Download, Plus, Trash2, Triangle, Star, Hexagon, Component } from 'lucide-react'
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

    // Multi-Page State Management
    const pagesMapRef = useRef<Record<string, any[]>>({ 'page-1': [] });
    const [pageNames, setPageNames] = useState<Record<string, string>>({ 'page-1': 'Page 1' });
    const [activePageId, setActivePageId] = useState('page-1');
    const [editingPageId, setEditingPageId] = useState<string | null>(null);

    const getElementsVersion = (elements: any[]) => {
        return elements.reduce((acc, el) => acc + (el.version || 0), 0);
    }

    const broadcastWorkspaceEvent = (action: string, payload: any) => {
        const roomId = new URLSearchParams(window.location.search).get('room') || 'default-secret';
        const packet = { type: 'excalidraw-workspace', action, ...payload };
        CryptoUtil.encrypt(JSON.stringify(packet), roomId).then(encrypted => {
            dataChannelManager.send('ircp-excalidraw', { encrypted }, peerId)
        }).catch(err => console.error(err));
    }

    const switchPage = (newId: string) => {
        if (!excalidrawAPIRef.current) return;
        pagesMapRef.current[activePageId] = excalidrawAPIRef.current.getSceneElements();
        const newElements = pagesMapRef.current[newId] || [];
        excalidrawAPIRef.current.updateScene({ elements: newElements });
        setActivePageId(newId);
    }

    const addPage = () => {
        const newId = `page-${Date.now()}`;
        const newName = `Page ${Object.keys(pageNames).length + 1}`;
        pagesMapRef.current[newId] = [];
        setPageNames(prev => ({ ...prev, [newId]: newName }));
        broadcastWorkspaceEvent('ADD_PAGE', { newId, newName });
        switchPage(newId);
    }

    const deletePage = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const keys = Object.keys(pageNames);
        if (keys.length <= 1) return;
        
        const newNames = { ...pageNames };
        delete newNames[id];
        delete pagesMapRef.current[id];
        setPageNames(newNames);
        broadcastWorkspaceEvent('DELETE_PAGE', { targetId: id });
        
        if (activePageId === id) {
            const nextKeys = Object.keys(newNames);
            switchPage(nextKeys[nextKeys.length - 1]);
        }
    }

    const renamePage = (id: string, newName: string) => {
        setPageNames(prev => ({ ...prev, [id]: newName }));
        broadcastWorkspaceEvent('RENAME_PAGE', { targetId: id, newName });
        setEditingPageId(null);
    }

    const injectShape = (shapeType: 'triangle' | 'star' | 'hexagon') => {
        if (!excalidrawAPIRef.current) return;
        const appState = excalidrawAPIRef.current.getAppState();
        
        let points: number[][] = [];
        if (shapeType === 'triangle') points = [[0, 100], [50, 0], [100, 100], [0, 100]];
        else if (shapeType === 'star') points = [[50,0],[61,35],[98,35],[68,57],[79,91],[50,70],[21,91],[32,57],[2,35],[39,35],[50,0]];
        else if (shapeType === 'hexagon') points = [[50,0],[100,25],[100,75],[50,100],[0,75],[0,25],[50,0]];

        const newElement = {
            type: 'line',
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000000),
            isDeleted: false,
            id: `custom-shape-${Date.now()}`,
            fillStyle: appState.currentItemFillStyle || 'hachure',
            strokeWidth: appState.currentItemStrokeWidth || 1,
            strokeStyle: appState.currentItemStrokeStyle || 'solid',
            roughness: appState.currentItemRoughness || 1,
            opacity: appState.currentItemOpacity || 100,
            angle: 0,
            x: (appState.scrollX * -1) + (appState.width / 2) - 50,
            y: (appState.scrollY * -1) + (appState.height / 2) - 50,
            strokeColor: appState.currentItemStrokeColor || '#000000',
            backgroundColor: appState.currentItemBackgroundColor || 'transparent',
            width: 100,
            height: 100,
            seed: Math.floor(Math.random() * 1000000000),
            groupIds: [],
            boundElements: [],
            updated: Date.now(),
            locked: false,
            points
        };

        const currentElements = excalidrawAPIRef.current.getSceneElements();
        excalidrawAPIRef.current.updateScene({ elements: [...currentElements, newElement] });
    }

    const onChange = (elements: readonly any[], appState: any) => {
        if (isApplyingRemoteUpdateRef.current) return;
        
        const currentVersion = getElementsVersion(elements as any[]);
        if (currentVersion === lastSentElementsVersionRef.current) return;
        lastSentElementsVersionRef.current = currentVersion;
        pagesMapRef.current[activePageId] = [...elements];

        const payload = { type: 'excalidraw-sync', pageId: activePageId, elements };
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
                
                if (payload.type === 'excalidraw-workspace') {
                    if (payload.action === 'ADD_PAGE') {
                        pagesMapRef.current[payload.newId] = [];
                        setPageNames(prev => ({ ...prev, [payload.newId]: payload.newName }));
                    } else if (payload.action === 'DELETE_PAGE') {
                        const newNames = { ...pageNames };
                        delete newNames[payload.targetId];
                        delete pagesMapRef.current[payload.targetId];
                        setPageNames(newNames);
                        if (activePageId === payload.targetId) {
                            const nextKeys = Object.keys(newNames);
                            switchPage(nextKeys[nextKeys.length - 1]);
                        }
                    } else if (payload.action === 'RENAME_PAGE') {
                        setPageNames(prev => ({ ...prev, [payload.targetId]: payload.newName }));
                    }
                    return;
                }

                if (payload.type === 'excalidraw-sync') {
                    if (payload.pageId === activePageId) {
                        isApplyingRemoteUpdateRef.current = true;
                        excalidrawAPIRef.current.updateScene({ elements: payload.elements });
                        lastSentElementsVersionRef.current = getElementsVersion(payload.elements);
                        setTimeout(() => { isApplyingRemoteUpdateRef.current = false; }, 50);
                    }
                    pagesMapRef.current[payload.pageId] = payload.elements;
                }
                
            } catch (e) {
                console.error("Failed to decrypt or apply remote draw", e);
            }
        }

        dataChannelManager.on('ircp-excalidraw', handleRemoteDraw)
        return () => {
            dataChannelManager.off('ircp-excalidraw', handleRemoteDraw)
        }
    }, [peerId, activePageId, pageNames]);

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

    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            .excalidraw .layer-ui__wrapper .FixedSideContainer--bottom-right {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
            .excalidraw .layer-ui__wrapper .HelpIcon {
                display: none !important;
            }
        `;
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
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
                
                {/* Custom Pages UI */}
                <div className="flex-1 max-w-2xl mx-8 flex items-center gap-1 overflow-x-auto bg-[#1a1a24] p-1 rounded-lg border border-[#333] custom-scrollbar">
                    {Object.entries(pageNames).map(([id, name]) => (
                        <div 
                            key={id} 
                            onClick={() => switchPage(id)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all min-w-max text-sm ${
                                activePageId === id 
                                ? 'bg-[var(--accent)] text-black font-bold shadow-md' 
                                : 'text-gray-400 hover:bg-[#2a2a35] hover:text-white'
                            }`}
                        >
                            {editingPageId === id ? (
                                <input 
                                    autoFocus
                                    className="bg-transparent border-none outline-none text-black w-24"
                                    defaultValue={name}
                                    onBlur={(e) => renamePage(id, e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && renamePage(id, e.currentTarget.value)}
                                />
                            ) : (
                                <span onDoubleClick={() => setEditingPageId(id)}>{name}</span>
                            )}
                            {Object.keys(pageNames).length > 1 && (
                                <button 
                                    onClick={(e) => deletePage(id, e)} 
                                    className={`p-1 rounded-full opacity-60 hover:opacity-100 ${activePageId === id ? 'hover:bg-black/20' : 'hover:bg-white/10'}`}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    ))}
                    <button onClick={addPage} className="p-1.5 ml-2 rounded-md hover:bg-[#2a2a35] text-gray-400 hover:text-white transition-colors" title="Add Page">
                        <Plus className="w-4 h-4" />
                    </button>
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
            
            <div className="relative min-h-0 flex-1 overflow-hidden bg-white flex">
                {/* Custom Shapes Sidebar */}
                <div className="w-16 bg-[#fafafa] border-r border-[#e5e5e5] flex flex-col items-center py-4 gap-4 z-[201] shadow-sm">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Shapes</div>
                    <button onClick={() => injectShape('triangle')} className="p-2.5 rounded-xl hover:bg-[#ececec] text-gray-700 transition-all group relative" title="Add Triangle">
                        <Triangle className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    </button>
                    <button onClick={() => injectShape('star')} className="p-2.5 rounded-xl hover:bg-[#ececec] text-gray-700 transition-all group relative" title="Add Star">
                        <Star className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    </button>
                    <button onClick={() => injectShape('hexagon')} className="p-2.5 rounded-xl hover:bg-[#ececec] text-gray-700 transition-all group relative" title="Add Hexagon">
                        <Hexagon className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    </button>
                    <div className="w-8 h-px bg-gray-300 my-2"></div>
                    <button className="p-2.5 rounded-xl text-gray-400 cursor-not-allowed" title="More shapes in Excalidraw Library">
                        <Component className="w-5 h-5" />
                    </button>
                </div>

                <CanvasErrorBoundary>
                    <div className="flex-1 relative h-full">
                        <Excalidraw
                            excalidrawAPI={(api) => { excalidrawAPIRef.current = api; }}
                            onChange={onChange}
                            UIOptions={{ canvasActions: { loadScene: false, export: false, saveAsImage: false } }}
                        >
                            <MainMenu>
                                <MainMenu.DefaultItems.ClearCanvas />
                                <MainMenu.DefaultItems.ChangeCanvasBackground />
                            </MainMenu>
                            <WelcomeScreen>
                                <WelcomeScreen.Hints.ToolbarHint />
                            </WelcomeScreen>
                        </Excalidraw>
                    </div>
                </CanvasErrorBoundary>
            </div>
        </div>
    )
}
