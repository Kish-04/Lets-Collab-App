'use client'

import React, { useRef, useEffect, useState } from 'react'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { PenTool, Eraser, Trash2, Download, X } from 'lucide-react'

type Point = { x: number, y: number }
type DrawAction = 
    | { type: 'start', point: Point, color: string, width: number }
    | { type: 'draw', point: Point, color: string, width: number }
    | { type: 'clear' }
    | { type: 'bg', color: string }

interface Props {
    peerId?: string
    isHost: boolean
    onClose: () => void
}

export function StandaloneCanvas({ peerId, isHost, onClose }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [isDrawingMode, setIsDrawingMode] = useState(true)
    const isDrawingRef = useRef(false)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    
    const [penColor, setPenColor] = useState(isHost ? '#00ff00' : '#ff00ff')
    const [bgColor, setBgColor] = useState('#ffffff')
    const [penWidth, setPenWidth] = useState(4)
    const [isEraser, setIsEraser] = useState(false)

    useEffect(() => {
        if (canvasRef.current) {
            canvasRef.current.width = canvasRef.current.offsetWidth
            canvasRef.current.height = canvasRef.current.offsetHeight
            ctxRef.current = canvasRef.current.getContext('2d')
            if (ctxRef.current) {
                ctxRef.current.lineCap = 'round'
                ctxRef.current.lineJoin = 'round'
                ctxRef.current.fillStyle = bgColor
                ctxRef.current.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)
            }
        }

        const handleResize = () => {
            if (canvasRef.current) {
                const data = ctxRef.current?.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height)
                canvasRef.current.width = canvasRef.current.offsetWidth
                canvasRef.current.height = canvasRef.current.offsetHeight
                if (ctxRef.current && data) {
                    ctxRef.current.lineCap = 'round'
                    ctxRef.current.lineJoin = 'round'
                    ctxRef.current.fillStyle = bgColor
                    ctxRef.current.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)
                    ctxRef.current.putImageData(data, 0, 0)
                }
            }
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    useEffect(() => {
        const handleDraw = (data: DrawAction) => {
            if (!ctxRef.current) return
            
            if (data.type === 'clear') {
                ctxRef.current.fillStyle = bgColor
                ctxRef.current.fillRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
                return
            }

            if (data.type === 'bg') {
                setBgColor(data.color)
                ctxRef.current.fillStyle = data.color
                ctxRef.current.fillRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
                return
            }

            const x = data.point.x * canvasRef.current!.width
            const y = data.point.y * canvasRef.current!.height

            ctxRef.current.strokeStyle = data.color
            ctxRef.current.lineWidth = data.width

            if (data.type === 'start') {
                ctxRef.current.beginPath()
                ctxRef.current.moveTo(x, y)
            } else if (data.type === 'draw') {
                ctxRef.current.lineTo(x, y)
                ctxRef.current.stroke()
            }
        }

        dataChannelManager.on('ircp-draw', handleDraw)
        return () => dataChannelManager.off('ircp-draw', handleDraw)
    }, [bgColor])

    const getCoordinates = (e: React.MouseEvent | React.TouchEvent): Point | null => {
        if (!canvasRef.current) return null
        const rect = canvasRef.current.getBoundingClientRect()
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
        return {
            x: (clientX - rect.left) / rect.width,
            y: (clientY - rect.top) / rect.height
        }
    }

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingMode) return
        e.preventDefault()
        const point = getCoordinates(e)
        if (!point || !ctxRef.current) return

        isDrawingRef.current = true
        const activeColor = isEraser ? bgColor : penColor
        ctxRef.current.strokeStyle = activeColor
        ctxRef.current.lineWidth = penWidth
        ctxRef.current.beginPath()
        
        const x = point.x * canvasRef.current!.width
        const y = point.y * canvasRef.current!.height
        ctxRef.current.moveTo(x, y)

        dataChannelManager.send('ircp-draw', { type: 'start', point, color: activeColor, width: penWidth }, peerId)
    }

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawingMode || !isDrawingRef.current) return
        e.preventDefault()
        const point = getCoordinates(e)
        if (!point || !ctxRef.current) return

        const x = point.x * canvasRef.current!.width
        const y = point.y * canvasRef.current!.height
        ctxRef.current.lineTo(x, y)
        ctxRef.current.stroke()

        const activeColor = isEraser ? bgColor : penColor
        dataChannelManager.send('ircp-draw', { type: 'draw', point, color: activeColor, width: penWidth }, peerId)
    }

    const stopDrawing = () => {
        isDrawingRef.current = false
    }

    const clearCanvas = () => {
        if (ctxRef.current && canvasRef.current) {
            ctxRef.current.fillStyle = bgColor
            ctxRef.current.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)
            dataChannelManager.send('ircp-draw', { type: 'clear' }, peerId)
        }
    }
    
    const handleBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newBg = e.target.value
        setBgColor(newBg)
        if (ctxRef.current && canvasRef.current) {
            ctxRef.current.fillStyle = newBg
            ctxRef.current.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)
            dataChannelManager.send('ircp-draw', { type: 'bg', color: newBg }, peerId)
        }
    }

    const saveCanvas = () => {
        if (!canvasRef.current) return
        const link = document.createElement('a')
        link.download = `collab-canvas-${Date.now()}.png`
        link.href = canvasRef.current.toDataURL('image/png')
        link.click()
    }

    return (
        <div className="absolute inset-0 bg-[#080810] z-50 flex flex-col">
            <div className="h-14 border-b border-[#222] bg-[#111] flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-[#222] rounded-lg transition-colors text-[var(--text-dim)]">
                        <X className="w-5 h-5" />
                    </button>
                    <span className="font-bold tracking-widest text-[var(--text-dim)]">CANVAS MODE</span>
                </div>
                
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-[#1a1a24] p-1.5 rounded-lg border border-[#333]">
                        <button onClick={() => { setIsEraser(false); setIsDrawingMode(true) }} className={`p-1.5 rounded transition-all ${isDrawingMode && !isEraser ? 'bg-[var(--accent)] text-black' : 'hover:bg-[#222] text-white'}`} title="Pen">
                            <PenTool className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setIsEraser(true); setIsDrawingMode(true) }} className={`p-1.5 rounded transition-all ${isEraser ? 'bg-[var(--accent)] text-black' : 'hover:bg-[#222] text-white'}`} title="Eraser">
                            <Eraser className="w-4 h-4" />
                        </button>
                        <div className="w-px h-6 bg-[#333] mx-1"></div>
                        <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} disabled={isEraser} className="w-6 h-6 rounded cursor-pointer border-0 p-0" title="Pen Color" />
                        <input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} className="w-20 mx-2 accent-[var(--accent)]" title="Stroke Width" />
                        <div className="w-px h-6 bg-[#333] mx-1"></div>
                        <label className="text-xs text-[var(--text-dim)] flex items-center gap-2 cursor-pointer">
                            BG:
                            <input type="color" value={bgColor} onChange={handleBgChange} className="w-6 h-6 rounded cursor-pointer border-0 p-0" title="Background Color" />
                        </label>
                    </div>
                    
                    <button onClick={clearCanvas} className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-transparent hover:border-red-500/30" title="Clear Canvas">
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={saveCanvas} className="p-2 bg-[var(--accent)] text-black hover:brightness-110 rounded-lg transition-all" title="Save Image">
                        <Download className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div className="relative flex-1 overflow-hidden">
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="absolute inset-0 w-full h-full object-contain cursor-crosshair touch-none"
                />
            </div>
        </div>
    )
}
