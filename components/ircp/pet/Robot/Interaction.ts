import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useRobotStore } from './StateMachine'

// Hook to track global inactivity and trigger Sleep state
export function useInactivitySleep(timeoutMs: number = 30000, onInactive?: () => void) {
  const setEmotion = useRobotStore((state) => state.setEmotion)
  const currentEmotion = useRobotStore((state) => state.emotion)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const resetTimer = () => {
      // If we wake up from sleep due to activity
      if (useRobotStore.getState().emotion === 'Sleep') {
        setEmotion('Idle')
      }

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (onInactive) {
          onInactive()
        } else {
          setEmotion('Sleep')
        }
      }, timeoutMs)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart']
    events.forEach(event => window.addEventListener(event, resetTimer))

    resetTimer()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      events.forEach(event => window.removeEventListener(event, resetTimer))
    }
  }, [setEmotion, timeoutMs])
}

// Hook to track DOM focus and map it to a 3D target vector
export function useDOMObserver() {
  const setFocusTarget = useRobotStore((state) => state.setFocusTarget)
  const setEmotion = useRobotStore((state) => state.setEmotion)

  useEffect(() => {
    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName) || target.isContentEditable) {
        const rect = target.getBoundingClientRect()
        
        // Map 2D screen coordinates to normalized 3D viewport coordinates (-1 to 1)
        // Note: The robot's origin (0,0) is usually at the bottom right.
        // We calculate relative to the screen center.
        const x = (rect.left + rect.width / 2) / window.innerWidth * 2 - 1
        const y = -(rect.top + rect.height / 2) / window.innerHeight * 2 + 1
        
        // We exaggerate the coordinates slightly so the robot turns its head noticeably
        const target3D = new THREE.Vector3(x * 5, y * 3, 5)
        setFocusTarget(target3D)
        
        // Look interested when typing
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
           setEmotion('Reading')
        }
      }
    }

    const handleBlur = () => {
      setFocusTarget(null)
      const current = useRobotStore.getState().emotion
      if (current === 'Reading') {
         setEmotion('Idle')
      }
    }

    const handleError = () => {
      setEmotion('Error')
      setTimeout(() => {
        if (useRobotStore.getState().emotion === 'Error') {
          setEmotion('Idle')
        }
      }, 4000)
    }

    window.addEventListener('focusin', handleFocus)
    window.addEventListener('focusout', handleBlur)
    window.addEventListener('error', handleError)

    return () => {
      window.removeEventListener('focusin', handleFocus)
      window.removeEventListener('focusout', handleBlur)
      window.removeEventListener('error', handleError)
    }
  }, [setFocusTarget, setEmotion])
}
