import { create } from 'zustand'
import * as THREE from 'three'
import { updateLEDColor } from './Materials'
import { playBlip, playThinkingPulse, playSuccessChime, playWarningTone, updateServoVelocity } from './Sounds'

export type EmotionState = 
  | 'Booting' | 'Listening' | 'Thinking' | 'Searching' | 'Reading' 
  | 'Reasoning' | 'Planning' | 'Coding' | 'Writing' | 'Typing' | 'Answering'
  | 'Waiting' | 'Idle' | 'Confused' | 'Curious' | 'Celebrating' 
  | 'Happy' | 'Sleep' | 'Charging' | 'Offline' | 'Updating' 
  | 'Error' | 'Warning' | 'Greeting' | 'Farewell' | 'Low Battery' 
  | 'Disconnected' | 'Walking'

interface RobotStore {
  emotion: EmotionState
  targetLook: THREE.Vector3
  focusTarget: THREE.Vector3 | null
  dragVelocity: THREE.Vector2
  bodyColor: string
  isMuted: boolean
  isCanvasMode: boolean
  
  setEmotion: (emotion: EmotionState, silent?: boolean) => void
  setTargetLook: (x: number, y: number, z: number) => void
  setFocusTarget: (target: THREE.Vector3 | null) => void
  setDragVelocity: (vx: number, vy: number) => void
  setBodyColor: (color: string) => void
  toggleMute: () => void
  setIsCanvasMode: (val: boolean) => void
}

export const useRobotStore = create<RobotStore>((set, get) => ({
  emotion: 'Idle',
  targetLook: new THREE.Vector3(0, 0, 5),
  focusTarget: null,
  dragVelocity: new THREE.Vector2(0, 0),
  bodyColor: '#F5F6F8', // Default off-white ceramic
  isMuted: false,
  isCanvasMode: false,
  
  setIsCanvasMode: (val) => set({ isCanvasMode: val }),
  toggleMute: () => set((state) => {
    const newMuted = !state.isMuted
    if (newMuted && typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel()
    }
    return { isMuted: newMuted }
  }),
  setBodyColor: (color: string) => set({ bodyColor: color }),
  setFocusTarget: (target: THREE.Vector3 | null) => set({ focusTarget: target }),
  setDragVelocity: (vx: number, vy: number) => set((state) => {
    state.dragVelocity.lerp(new THREE.Vector2(vx, vy), 0.2) // Smoothly interpolate velocity
    
    // Update the audio engine's servo hum based on the new speed
    const speed = Math.sqrt(state.dragVelocity.x ** 2 + state.dragVelocity.y ** 2)
    updateServoVelocity(speed)
    
    return state
  }),
  setEmotion: (newEmotion, silent = false) => {
    const currentEmotion = get().emotion
    if (currentEmotion !== newEmotion) {
      set({ emotion: newEmotion })
      updateLEDColor(newEmotion)
      
      if (!silent && !get().isMuted) {
        const lower = newEmotion.toLowerCase()
        if (lower.includes('warning') || lower.includes('error') || lower.includes('offline')) {
          playWarningTone()
        } else if (lower.includes('thinking') || lower.includes('searching') || lower.includes('reasoning') || lower.includes('coding')) {
          playThinkingPulse()
        } else if (lower.includes('happy') || lower.includes('celebrating') || lower.includes('success')) {
          playSuccessChime()
        } else {
          playBlip(440) // neutral
        }
      }
    }
  },
  
  setTargetLook: (x, y, z) => set((state) => {
    state.targetLook.lerp(new THREE.Vector3(x, y, z), 0.1)
    return state
  }),
}))
