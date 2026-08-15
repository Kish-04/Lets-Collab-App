"use client"

import { useState, useEffect, useRef } from "react"
import { PetCanvas } from "@/components/ircp/pet/PetCanvas"
import { EmotionState } from "@/components/ircp/pet/Robot/StateMachine"

export default function PetWidgetPage() {
    const [petState, setPetState] = useState<EmotionState>('Idle')
    const [petMessage, setPetMessage] = useState("")

    useEffect(() => {
        if (typeof window !== 'undefined' && (window as any).ipcRenderer) {
            (window as any).ipcRenderer.on('pet-sync-state', (state: any) => {
                if (state.petState) setPetState(state.petState)
                if (state.petMessage !== undefined) setPetMessage(state.petMessage)
            })
        }
    }, [])

    const dragRef = useRef<HTMLDivElement>(null)
    const startPos = useRef({ x: 0, y: 0 })
    const isDragging = useRef(false)

    const onPointerDown = (e: React.PointerEvent) => {
        if (!dragRef.current) return
        dragRef.current.setPointerCapture(e.pointerId)
        startPos.current = { x: e.screenX, y: e.screenY }
        isDragging.current = true
    }

    const onPointerMove = (e: React.PointerEvent) => {
        if (!isDragging.current) return
        const dx = e.screenX - startPos.current.x
        const dy = e.screenY - startPos.current.y
        if (dx !== 0 || dy !== 0) {
            if (typeof window !== 'undefined' && (window as any).ipcRenderer) {
                (window as any).ipcRenderer.send('move-pet-window', { x: dx, y: dy })
            }
            startPos.current = { x: e.screenX, y: e.screenY }
        }
    }

    const onPointerUp = (e: React.PointerEvent) => {
        if (!dragRef.current) return
        dragRef.current.releasePointerCapture(e.pointerId)
        isDragging.current = false
    }

    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: `body { background: transparent !important; }` }} />
            <div className="w-screen h-screen overflow-hidden bg-transparent select-none cursor-default relative">

                
                <div className="w-full h-full pointer-events-auto">
                    <PetCanvas petState={petState} sessionMode="collaboration" petMessage={petMessage} isStandalone={true} />
                </div>
            </div>
        </>
    )
}
