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
                  className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center justify-center w-12 h-6 bg-neutral-800/60 hover:bg-neutral-700/80 rounded-full cursor-move z-[9999] backdrop-blur-sm transition-colors text-white/50 hover:text-white/90 border border-white/10" 
                  style={{ WebkitAppRegion: 'drag' } as any}
                  title="Drag to move"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
                </div>
                
                <div style={{ WebkitAppRegion: 'no-drag' } as any} className="w-full h-full pointer-events-auto">
                    <PetCanvas petState={petState} sessionMode="collaboration" petMessage={petMessage} isStandalone={true} />
                </div>
            </div>
        </>
    )
}
