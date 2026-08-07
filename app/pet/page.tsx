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
            <div className="w-screen h-screen overflow-hidden bg-transparent select-none cursor-default" style={{ WebkitAppRegion: 'drag' } as any}>
                <PetCanvas petState={petState} sessionMode="collaboration" petMessage={petMessage} isStandalone={true} />
            </div>
        </>
    )
}
