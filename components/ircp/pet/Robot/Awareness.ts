import { useEffect, useRef } from 'react'
import { useRobotStore } from './StateMachine'

export const useUserAwareness = () => {
  const idleTimeout = useRef<NodeJS.Timeout | undefined>(undefined)
  const typingTimeout = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        useRobotStore.getState().setEmotion('Sleep')
      } else {
        // Wake up!
        useRobotStore.getState().setEmotion('Greeting')
        
        // Reset to Idle after greeting
        setTimeout(() => {
          if (useRobotStore.getState().emotion === 'Greeting') {
            useRobotStore.getState().setEmotion('Idle')
          }
        }, 3000)
      }
    }

    const resetIdleTimer = () => {
      // Don't reset if we are sleeping or in an active task
      const current = useRobotStore.getState().emotion
      if (['Sleep', 'Searching', 'Coding', 'Greeting'].includes(current)) return

      // Wake up from Idle/Curious if moving mouse
      if (['Idle', 'Curious'].includes(current)) {
        useRobotStore.getState().setEmotion('Happy')
        setTimeout(() => {
           if (useRobotStore.getState().emotion === 'Happy') {
             useRobotStore.getState().setEmotion('Idle')
           }
        }, 2000)
      }

      clearTimeout(idleTimeout.current)
      idleTimeout.current = setTimeout(() => {
        // User has been inactive for 30 seconds
        const currentNow = useRobotStore.getState().emotion
        if (currentNow === 'Idle') {
          useRobotStore.getState().setEmotion('Curious') // Look around
          
          // Eventually go to sleep if still inactive
          idleTimeout.current = setTimeout(() => {
            if (useRobotStore.getState().emotion === 'Curious') {
              useRobotStore.getState().setEmotion('Sleep')
            }
          }, 30000) // Sleep after 1 minute total
        }
      }, 30000) // 30 seconds of no mouse movement
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return

      const current = useRobotStore.getState().emotion
      if (['Sleep', 'Idle', 'Curious', 'Happy'].includes(current)) {
        useRobotStore.getState().setEmotion('Typing')
      }

      clearTimeout(typingTimeout.current)
      typingTimeout.current = setTimeout(() => {
        if (useRobotStore.getState().emotion === 'Typing') {
          useRobotStore.getState().setEmotion('Idle')
        }
      }, 2000) // 2 seconds after last keypress
    }

    // Attach listeners
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('mousemove', resetIdleTimer)
    window.addEventListener('keydown', handleKeyDown)

    // Initial timer start
    resetIdleTimer()

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('mousemove', resetIdleTimer)
      window.removeEventListener('keydown', handleKeyDown)
      clearTimeout(idleTimeout.current)
      clearTimeout(typingTimeout.current)
    }
  }, [])
}
