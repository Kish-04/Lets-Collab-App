'use client'

import React, { useRef, useEffect, useState } from 'react'
import { Excalidraw, exportToBlob, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw'
import "@excalidraw/excalidraw/index.css"
import { dataChannelManager } from '@/lib/DataChannelManager'
import { X, Download, Plus, Trash2, Triangle, Star, Hexagon, Component, Heart, Octagon, Pentagon, Copy, ChevronLeft, ChevronRight, Database, Cloud, FileText, ArrowRight, Table, BarChart2 } from 'lucide-react'
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
    const [pageOrder, setPageOrder] = useState<string[]>(['page-1']);
    const [activePageId, setActivePageId] = useState('page-1');
    const [editingPageId, setEditingPageId] = useState<string | null>(null);

    // Shapes Menu State
    const [isShapesMenuOpen, setIsShapesMenuOpen] = useState(false);

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
        setPageOrder(prev => [...prev, newId]);
        broadcastWorkspaceEvent('ADD_PAGE', { newId, newName, elements: [] });
        switchPage(newId);
    }

    const duplicatePage = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!excalidrawAPIRef.current) return;
        
        const newId = `page-${Date.now()}`;
        const newName = `${pageNames[id]} (Copy)`;
        
        const sourceElements = id === activePageId ? excalidrawAPIRef.current.getSceneElements() : (pagesMapRef.current[id] || []);
        const clonedElements = sourceElements.map((el: any) => ({ ...el, id: `${el.id}-copy-${Date.now()}` }));
        
        pagesMapRef.current[newId] = clonedElements;
        setPageNames(prev => ({ ...prev, [newId]: newName }));
        
        const currentIndex = pageOrder.indexOf(id);
        const newOrder = [...pageOrder];
        newOrder.splice(currentIndex + 1, 0, newId);
        setPageOrder(newOrder);
        
        broadcastWorkspaceEvent('ADD_PAGE', { newId, newName, elements: clonedElements, insertAfter: id });
        switchPage(newId);
    }

    const movePage = (id: string, direction: 'left' | 'right', e: React.MouseEvent) => {
        e.stopPropagation();
        const index = pageOrder.indexOf(id);
        if (index === -1) return;
        if (direction === 'left' && index === 0) return;
        if (direction === 'right' && index === pageOrder.length - 1) return;
        
        const newOrder = [...pageOrder];
        const swapIndex = direction === 'left' ? index - 1 : index + 1;
        [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
        
        setPageOrder(newOrder);
        broadcastWorkspaceEvent('REORDER_PAGES', { newOrder });
    }

    const deletePage = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const keys = Object.keys(pageNames);
        if (keys.length <= 1) return;
        
        const newNames = { ...pageNames };
        delete newNames[id];
        delete pagesMapRef.current[id];
        setPageNames(newNames);
        setPageOrder(prev => prev.filter(p => p !== id));
        broadcastWorkspaceEvent('DELETE_PAGE', { targetId: id });
        
        if (activePageId === id) {
            const newOrder = pageOrder.filter(p => p !== id);
            switchPage(newOrder[newOrder.length - 1]);
        }
    }

    const renamePage = (id: string, newName: string) => {
        setPageNames(prev => ({ ...prev, [id]: newName }));
        broadcastWorkspaceEvent('RENAME_PAGE', { targetId: id, newName });
        setEditingPageId(null);
    }

    const injectShape = (shapeType: string) => {
        if (!excalidrawAPIRef.current) return;
        const appState = excalidrawAPIRef.current.getAppState();
        
        let points: number[][] = [];
        if (shapeType === 'triangle') points = [[0, 100], [50, 0], [100, 100], [0, 100]];
        else if (shapeType === 'star') points = [[50,0],[61,35],[98,35],[68,57],[79,91],[50,70],[21,91],[32,57],[2,35],[39,35],[50,0]];
        else if (shapeType === 'hexagon') points = [[50,0],[100,25],[100,75],[50,100],[0,75],[0,25],[50,0]];
        else if (shapeType === 'octagon') points = [[30,0],[70,0],[100,30],[100,70],[70,100],[30,100],[0,70],[0,30],[30,0]];
        else if (shapeType === 'pentagon') points = [[50,0],[100,38],[81,100],[19,100],[0,38],[50,0]];
        else if (shapeType === 'heart') points = [[50,90],[20,60],[5,40],[5,20],[20,5],[40,5],[50,25],[60,5],[80,5],[95,20],[95,40],[80,60],[50,90]];
        else if (shapeType === 'arrowRight') points = [[20,40],[60,40],[60,20],[90,50],[60,80],[60,60],[20,60],[20,40]];
        else if (shapeType === 'document') points = [[20,20],[80,20],[80,80],[60,90],[40,80],[20,90],[20,20]];
        else if (shapeType === 'database') points = [[20,30],[50,20],[80,30],[50,40],[20,30],[20,80],[50,90],[80,80],[80,30]];
        else if (shapeType === 'cloud') points = [[20,80],[10,60],[20,40],[40,20],[60,20],[80,40],[90,60],[80,80],[20,80]];

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

    const insertTable = (rows: number, cols: number) => {
        if (!excalidrawAPIRef.current) return;
        const appState = excalidrawAPIRef.current.getAppState();
        const startX = (appState.scrollX * -1) + (appState.width / 2) - ((cols * 120) / 2);
        const startY = (appState.scrollY * -1) + (appState.height / 2) - ((rows * 40) / 2);
    
        const newElements = [];
        const groupId = `table-group-${Date.now()}`;
        
        for(let r = 0; r < rows; r++) {
            for(let c = 0; c < cols; c++) {
                newElements.push({
                    type: 'rectangle',
                    version: 1,
                    versionNonce: Math.floor(Math.random() * 1000000000),
                    isDeleted: false,
                    id: `table-cell-${Date.now()}-${r}-${c}`,
                    fillStyle: 'solid',
                    strokeWidth: 1,
                    strokeStyle: 'solid',
                    roughness: 0, // perfect straight lines for tables
                    opacity: 100,
                    angle: 0,
                    x: startX + (c * 120),
                    y: startY + (r * 40),
                    strokeColor: '#000000',
                    backgroundColor: 'transparent',
                    width: 120,
                    height: 40,
                    seed: Math.floor(Math.random() * 1000000000),
                    groupIds: [groupId],
                    boundElements: [],
                    updated: Date.now(),
                    locked: false
                });
            }
        }
        const currentElements = excalidrawAPIRef.current.getSceneElements();
        excalidrawAPIRef.current.updateScene({ elements: [...currentElements, ...newElements] });
    }

    const handleInsertTable = () => {
        const input = window.prompt("Enter table size (RowsxCols, e.g. 3x3):", "3x3");
        if (!input) return;
        const [rows, cols] = input.split('x').map(n => parseInt(n));
        if (rows > 0 && cols > 0) insertTable(rows, cols);
        setIsShapesMenuOpen(false);
    }
    
    const handleInsertChart = () => {
        window.alert("To insert a Chart:\n\n1. Copy CSV data or cells from Excel.\n2. Paste (Ctrl+V) directly onto the canvas.\n\nExcalidraw will automatically detect the data and generate a gorgeous vector Bar or Line chart for you!");
        setIsShapesMenuOpen(false);
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
                        pagesMapRef.current[payload.newId] = payload.elements || [];
                        setPageNames(prev => ({ ...prev, [payload.newId]: payload.newName }));
                        setPageOrder(prev => {
                            if (payload.insertAfter) {
                                const idx = prev.indexOf(payload.insertAfter);
                                const newOrder = [...prev];
                                newOrder.splice(idx + 1, 0, payload.newId);
                                return newOrder;
                            }
                            return [...prev, payload.newId];
                        });
                    } else if (payload.action === 'DELETE_PAGE') {
                        const newNames = { ...pageNames };
                        delete newNames[payload.targetId];
                        delete pagesMapRef.current[payload.targetId];
                        setPageNames(newNames);
                        setPageOrder(prev => {
                            const newOrder = prev.filter(p => p !== payload.targetId);
                            if (activePageId === payload.targetId) switchPage(newOrder[newOrder.length - 1]);
                            return newOrder;
                        });
                    } else if (payload.action === 'RENAME_PAGE') {
                        setPageNames(prev => ({ ...prev, [payload.targetId]: payload.newName }));
                    } else if (payload.action === 'REORDER_PAGES') {
                        setPageOrder(payload.newOrder);
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
    }, [peerId, activePageId, pageNames, pageOrder]);

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

    // Pre-load bundled libraries
    useEffect(() => {
        const loadLibraries = async () => {
            if (!excalidrawAPIRef.current) return;
            try {
                // Fetch our bundled local libraries
                const results = await Promise.allSettled([
                    fetch('/libraries/pack0.json').then(res => res.json()),
                    fetch('/libraries/pack1.json').then(res => res.json()),
                    fetch('/libraries/pack2.json').then(res => res.json())
                ]);
                
                let combinedItems: any[] = [];
                results.forEach((res: any) => {
                    if (res.status === 'fulfilled' && res.value?.libraryItems) {
                        combinedItems = [...combinedItems, ...res.value.libraryItems];
                    }
                });
                
                if (combinedItems.length > 0) {
                    excalidrawAPIRef.current.updateLibrary({
                        libraryItems: combinedItems,
                        prompt: false,
                        merge: true
                    });
                }
            } catch (err) {
                console.error("Failed to load local libraries", err);
            }
        };

        // Give Excalidraw a second to mount fully before injecting massive libraries
        const timer = setTimeout(loadLibraries, 1500);
        return () => clearTimeout(timer);
    }, []);

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
        // Notice we removed the CSS rule hiding .layer-ui__library-button so users can access the bundled shapes!
        document.head.appendChild(style);
        return () => { document.head.removeChild(style); };
    }, []);

    return (
        <div className="absolute inset-0 z-[100] flex flex-col bg-[#080810]">
            {/* Top Bar */}
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
            
            {/* Canvas Area */}
            <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden bg-white">
                <div className="flex-1 relative flex">
                    {/* Custom Shapes Sidebar */}
                    <div className="w-16 bg-[#fafafa] border-r border-[#e5e5e5] flex flex-col items-center py-4 gap-4 z-[201] shadow-sm relative">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Tools</div>
                        
                        <button 
                            onClick={() => setIsShapesMenuOpen(!isShapesMenuOpen)} 
                            className={`p-2.5 rounded-xl transition-all group relative shadow-sm ${isShapesMenuOpen ? 'bg-indigo-100 text-indigo-600' : 'bg-white hover:bg-gray-100 text-gray-700'}`} 
                            title="Shapes & Tables"
                        >
                            <Component className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        </button>

                        {isShapesMenuOpen && (
                            <div className="absolute left-full ml-2 top-0 bg-white border border-gray-200 shadow-2xl rounded-xl p-5 w-[320px] max-h-[80vh] overflow-y-auto custom-scrollbar">
                                
                                <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Basic Shapes</div>
                                <div className="grid grid-cols-5 gap-2 mb-6">
                                    <button onClick={() => { injectShape('triangle'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Triangle"><Triangle className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('pentagon'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Pentagon"><Pentagon className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('hexagon'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Hexagon"><Hexagon className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('octagon'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Octagon"><Octagon className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('star'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Star"><Star className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('heart'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-red-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-500 transition-colors" title="Heart"><Heart className="w-5 h-5"/></button>
                                </div>

                                <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Data & Charts</div>
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <button onClick={handleInsertTable} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Insert Table">
                                        <Table className="w-4 h-4 mr-2"/> Table
                                    </button>
                                    <button onClick={handleInsertChart} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Insert Chart">
                                        <BarChart2 className="w-4 h-4 mr-2"/> Chart
                                    </button>
                                </div>
                                
                                <div className="mt-6 text-[10px] text-gray-400 text-center italic">
                                    For 100+ Professional Network & UI Icons, click the <b className="text-gray-500">Library</b> button in the top right.
                                </div>
                            </div>
                        )}
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

                {/* Custom Pages Footer */}
                <div className="h-12 border-t border-[#333] bg-[#1a1a24] flex items-center px-4 shrink-0 relative z-[200]">
                    <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar flex-1">
                        {pageOrder.map((id, index) => {
                            const name = pageNames[id];
                            return (
                            <div 
                                key={id} 
                                onClick={() => switchPage(id)}
                                className={`flex items-center gap-1 px-3 py-1.5 rounded-md cursor-pointer transition-all min-w-max text-sm ${
                                    activePageId === id 
                                    ? 'bg-[var(--accent)] text-black font-bold shadow-md' 
                                    : 'text-gray-400 hover:bg-[#2a2a35] hover:text-white'
                                }`}
                            >
                                {editingPageId === id ? (
                                    <input 
                                        autoFocus
                                        className="bg-transparent border-none outline-none text-black w-24 placeholder-black/50 px-1"
                                        defaultValue={name}
                                        onBlur={(e) => renamePage(id, e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && renamePage(id, e.currentTarget.value)}
                                    />
                                ) : (
                                    <span className="px-1" onDoubleClick={() => setEditingPageId(id)}>{name}</span>
                                )}
                                
                                {/* Advanced Page Controls */}
                                {activePageId === id && (
                                    <div className="flex items-center ml-2 border-l border-white/20 pl-1">
                                        <button onClick={(e) => duplicatePage(id, e)} className="p-1 rounded hover:bg-white/20 text-white/70 hover:text-white" title="Duplicate Page">
                                            <Copy className="w-3.5 h-3.5" />
                                        </button>
                                        <div className="flex mx-1">
                                            <button onClick={(e) => movePage(id, 'left', e)} disabled={index === 0} className="p-0.5 rounded hover:bg-white/20 text-white/70 hover:text-white disabled:opacity-30">
                                                <ChevronLeft className="w-3 h-3" />
                                            </button>
                                            <button onClick={(e) => movePage(id, 'right', e)} disabled={index === pageOrder.length - 1} className="p-0.5 rounded hover:bg-white/20 text-white/70 hover:text-white disabled:opacity-30">
                                                <ChevronRight className="w-3 h-3" />
                                            </button>
                                        </div>
                                        {pageOrder.length > 1 && (
                                            <button onClick={(e) => deletePage(id, e)} className="p-1 rounded hover:bg-red-500/20 text-red-400 hover:text-red-500" title="Delete Page">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )})}
                        <button onClick={addPage} className="p-1.5 ml-2 rounded-md hover:bg-[#2a2a35] text-gray-400 hover:text-white transition-colors flex items-center gap-1" title="Add Page">
                            <Plus className="w-4 h-4" /> <span className="text-sm">New Page</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
