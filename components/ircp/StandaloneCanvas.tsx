'use client'

import React, { useRef, useEffect, useState } from 'react'
import { Excalidraw, exportToBlob, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw'
import "@excalidraw/excalidraw/index.css"
import { dataChannelManager } from '@/lib/DataChannelManager'
import { X, Download, Plus, Trash2, Triangle, Star, Hexagon, Component, Heart, Octagon, Pentagon, Copy, ChevronLeft, ChevronRight, Database, Cloud, FileText, ArrowRight, Table as TableIcon, BarChart2, MessageCircle, Zap, PlusSquare, Ribbon, ArrowLeft, ArrowUp, ArrowDown } from 'lucide-react'
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
    
    // Custom Modals State (To bypass Electron native dialog limits)
    const [tablePromptOpen, setTablePromptOpen] = useState(false);
    const [tableRows, setTableRows] = useState(3);
    const [tableCols, setTableCols] = useState(3);
    const [chartAlertOpen, setChartAlertOpen] = useState(false);

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
        const startX = (appState.scrollX * -1) + (appState.width / 2) - 50;
        const startY = (appState.scrollY * -1) + (appState.height / 2) - 50;
        const currentElements = excalidrawAPIRef.current.getSceneElements();

        const baseElement = {
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
            x: startX,
            y: startY,
            strokeColor: appState.currentItemStrokeColor || '#000000',
            backgroundColor: appState.currentItemBackgroundColor || 'transparent',
            width: 100,
            height: 100,
            seed: Math.floor(Math.random() * 1000000000),
            groupIds: [],
            boundElements: [],
            updated: Date.now(),
            locked: false
        };
        
        let points: number[][] = [];
        if (shapeType === 'triangle') points = [[0, 100], [50, 0], [100, 100], [0, 100]];
        else if (shapeType === 'star') points = [[50,0],[61,35],[98,35],[68,57],[79,91],[50,70],[21,91],[32,57],[2,35],[39,35],[50,0]];
        else if (shapeType === 'hexagon') points = [[50,0],[100,25],[100,75],[50,100],[0,75],[0,25],[50,0]];
        else if (shapeType === 'octagon') points = [[30,0],[70,0],[100,30],[100,70],[70,100],[30,100],[0,70],[0,30],[30,0]];
        else if (shapeType === 'pentagon') points = [[50,0],[100,38],[81,100],[19,100],[0,38],[50,0]];
        else if (shapeType === 'heart') points = [[50,90],[20,60],[5,40],[5,20],[20,5],[40,5],[50,25],[60,5],[80,5],[95,20],[95,40],[80,60],[50,90]];
        else if (shapeType === 'arrowRight') points = [[20,40],[60,40],[60,20],[90,50],[60,80],[60,60],[20,60],[20,40]];
        else if (shapeType === 'arrowLeft') points = [[80,40],[40,40],[40,20],[10,50],[40,80],[40,60],[80,60],[80,40]];
        else if (shapeType === 'arrowUp') points = [[40,80],[40,40],[20,40],[50,10],[80,40],[60,40],[60,80],[40,80]];
        else if (shapeType === 'arrowDown') points = [[40,20],[40,60],[20,60],[50,90],[80,60],[60,60],[60,20],[40,20]];
        else if (shapeType === 'document') points = [[20,20],[80,20],[80,80],[60,90],[40,80],[20,90],[20,20]];
        else if (shapeType === 'database') points = [[20,30],[50,20],[80,30],[50,40],[20,30],[20,80],[50,90],[80,80],[80,30]];
        else if (shapeType === 'cloud') points = [[20,80],[10,60],[20,40],[40,20],[60,20],[80,40],[90,60],[80,80],[20,80]];
        else if (shapeType === 'parallelogram') points = [[20,100], [40,0], [100,0], [80,100], [20,100]];
        else if (shapeType === 'speechBubble') points = [[0,0], [100,0], [100,80], [80,80], [80,100], [60,80], [0,80], [0,0]];
        else if (shapeType === 'lightning') points = [[60,0], [20,60], [50,60], [40,100], [80,40], [50,40], [60,0]];
        else if (shapeType === 'cross') points = [[30,0], [70,0], [70,30], [100,30], [100,70], [70,70], [70,100], [30,100], [30,70], [0,70], [0,30], [30,30], [30,0]];
        else if (shapeType === 'ribbon') points = [[0,20], [20,20], [20,0], [80,0], [80,20], [100,20], [90,50], [100,80], [80,80], [80,100], [20,100], [20,80], [0,80], [10,50], [0,20]];

        excalidrawAPIRef.current.updateScene({ 
            elements: [...currentElements, { ...baseElement, type: 'line', points }] 
        });
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

    const handleConfirmTable = () => {
        if (tableRows > 0 && tableCols > 0) insertTable(tableRows, tableCols);
        setTablePromptOpen(false);
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
                    fetch('/libraries/pack2.json').then(res => res.json()),
                    fetch('/libraries/pack3.json').then(res => res.json()),
                    fetch('/libraries/pack4.json').then(res => res.json()),
                    fetch('/libraries/pack5.json').then(res => res.json()),
                    fetch('/libraries/pack6.json').then(res => res.json()),
                    fetch('/libraries/pack7.json').then(res => res.json()),
                    fetch('/libraries/pack8.json').then(res => res.json()),
                    fetch('/libraries/pack9.json').then(res => res.json()),
                    fetch('/libraries/pack10.json').then(res => res.json()),
                    fetch('/libraries/pack11.json').then(res => res.json()),
                    fetch('/libraries/pack12.json').then(res => res.json()),
                    fetch('/libraries/pack13.json').then(res => res.json()),
                    fetch('/libraries/pack14.json').then(res => res.json()),
                    fetch('/libraries/pack15.json').then(res => res.json()),
                    fetch('/libraries/pack16.json').then(res => res.json())
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
                            <div className="absolute left-full ml-2 top-0 bg-white border border-gray-200 shadow-2xl rounded-xl p-5 w-[360px] max-h-[85vh] overflow-y-auto custom-scrollbar">
                                
                                <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Basic Geometries</div>
                                <div className="grid grid-cols-6 gap-2 mb-5">
                                    <button onClick={() => { injectShape('triangle'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Triangle"><Triangle className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('parallelogram'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Parallelogram"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="4 20 8 4 20 4 16 20 4 20"></polygon></svg></button>
                                    <button onClick={() => { injectShape('pentagon'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Pentagon"><Pentagon className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('hexagon'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Hexagon"><Hexagon className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('octagon'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Octagon"><Octagon className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('star'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Star"><Star className="w-5 h-5"/></button>
                                </div>

                                <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Block Arrows</div>
                                <div className="grid grid-cols-6 gap-2 mb-5">
                                    <button onClick={() => { injectShape('arrowRight'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Right"><ArrowRight className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('arrowLeft'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Left"><ArrowLeft className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('arrowUp'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Up"><ArrowUp className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('arrowDown'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Down"><ArrowDown className="w-5 h-5"/></button>
                                </div>

                                <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Flowchart</div>
                                <div className="grid grid-cols-6 gap-2 mb-5">
                                    <button onClick={() => { injectShape('database'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Database"><Database className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('cloud'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Cloud"><Cloud className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('document'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Document"><FileText className="w-5 h-5"/></button>
                                </div>

                                <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Fun Shapes</div>
                                <div className="grid grid-cols-6 gap-2 mb-6">
                                    <button onClick={() => { injectShape('speechBubble'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Speech Bubble"><MessageCircle className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('lightning'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Lightning Bolt"><Zap className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('cross'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Cross"><PlusSquare className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('ribbon'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Ribbon"><Ribbon className="w-5 h-5"/></button>
                                    <button onClick={() => { injectShape('heart'); setIsShapesMenuOpen(false); }} className="p-2 hover:bg-red-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-500 transition-colors" title="Heart"><Heart className="w-5 h-5"/></button>
                                </div>

                                <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Data & Charts</div>
                                <div className="grid grid-cols-2 gap-2 mb-2">
                                    <button onClick={() => setTablePromptOpen(true)} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Insert Table">
                                        <TableIcon className="w-4 h-4 mr-2"/> Table
                                    </button>
                                    <button onClick={() => setChartAlertOpen(true)} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Insert Chart">
                                        <BarChart2 className="w-4 h-4 mr-2"/> Chart
                                    </button>
                                </div>
                                
                                <div className="mt-6 text-[10px] text-gray-400 text-center italic border-t border-gray-100 pt-3">
                                    For native Shapes & Icons, click the <b className="text-gray-500">Library button</b> in the top right.
                                </div>
                            </div>
                        )}
                    </div>

                    <CanvasErrorBoundary>
                        <div className="flex-1 relative h-full">
                            <Excalidraw 
                                excalidrawAPI={(api) => excalidrawAPIRef.current = api}
                                onChange={onChange}
                                UIOptions={{
                                    canvasActions: {
                                        loadScene: false,
                                        export: false,
                                        saveToActiveFile: false,
                                        toggleTheme: false
                                    }
                                }}
                            >
                                <MainMenu>
                                    <MainMenu.DefaultItems.ClearCanvas />
                                    <MainMenu.DefaultItems.Export />
                                    <MainMenu.DefaultItems.SaveAsImage />
                                    <MainMenu.DefaultItems.Help />
                                </MainMenu>
                                <WelcomeScreen>
                                    <WelcomeScreen.Hints.MenuHint />
                                    <WelcomeScreen.Hints.ToolbarHint />
                                    <WelcomeScreen.Hints.HelpHint />
                                </WelcomeScreen>
                            </Excalidraw>
                        </div>
                    </CanvasErrorBoundary>
                </div>
                
                {/* Multi-Page Navigation Bar */}
                <div className="h-12 border-t border-[#e5e5e5] bg-[#fafafa] flex items-center px-2 shrink-0 overflow-x-auto custom-scrollbar z-[200]">
                    <div className="flex items-center gap-1 shrink-0">
                        {pageOrder.map((id, index) => (
                            <div 
                                key={id} 
                                className={`group flex items-center px-3 py-1.5 rounded-md text-sm border-2 cursor-pointer transition-colors ${
                                    activePageId === id 
                                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-bold' 
                                    : 'border-transparent text-gray-600 hover:bg-gray-100'
                                }`}
                                onClick={() => switchPage(id)}
                            >
                                {editingPageId === id ? (
                                    <input 
                                        autoFocus
                                        type="text" 
                                        defaultValue={pageNames[id]} 
                                        onBlur={(e) => renamePage(id, e.target.value || `Page ${index + 1}`)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') renamePage(id, (e.target as HTMLInputElement).value || `Page ${index + 1}`);
                                            if (e.key === 'Escape') setEditingPageId(null);
                                        }}
                                        className="bg-white border border-indigo-300 rounded px-1 w-24 text-sm text-black outline-none"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <>
                                        <span onDoubleClick={(e) => { e.stopPropagation(); setEditingPageId(id); }}>{pageNames[id]}</span>
                                        <div className="ml-2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={(e) => duplicatePage(id, e)} className="p-1 hover:bg-gray-200 rounded text-gray-500" title="Duplicate Page">
                                                <Copy className="w-3 h-3" />
                                            </button>
                                            {pageOrder.length > 1 && (
                                                <button onClick={(e) => deletePage(id, e)} className="p-1 hover:bg-red-100 rounded text-red-500" title="Delete Page">
                                                    <Trash2 className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                    
                    <button 
                        onClick={addPage} 
                        className="ml-2 p-1.5 bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-md shadow-sm flex items-center gap-1 text-xs font-semibold shrink-0 transition-colors"
                    >
                        <Plus className="w-3 h-3" /> New Page
                    </button>
                </div>
            </div>
            
            {/* Custom React Modals to bypass Electron window dialog restrictions */}
            {tablePromptOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-[300px]">
                        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><TableIcon className="w-5 h-5 mr-2 text-indigo-600"/> Insert Table</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1">Rows</label>
                                <input type="number" min="1" max="20" value={tableRows} onChange={(e) => setTableRows(parseInt(e.target.value) || 1)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-600 mb-1">Columns</label>
                                <input type="number" min="1" max="20" value={tableCols} onChange={(e) => setTableCols(parseInt(e.target.value) || 1)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-800" />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button onClick={() => setTablePromptOpen(false)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
                            <button onClick={handleConfirmTable} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700">Insert</button>
                        </div>
                    </div>
                </div>
            )}

            {chartAlertOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-[400px]">
                        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><BarChart2 className="w-5 h-5 mr-2 text-indigo-600"/> How to Insert Charts</h3>
                        <div className="text-gray-600 space-y-3 mb-6">
                            <p>Excalidraw natively supports data chart generation via clipboard.</p>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Copy CSV text or highlight and copy cells from Microsoft Excel / Google Sheets.</li>
                                <li>Simply press <b>Ctrl+V</b> (or Cmd+V) directly onto the canvas.</li>
                            </ol>
                            <p className="text-sm bg-blue-50 text-blue-800 p-3 rounded-lg border border-blue-100">The canvas will instantly parse your clipboard and render a beautiful vector Bar or Line chart.</p>
                        </div>
                        <div className="flex justify-end">
                            <button onClick={() => setChartAlertOpen(false)} className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700">Got it!</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
