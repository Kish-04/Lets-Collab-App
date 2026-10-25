'use client'

import React, { useRef, useEffect, useState, useMemo } from 'react'
import { Excalidraw, exportToBlob, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw'
import "@excalidraw/excalidraw/index.css"
import * as Y from 'yjs'
import { bindSharedDoc } from '@/lib/CrdtSync'
import { X, Download, Plus, Trash2, Triangle, Star, Hexagon, Component, Heart, Octagon, Pentagon, Copy, ChevronLeft, ChevronRight, Database, Cloud, FileText, ArrowRight, Table as TableIcon, BarChart2, MessageCircle, Zap, PlusSquare, Ribbon, ArrowLeft, ArrowUp, ArrowDown, List, StickyNote, Highlighter, PaintBucket, Code, Moon, Sun, Type, Circle, Square, Diamond } from 'lucide-react'

interface Props {
    peerId?: string
    isHost: boolean
    sessionMode?: string | null
    onClose: () => void
}

/*
 * Whiteboard state lives in a Yjs doc so concurrent edits merge instead of overwriting each other:
 *   elements  - flat map "<pageId>::<elementId>" -> Excalidraw element (last writer wins per element)
 *   pageOrder - array of page ids, pageNames - map pageId -> name
 * A flat element map is used (rather than one nested map per page) so two peers drawing on a
 * brand-new page can never create competing page containers and lose each other's elements.
 */
const DEFAULT_PAGE = 'page-1'
const LOCAL_ORIGIN = 'local-canvas'
const pageKeyPrefix = (pageId: string) => `${pageId}::`

// Docs outlive the canvas component so closing and reopening it keeps the drawing
const whiteboardDocs = new Map<string, Y.Doc>()
function getWhiteboardDoc(key: string) {
    let doc = whiteboardDocs.get(key)
    if (!doc) {
        doc = new Y.Doc()
        whiteboardDocs.set(key, doc)
    }
    return doc
}

const byFractionalIndex = (a: any, b: any) => {
    const left = a.index ?? ''
    const right = b.index ?? ''
    return left < right ? -1 : left > right ? 1 : 0
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

export function StandaloneCanvas({ peerId, isHost, sessionMode, onClose }: Props) {
    const excalidrawAPIRef = useRef<any>(null);

    // In supervised rooms each candidate's board is private to them and the invigilator: the host
    // syncs only with the selected candidate and never relays. Collaboration rooms share one board.
    const isSupervised = sessionMode === 'supervised';
    const docKey = isSupervised && isHost ? (peerId ? `peer:${peerId}` : 'local') : 'shared';
    const ydoc = useMemo(() => getWhiteboardDoc(docKey), [docKey]);
    const yElements = useMemo(() => ydoc.getMap<any>('elements'), [ydoc]);
    const yOrder = useMemo(() => ydoc.getArray<string>('pageOrder'), [ydoc]);
    const yNames = useMemo(() => ydoc.getMap<string>('pageNames'), [ydoc]);

    const readOrder = () => {
        const order = Array.from(new Set(yOrder.toArray()));
        return order.length ? order : [DEFAULT_PAGE];
    }
    const readNames = () => {
        const names: Record<string, string> = {};
        readOrder().forEach((id, index) => { names[id] = yNames.get(id) || `Page ${index + 1}`; });
        return names;
    }
    const sceneFor = (pageId: string) => {
        const prefix = pageKeyPrefix(pageId);
        const elements: any[] = [];
        yElements.forEach((element, key) => { if (key.startsWith(prefix)) elements.push(element); });
        return elements.sort(byFractionalIndex);
    }
    // The default page is implicit until the first structural change, so peers never insert it twice
    const ensureOrder = () => {
        if (yOrder.length === 0) yOrder.push([DEFAULT_PAGE]);
    }

    // Multi-Page State Management
    const [pageNames, setPageNames] = useState<Record<string, string>>(() => readNames());
    const [pageOrder, setPageOrder] = useState<string[]>(() => readOrder());
    const [activePageId, setActivePageId] = useState(() => readOrder()[0]);
    const activePageRef = useRef(activePageId);
    const initialElements = useMemo(() => sceneFor(activePageRef.current), [ydoc]); // eslint-disable-line react-hooks/exhaustive-deps
    const [editingPageId, setEditingPageId] = useState<string | null>(null);

    // Theme & Shapes Menu State
    const [theme, setTheme] = useState<'light' | 'dark'>('light');
    const [activeMenu, setActiveMenu] = useState<string | null>(null);
    const [stickyColor, setStickyColor] = useState('#fef08a');
    const [highlighterColor, setHighlighterColor] = useState('#fef08a');
    const [highlighterSize, setHighlighterSize] = useState(15);
    
    // Custom Modals State (To bypass Electron native dialog limits)
    const [tablePromptOpen, setTablePromptOpen] = useState(false);
    const [tableRows, setTableRows] = useState(3);
    const [tableCols, setTableCols] = useState(3);
    const [chartAlertOpen, setChartAlertOpen] = useState(false);
    
    // New Feature Modals
    const [markdownModalOpen, setMarkdownModalOpen] = useState(false);
    const [autofillModalOpen, setAutofillModalOpen] = useState(false);

    const switchPage = (newId: string) => {
        activePageRef.current = newId;
        setActivePageId(newId);
        excalidrawAPIRef.current?.updateScene({ elements: sceneFor(newId) });
    }

    const addPage = () => {
        const newId = `page-${Date.now()}`;
        const newName = `Page ${readOrder().length + 1}`;
        ydoc.transact(() => {
            ensureOrder();
            yOrder.push([newId]);
            yNames.set(newId, newName);
        }, LOCAL_ORIGIN);
        switchPage(newId);
    }

    const duplicatePage = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const stamp = Date.now();
        const newId = `page-${stamp}`;
        const newName = `${readNames()[id]} (Copy)`;
        const clonedElements = sceneFor(id)
            .filter((el: any) => !el.isDeleted)
            .map((el: any) => ({ ...el, id: `${el.id}-copy-${stamp}` }));

        ydoc.transact(() => {
            ensureOrder();
            const index = yOrder.toArray().indexOf(id);
            yOrder.insert(index === -1 ? yOrder.length : index + 1, [newId]);
            yNames.set(newId, newName);
            clonedElements.forEach((el: any) => yElements.set(pageKeyPrefix(newId) + el.id, el));
        }, LOCAL_ORIGIN);
        switchPage(newId);
    }

    const movePage = (id: string, direction: 'left' | 'right', e: React.MouseEvent) => {
        e.stopPropagation();
        const newOrder = readOrder();
        const index = newOrder.indexOf(id);
        if (index === -1) return;
        if (direction === 'left' && index === 0) return;
        if (direction === 'right' && index === newOrder.length - 1) return;

        const swapIndex = direction === 'left' ? index - 1 : index + 1;
        [newOrder[index], newOrder[swapIndex]] = [newOrder[swapIndex], newOrder[index]];
        ydoc.transact(() => {
            yOrder.delete(0, yOrder.length);
            yOrder.insert(0, newOrder);
        }, LOCAL_ORIGIN);
    }

    const deletePage = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (readOrder().length <= 1) return;

        ydoc.transact(() => {
            ensureOrder();
            const order = yOrder.toArray();
            for (let i = order.length - 1; i >= 0; i--) {
                if (order[i] === id) yOrder.delete(i, 1);
            }
            yNames.delete(id);
            const prefix = pageKeyPrefix(id);
            Array.from(yElements.keys()).forEach(key => { if (key.startsWith(prefix)) yElements.delete(key); });
        }, LOCAL_ORIGIN);
    }

    const renamePage = (id: string, newName: string) => {
        ydoc.transact(() => {
            ensureOrder();
            yNames.set(id, newName);
        }, LOCAL_ORIGIN);
        setEditingPageId(null);
    }

    const injectBulletList = () => {
        if (!excalidrawAPIRef.current) return;
        const appState = excalidrawAPIRef.current.getAppState();
        const currentElements = excalidrawAPIRef.current.getSceneElements();
        
        const newText = {
            type: 'text',
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000000),
            isDeleted: false,
            id: `text-${Date.now()}`,
            x: (appState.scrollX * -1) + (appState.width / 2) - 50,
            y: (appState.scrollY * -1) + (appState.height / 2) - 40,
            text: "• Item 1\n• Item 2\n• Item 3",
            fontSize: 20,
            fontFamily: 1,
            textAlign: "left",
            verticalAlign: "top",
            strokeColor: appState.currentItemStrokeColor || '#000000',
            backgroundColor: 'transparent',
            width: 150,
            height: 80,
            seed: Math.floor(Math.random() * 1000000000),
            groupIds: [],
            boundElements: [],
            updated: Date.now(),
            locked: false
        };
        
        excalidrawAPIRef.current.updateScene({
            elements: [...currentElements, newText as any],
            appState: {
                activeTool: { type: 'selection', customType: null },
                selectedElementIds: { [newText.id]: true }
            }
        });
        setActiveMenu(null);
    }
    
    const injectCodeSnippet = () => {
        if (!excalidrawAPIRef.current) return;
        const appState = excalidrawAPIRef.current.getAppState();
        const currentElements = excalidrawAPIRef.current.getSceneElements();
        
        const rectId = `code-rect-${Date.now()}`;
        const textId = `code-text-${Date.now()}`;
        
        const newRect = {
            type: 'rectangle',
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000000),
            isDeleted: false,
            id: rectId,
            x: (appState.scrollX * -1) + (appState.width / 2) - 150,
            y: (appState.scrollY * -1) + (appState.height / 2) - 75,
            strokeColor: 'transparent',
            backgroundColor: '#1e1e1e', // Dark background for code
            fillStyle: 'solid',
            strokeWidth: 0,
            strokeStyle: 'solid',
            roughness: 0,
            opacity: 100,
            width: 300,
            height: 150,
            seed: Math.floor(Math.random() * 1000000000),
            groupIds: [],
            boundElements: [{ id: textId, type: 'text' }],
            updated: Date.now(),
            locked: false
        };
        
        const newText = {
            type: 'text',
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000000),
            isDeleted: false,
            id: textId,
            x: (appState.scrollX * -1) + (appState.width / 2) - 140,
            y: (appState.scrollY * -1) + (appState.height / 2) - 65,
            text: "function helloWorld() {\n  console.log('Hello');\n}",
            fontSize: 16,
            fontFamily: 3, // Monospace
            textAlign: "left",
            verticalAlign: "top",
            strokeColor: '#4ade80', // Green text
            backgroundColor: 'transparent',
            width: 280,
            height: 130,
            seed: Math.floor(Math.random() * 1000000000),
            groupIds: [],
            boundElements: [],
            updated: Date.now(),
            locked: false
        };
        
        excalidrawAPIRef.current.updateScene({
            elements: [...currentElements, newRect as any, newText as any],
            appState: {
                activeTool: { type: 'selection', customType: null },
                selectedElementIds: { [newText.id]: true }
            }
        });
        setActiveMenu(null);
    }

    const injectStickyNote = () => {
        if (!excalidrawAPIRef.current) return;
        const appState = excalidrawAPIRef.current.getAppState();
        const currentElements = excalidrawAPIRef.current.getSceneElements();
        
        const rectId = `sticky-rect-${Date.now()}`;
        const textId = `sticky-text-${Date.now()}`;
        
        const newRect = {
            type: 'rectangle',
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000000),
            isDeleted: false,
            id: rectId,
            x: (appState.scrollX * -1) + (appState.width / 2) - 100,
            y: (appState.scrollY * -1) + (appState.height / 2) - 100,
            strokeColor: 'transparent',
            backgroundColor: stickyColor,
            fillStyle: 'solid',
            strokeWidth: 0,
            strokeStyle: 'solid',
            roughness: 0,
            opacity: 100,
            width: 200,
            height: 200,
            seed: Math.floor(Math.random() * 1000000000),
            groupIds: [],
            boundElements: [],
            updated: Date.now(),
            locked: false
        };
        
        const newText = {
            type: 'text',
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000000),
            isDeleted: false,
            id: textId,
            x: (appState.scrollX * -1) + (appState.width / 2) - 80,
            y: (appState.scrollY * -1) + (appState.height / 2) - 80,
            text: "Type here...",
            fontSize: 20,
            fontFamily: 1,
            textAlign: "center",
            verticalAlign: "middle",
            strokeColor: '#000000',
            backgroundColor: 'transparent',
            width: 160,
            height: 160,
            seed: Math.floor(Math.random() * 1000000000),
            groupIds: [],
            boundElements: [],
            updated: Date.now(),
            locked: false
        };
        
        excalidrawAPIRef.current.updateScene({
            elements: [...currentElements, newRect as any, newText as any],
            appState: {
                activeTool: { type: 'selection', customType: null },
                selectedElementIds: { [newText.id]: true }
            }
        });
        setActiveMenu(null);
    }

    const setHighlighter = () => {
        if (!excalidrawAPIRef.current) return;
        excalidrawAPIRef.current.updateScene({
            appState: {
                activeTool: { type: 'freedraw', customType: 'pen' },
                currentItemStrokeColor: highlighterColor,
                currentItemBackgroundColor: highlighterColor,
                currentItemStrokeWidth: highlighterSize,
                currentItemRoughness: 0,
                currentItemOpacity: 50
            }
        });
        setActiveMenu(null);
    }

    // Reactively update highlighter if active
    useEffect(() => {
        if (!excalidrawAPIRef.current) return;
        const appState = excalidrawAPIRef.current.getAppState();
        if (appState.activeTool.type === 'freedraw') {
            excalidrawAPIRef.current.updateScene({
                appState: {
                    currentItemStrokeColor: highlighterColor,
                    currentItemStrokeWidth: highlighterSize
                }
            });
        }
    }, [highlighterSize, highlighterColor]);

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
        
        if (['ellipse', 'rectangle', 'diamond'].includes(shapeType)) {
            excalidrawAPIRef.current.updateScene({
                appState: { activeTool: { type: shapeType, customType: null } }
            });
            return;
        }
        
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
        else if (shapeType === 'semiCircle') {
            for (let i = 0; i <= 10; i++) {
                const angle = Math.PI - (Math.PI * (i / 10));
                points.push([50 + 50 * Math.cos(angle), 100 - 100 * Math.sin(angle)]);
            }
            points.push([100, 100], [0, 100]);
        }

        const newShape = { ...baseElement, type: 'line', points };
        excalidrawAPIRef.current.updateScene({ 
            elements: [...currentElements, newShape],
            appState: {
                activeTool: { type: 'selection', customType: null },
                selectedElementIds: { [newShape.id]: true }
            }
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
        setActiveMenu(null);
    }

    // Write only elements whose version changed; Excalidraw includes deleted elements (isDeleted), so deletes sync too
    const onChange = (elements: readonly any[]) => {
        const prefix = pageKeyPrefix(activePageRef.current);
        ydoc.transact(() => {
            for (const element of elements) {
                const stored = yElements.get(prefix + element.id);
                if (!stored || stored.version !== element.version || stored.versionNonce !== element.versionNonce) {
                    yElements.set(prefix + element.id, { ...element });
                }
            }
        }, LOCAL_ORIGIN);
    };

    useEffect(() => {
        const applyRemoteElements = (event: Y.YMapEvent<any>, transaction: Y.Transaction) => {
            if (transaction.origin === LOCAL_ORIGIN) return;
            const api = excalidrawAPIRef.current;
            if (!api) return;
            const prefix = pageKeyPrefix(activePageRef.current);
            if (!Array.from(event.keysChanged).some(key => key.startsWith(prefix))) return;

            // Keep a local element if it is newer than the synced copy (e.g. mid-drag)
            const remote = sceneFor(activePageRef.current);
            const remoteIds = new Set(remote.map((el: any) => el.id));
            const local = api.getSceneElementsIncludingDeleted() as any[];
            const localById = new Map(local.map(el => [el.id, el]));
            const merged = remote.map((el: any) => {
                const mine = localById.get(el.id);
                return mine && mine.version > el.version ? mine : el;
            });
            local.forEach(el => { if (!remoteIds.has(el.id)) merged.push(el); });
            api.updateScene({ elements: merged.sort(byFractionalIndex) });
        };

        const applyPages = () => {
            const order = readOrder();
            setPageOrder(order);
            setPageNames(readNames());
            if (!order.includes(activePageRef.current)) switchPage(order[order.length - 1]);
        };

        yElements.observe(applyRemoteElements);
        yOrder.observe(applyPages);
        yNames.observe(applyPages);
        applyPages();

        const shouldSync = !(isSupervised && isHost && !peerId);
        const unbind = shouldSync
            ? bindSharedDoc('whiteboard', ydoc, { relay: isHost && !isSupervised, peerId: isSupervised && isHost ? peerId : undefined })
            : () => {};

        return () => {
            unbind();
            yElements.unobserve(applyRemoteElements);
            yOrder.unobserve(applyPages);
            yNames.unobserve(applyPages);
        };
    }, [ydoc, isHost, isSupervised, peerId]); // eslint-disable-line react-hooks/exhaustive-deps

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
                    <div className="w-[68px] bg-[#fafafa] border-r border-[#e5e5e5] flex flex-col items-center py-4 gap-3 z-[201] shadow-sm relative shrink-0">
                        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-2">Tools</div>
                        
                        <button onClick={() => setActiveMenu(activeMenu === 'geometries' ? null : 'geometries')} className={`p-2.5 rounded-xl transition-all group relative shadow-sm ${activeMenu === 'geometries' ? 'bg-indigo-100 text-indigo-600' : 'bg-white hover:bg-gray-100 text-gray-700'}`} title="Basic Geometries">
                            <Triangle className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        </button>
                        
                        <button onClick={() => setActiveMenu(activeMenu === 'arrows' ? null : 'arrows')} className={`p-2.5 rounded-xl transition-all group relative shadow-sm ${activeMenu === 'arrows' ? 'bg-indigo-100 text-indigo-600' : 'bg-white hover:bg-gray-100 text-gray-700'}`} title="Block Arrows">
                            <ArrowRight className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        </button>
                        
                        <button onClick={() => setActiveMenu(activeMenu === 'flowchart' ? null : 'flowchart')} className={`p-2.5 rounded-xl transition-all group relative shadow-sm ${activeMenu === 'flowchart' ? 'bg-indigo-100 text-indigo-600' : 'bg-white hover:bg-gray-100 text-gray-700'}`} title="Flowchart">
                            <Database className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        </button>
                        
                        <button onClick={() => setActiveMenu(activeMenu === 'fun' ? null : 'fun')} className={`p-2.5 rounded-xl transition-all group relative shadow-sm ${activeMenu === 'fun' ? 'bg-indigo-100 text-indigo-600' : 'bg-white hover:bg-gray-100 text-gray-700'}`} title="Fun Shapes">
                            <Heart className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        </button>
                        
                        <button onClick={() => setActiveMenu(activeMenu === 'annotations' ? null : 'annotations')} className={`p-2.5 rounded-xl transition-all group relative shadow-sm ${activeMenu === 'annotations' ? 'bg-indigo-100 text-indigo-600' : 'bg-white hover:bg-gray-100 text-gray-700'}`} title="Text & Annotations">
                            <Type className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        </button>

                        <button onClick={() => setActiveMenu(activeMenu === 'data' ? null : 'data')} className={`p-2.5 rounded-xl transition-all group relative shadow-sm ${activeMenu === 'data' ? 'bg-indigo-100 text-indigo-600' : 'bg-white hover:bg-gray-100 text-gray-700'}`} title="Smart Tools & Data">
                            <Component className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        </button>

                        {activeMenu && (
                            <div className="absolute left-full ml-2 top-4 bg-white border border-gray-200 shadow-2xl rounded-xl p-5 w-[360px] max-h-[85vh] overflow-y-auto custom-scrollbar">
                                
                                {activeMenu === 'geometries' && (
                                    <>
                                        <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Basic Geometries</div>
                                        <div className="grid grid-cols-6 gap-2 mb-5">
                                            <button onClick={() => { injectShape('rectangle'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Rectangle"><Square className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('ellipse'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Ellipse/Circle"><Circle className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('diamond'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Diamond"><Diamond className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('triangle'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Triangle"><Triangle className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('parallelogram'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Parallelogram"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="4 20 8 4 20 4 16 20 4 20"></polygon></svg></button>
                                            <button onClick={() => { injectShape('semiCircle'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Semi Circle"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 18a8 8 0 0 1 16 0z" /></svg></button>
                                            <button onClick={() => { injectShape('pentagon'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Pentagon"><Pentagon className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('hexagon'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Hexagon"><Hexagon className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('octagon'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Octagon"><Octagon className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('star'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Star"><Star className="w-5 h-5"/></button>
                                        </div>
                                    </>
                                )}

                                {activeMenu === 'arrows' && (
                                    <>
                                        <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Block Arrows</div>
                                        <div className="grid grid-cols-6 gap-2 mb-5">
                                            <button onClick={() => { injectShape('arrowRight'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Right"><ArrowRight className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('arrowLeft'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Left"><ArrowLeft className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('arrowUp'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Up"><ArrowUp className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('arrowDown'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Arrow Down"><ArrowDown className="w-5 h-5"/></button>
                                        </div>
                                    </>
                                )}

                                {activeMenu === 'flowchart' && (
                                    <>
                                        <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Flowchart</div>
                                        <div className="grid grid-cols-6 gap-2 mb-5">
                                            <button onClick={() => { injectShape('database'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Database"><Database className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('cloud'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Cloud"><Cloud className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('document'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Document"><FileText className="w-5 h-5"/></button>
                                        </div>
                                    </>
                                )}

                                {activeMenu === 'fun' && (
                                    <>
                                        <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Fun Shapes</div>
                                        <div className="grid grid-cols-6 gap-2 mb-6">
                                            <button onClick={() => { injectShape('speechBubble'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Speech Bubble"><MessageCircle className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('lightning'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Lightning Bolt"><Zap className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('cross'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Cross"><PlusSquare className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('ribbon'); setActiveMenu(null); }} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors" title="Ribbon"><Ribbon className="w-5 h-5"/></button>
                                            <button onClick={() => { injectShape('heart'); setActiveMenu(null); }} className="p-2 hover:bg-red-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-red-500 transition-colors" title="Heart"><Heart className="w-5 h-5"/></button>
                                        </div>
                                    </>
                                )}

                                {activeMenu === 'annotations' && (
                                    <>
                                        <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Text & Annotations</div>
                                        
                                        <div className="space-y-4 mb-2">
                                            {/* Tools Grid */}
                                            <div className="flex gap-2">
                                                <button onClick={injectBulletList} className="flex-1 p-2 bg-gray-50 hover:bg-indigo-50 rounded-lg flex flex-col items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Bullet List">
                                                    <List className="w-5 h-5 mb-1"/> <span className="text-[10px] font-bold">List</span>
                                                </button>
                                                
                                                <button onClick={injectStickyNote} className="flex-1 p-2 hover:brightness-95 rounded-lg flex flex-col items-center justify-center transition-colors shadow-sm border border-gray-200 text-gray-800" style={{ backgroundColor: stickyColor }} title="Sticky Note">
                                                    <StickyNote className="w-5 h-5 mb-1 opacity-80"/> <span className="text-[10px] font-bold opacity-80">Sticky</span>
                                                </button>

                                                <button onClick={setHighlighter} className="flex-1 p-2 hover:brightness-95 rounded-lg flex flex-col items-center justify-center transition-colors shadow-sm border border-gray-200 text-gray-800" style={{ backgroundColor: highlighterColor }} title="Highlighter">
                                                    <Highlighter className="w-5 h-5 mb-1 opacity-80"/> <span className="text-[10px] font-bold opacity-80">Highlight</span>
                                                </button>

                                                <button onClick={injectCodeSnippet} className="flex-1 p-2 bg-gray-50 hover:bg-indigo-50 rounded-lg flex flex-col items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Code Snippet">
                                                    <Code className="w-5 h-5 mb-1"/> <span className="text-[10px] font-bold">Code</span>
                                                </button>
                                            </div>

                                            {/* Customization Sliders */}
                                            <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-bold text-gray-500 uppercase">Sticky Note Color</label>
                                                    <input type="color" value={stickyColor} onChange={e => setStickyColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent" />
                                                </div>
                                                <div className="flex items-center justify-between border-t border-gray-200 pt-3">
                                                    <label className="text-[10px] font-bold text-gray-500 uppercase">Highlighter Color</label>
                                                    <input type="color" value={highlighterColor} onChange={e => setHighlighterColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent" />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex justify-between">
                                                        <label className="text-[10px] font-bold text-gray-500 uppercase">Highlighter Size</label>
                                                        <span className="text-[10px] font-bold text-indigo-600">{highlighterSize}px</span>
                                                    </div>
                                                    <input type="range" min="2" max="50" value={highlighterSize} onChange={e => setHighlighterSize(parseInt(e.target.value))} className="w-full accent-indigo-500" />
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}

                                {activeMenu === 'data' && (
                                    <>
                                        <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider border-b border-gray-100 pb-2">Smart Tools & Data</div>
                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                            <button onClick={() => setTablePromptOpen(true)} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Insert Table">
                                                <TableIcon className="w-4 h-4 mr-2"/> Table
                                            </button>
                                            <button onClick={() => setChartAlertOpen(true)} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Insert Chart">
                                                <BarChart2 className="w-4 h-4 mr-2"/> Chart
                                            </button>
                                            <button onClick={() => setMarkdownModalOpen(true)} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Markdown Guide">
                                                <FileText className="w-4 h-4 mr-2"/> Markdown
                                            </button>
                                            <button onClick={() => setAutofillModalOpen(true)} className="p-2 hover:bg-indigo-50 rounded-lg flex items-center justify-center text-gray-600 hover:text-indigo-600 transition-colors border border-gray-200" title="Autofill Shapes">
                                                <PaintBucket className="w-4 h-4 mr-2"/> Autofill
                                            </button>
                                        </div>
                                    </>
                                )}
                                
                                <div className="mt-6 text-[10px] text-gray-400 text-center italic border-t border-gray-100 pt-3">
                                    For native Shapes & Icons, click the <b className="text-gray-500">Library button</b> in the top right.
                                </div>
                            </div>
                        )}
                    </div>

                    <CanvasErrorBoundary>
                        <div className="flex-1 relative h-full">
                            <Excalidraw 
                                theme={theme}
                                excalidrawAPI={(api) => excalidrawAPIRef.current = api}
                                initialData={{ elements: initialElements }}
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
            
            {markdownModalOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-[420px]">
                        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><FileText className="w-5 h-5 mr-2 text-indigo-600"/> Markdown Parsing</h3>
                        <div className="text-gray-600 space-y-3 mb-6">
                            <p>Excalidraw natively parses Markdown text for you!</p>
                            <p>Simply copy any Markdown text containing bold `**text**`, italic `*text*`, headings `# Heading`, or lists, and press <b>Ctrl+V</b> on the canvas.</p>
                            <div className="bg-gray-100 p-3 rounded text-sm font-mono border border-gray-200">
                                # Architecture<br/>
                                - React Frontend<br/>
                                - Node Backend
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <button onClick={() => setMarkdownModalOpen(false)} className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700">Close</button>
                        </div>
                    </div>
                </div>
            )}
            
            {autofillModalOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-[400px]">
                        <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center"><PaintBucket className="w-5 h-5 mr-2 text-indigo-600"/> Shape Autofill</h3>
                        <div className="text-gray-600 space-y-3 mb-6">
                            <p>To fill shapes with solid colors, patterns, or sketch styles:</p>
                            <ol className="list-decimal pl-5 space-y-1">
                                <li>Select any drawn shape on the canvas.</li>
                                <li>Look at the <b>left properties panel</b> that appears.</li>
                                <li>Under <b>Background</b>, pick a color.</li>
                                <li>Under <b>Fill</b>, choose Solid, Hachure, or Cross-hatch!</li>
                            </ol>
                        </div>
                        <div className="flex justify-end">
                            <button onClick={() => setAutofillModalOpen(false)} className="px-5 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700">Got it!</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
