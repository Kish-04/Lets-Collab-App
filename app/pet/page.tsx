"use client"

import { useState, useEffect } from "react"
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

    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: `body { background: transparent !important; }` }} />
            <div className="w-screen h-screen overflow-hidden bg-transparent select-none cursor-default">
                {/* Native Electron Drag Handle over the robot's head area */}
                <div 
                  className="absolute top-[80px] left-1/2 -translate-x-1/2 w-16 h-16 z-[9999] rounded-full cursor-move" 
                  style={{ WebkitAppRegion: 'drag' } as any}
                  title="Drag to move"
                />
                
                <div style={{ WebkitAppRegion: 'no-drag' } as any} className="w-full h-full pointer-events-auto">
                    <PetCanvas petState={petState} sessionMode="collaboration" petMessage={petMessage} isStandalone={true} />
                </div>
            </div>
        </>
    )
}
