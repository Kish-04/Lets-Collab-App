'use client'

import React, { useRef, useEffect, useState } from 'react'
import { dataChannelManager } from '@/lib/DataChannelManager'
import { PenTool, Trash2 } from 'lucide-react'

type Point = { x: number, y: number }
type DrawAction = 
    | { type: 'start', point: Point, color: string }
    | { type: 'draw', point: Point, color: string }
    | { type: 'clear' }

export function WhiteboardOverlay({ peerId, isHost }: { peerId?: string, isHost: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [isDrawingMode, setIsDrawingMode] = useState(false)
    const isDrawingRef = useRef(false)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const color = isHost ? '#00ff00' : '#ff00ff'

    useEffect(() => {
        if (canvasRef.current) {
            canvasRef.current.width = canvasRef.current.offsetWidth
            canvasRef.current.height = canvasRef.current.offsetHeight
            ctxRef.current = canvasRef.current.getContext('2d')
            if (ctxRef.current) {
                ctxRef.current.lineWidth = 4
                ctxRef.current.lineCap = 'round'
                ctxRef.current.lineJoin = 'round'
            }
        }

        const handleResize = () => {
            if (canvasRef.current) {
                const data = ctxRef.current?.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height)
                canvasRef.current.width = canvasRef.current.offsetWidth
                canvasRef.current.height = canvasRef.current.offsetHeight
                if (ctxRef.current && data) {
                    ctxRef.current.lineWidth = 4
                    ctxRef.current.lineCap = 'round'
                    ctxRef.current.lineJoin = 'round'
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
                ctxRef.current.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
                return
            }

            const x = data.point.x * canvasRef.current!.width
            const y = data.point.y * canvasRef.current!.height

            ctxRef.current.strokeStyle = data.color

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
    }, [])

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
        ctxRef.current.strokeStyle = color
        ctxRef.current.beginPath()
        
        const x = point.x * canvasRef.current!.width
        const y = point.y * canvasRef.current!.height
        ctxRef.current.moveTo(x, y)

        dataChannelManager.send('ircp-draw', { type: 'start', point, color }, peerId)
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

        dataChannelManager.send('ircp-draw', { type: 'draw', point, color }, peerId)
    }

    const stopDrawing = () => {
        isDrawingRef.current = false
    }

    const clearCanvas = () => {
        if (ctxRef.current && canvasRef.current) {
            ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
            dataChannelManager.send('ircp-draw', { type: 'clear' }, peerId)
        }
    }

    return (
        <>
            <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                className={`absolute inset-0 w-full h-full object-contain ${isDrawingMode ? 'pointer-events-auto cursor-crosshair z-20' : 'pointer-events-none z-10'}`}
            />
            
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-[#111] p-2 rounded-xl border border-[var(--border)] shadow-lg backdrop-blur-md bg-opacity-80">
                <button
                    onClick={() => setIsDrawingMode(!isDrawingMode)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isDrawingMode ? 'bg-[var(--accent)] text-black' : 'hover:bg-[#222] text-neutral-100'}`}
                >
                    <PenTool className="w-4 h-4" />
                    {isDrawingMode ? 'Drawing Mode Active' : 'Annotate Screen'}
                </button>
                {isDrawingMode && (
                    <button
                        onClick={clearCanvas}
                        className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
                        title="Clear Annotations"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </div>
        </>
    )
}
