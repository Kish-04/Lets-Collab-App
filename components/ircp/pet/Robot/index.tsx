"use client"

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { getBackendUrl } from '@/lib/utils'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { motion, AnimatePresence, useMotionValue, animate, useDragControls } from 'framer-motion'
import { Volume2, VolumeX } from 'lucide-react'
import { RobotScene } from './RobotScene'
import { useRobotStore, EmotionState } from './StateMachine'
import { useInactivitySleep, useDOMObserver } from './Interaction'

// Invisible hit-target sphere
function InteractionCatcher({
  onHover,
  onClick,
  onDoubleClick,
  onPointerMove,
  onPointerDown,
  onPointerUp
}: {
  onHover: (v: boolean) => void
  onClick: () => void
  onDoubleClick: (e: any) => void
  onPointerMove: (e: any) => void
  onPointerDown?: (e: any) => void
  onPointerUp?: (e: any) => void
}) {
  return (
    <mesh
      position={[0, 1.5, 0]}
      onPointerOver={() => onHover(true)}
      onPointerOut={() => onHover(false)}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <capsuleGeometry args={[1.2, 2.0, 8, 8]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  )
}

export function FloatingRobot({ petState = 'Idle', sessionMode, petMessage, isStandalone, isCanvasMode }: { petState?: EmotionState, sessionMode?: string, petMessage?: string, isStandalone?: boolean, isCanvasMode?: boolean }) {
  useDOMObserver()
  const [hovered, setHovered] = useState(false)
  const [pokeTrigger, setPokeTrigger] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [aiResponse, setAiResponse] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)

  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotate = useMotionValue(0)
  
  const [bounds, setBounds] = useState({ left: 0, right: 0, top: 0, bottom: 0 })

  const setIsCanvasMode = useRobotStore(state => state.setIsCanvasMode)
  useEffect(() => {
    setIsCanvasMode(!!isCanvasMode)
  }, [isCanvasMode, setIsCanvasMode])

  useEffect(() => {
    const updateBounds = () => {
      const widgetWidth = 165
      const margin = 24
      setBounds({
        left: -(window.innerWidth - widgetWidth - margin * 2),
        right: 0,
        top: -(window.innerHeight - 320 - margin * 2),
        bottom: 0
      })
    }
    updateBounds()
    window.addEventListener('resize', updateBounds)
    return () => window.removeEventListener('resize', updateBounds)
  }, [])

  // Hook into x motion value for Spatial Audio Panning
  useEffect(() => {
    let audioModule: any = null
    
    // Import it once when the component mounts
    import('./Sounds').then((module) => {
      audioModule = module
    })

    return x.on('change', (latestX) => {
      // Robot starts at right edge (x=0, pan=1). Left edge is x=bounds.left (pan=-1)
      if (bounds.left !== 0 && audioModule?.updateAudioPosition) {
         const ratio = latestX / bounds.left // 0 at right, 1 at left
         const pan = 1 - 2 * ratio 
         audioModule.updateAudioPosition(pan)
      }
    })
  }, [x, bounds])

  const emotion = useRobotStore(state => state.emotion)
  const setEmotion = useRobotStore(state => state.setEmotion)
  const setTargetLook = useRobotStore(state => state.setTargetLook)
  const setDragVelocity = useRobotStore(state => state.setDragVelocity)
  const isMuted = useRobotStore(state => state.isMuted)
  const toggleMute = useRobotStore(state => state.toggleMute)
  const bodyColor = useRobotStore(state => state.bodyColor)

  // Fall asleep after 10 seconds of inactivity (for testing)
  useInactivitySleep(10000, () => {
    setEmotion('Walking')
    
    const currentX = x.get()
    const currentY = y.get()
    
    // Distance to edges
    const distLeft = Math.abs(currentX - bounds.left)
    const distRight = Math.abs(currentX - bounds.right)
    const distTop = Math.abs(currentY - bounds.top)
    const distBottom = Math.abs(currentY - bounds.bottom)
    
    const min = Math.min(distLeft, distRight, distTop, distBottom)
    
    let targetX = currentX
    let targetY = currentY
    
    if (min === distLeft) targetX = bounds.left
    else if (min === distRight) targetX = bounds.right
    else if (min === distTop) targetY = bounds.top
    else if (min === distBottom) targetY = bounds.bottom
    
    // Animate to edge
    const dist = Math.sqrt(Math.pow(targetX - currentX, 2) + Math.pow(targetY - currentY, 2))
    const duration = Math.max(1, dist / 200) // 200px per second
    
    // We would rotate the 3D model here, but for now we'll just tween the XY
    Promise.all([
      animate(x, targetX, { duration, ease: 'linear' }),
      animate(y, targetY, { duration, ease: 'linear' })
    ]).then(() => {
      setEmotion('Sleep')
    })
  })

  // Global mouse tracking so the robot's head follows the cursor anywhere on the screen
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      const currentEmotion = useRobotStore.getState().emotion
      if (currentEmotion === 'Sleep') return // Don't track cursor while sleeping
      
      const px = (e.clientX / window.innerWidth) * 2 - 1
      const py = -(e.clientY / window.innerHeight) * 2 + 1
      setTargetLook(px * 12, py * 8 + 2, 8)
    }
    
    window.addEventListener('mousemove', handleGlobalMouseMove)
    return () => window.removeEventListener('mousemove', handleGlobalMouseMove)
  }, [setTargetLook])

  useEffect(() => {
    // Only set external state if provided, otherwise let internal state machine manage it
    if (petState && petState !== 'Idle') {
      setEmotion(petState)
    }
  }, [petState, setEmotion])

  useEffect(() => {
    if (isStandalone && typeof window !== 'undefined' && (window as any).ipcRenderer) {
      const shouldBeInteractive = hovered || chatOpen || detailsOpen;
      (window as any).ipcRenderer.send('set-ignore-mouse-events', !shouldBeInteractive)
    }
  }, [hovered, chatOpen, detailsOpen, isStandalone])

  useEffect(() => {
    if (petMessage) {
      setChatOpen(false); // Force speech bubble outside chat
      setAiResponse(petMessage);
      setEmotion('Warning');
      import('./Sounds').then(m => {
        m.playWarningTone();
        m.speakText(petMessage);
      });
    } else {
      setAiResponse(null);
    }
  }, [petMessage, setEmotion]);

  const handleClick = useCallback(() => {
    import('./Sounds').then(m => m.playHoverBeep())
    setPokeTrigger((n) => n + 1)
    setChatOpen((v) => !v)
    // When closing via the robot, dismiss the lingering speech bubble too
    setAiResponse((current) => (chatOpen ? null : current))
    setEmotion(chatOpen ? 'Idle' : 'Listening')
  }, [chatOpen, setEmotion])

  const closeChat = useCallback(() => {
    setChatOpen(false)
    setAiResponse(null)
    setEmotion('Idle')
  }, [setEmotion])

  const [isDraggingBody, setIsDraggingBody] = useState(false)
  const lastScreenPos = useRef({ x: 0, y: 0 })
  const dragControls = useDragControls()

  const handlePointerDown = useCallback((e: any) => {
    if (!isStandalone) {
      dragControls.start(e)
    } else {
      setIsDraggingBody(true)
      lastScreenPos.current = { x: e.nativeEvent.screenX, y: e.nativeEvent.screenY }
      if (e.target && e.pointerId !== undefined) {
        e.target.setPointerCapture(e.pointerId)
      }
      import('./Sounds').then(m => m.playMoveStart())
      setEmotion('Walking')
    }
  }, [dragControls, isStandalone, setEmotion])

  const handlePointerUp = useCallback((e: any) => {
    if (isStandalone) {
      setIsDraggingBody(false)
      if (e.target && e.pointerId !== undefined && e.target.hasPointerCapture(e.pointerId)) {
        e.target.releasePointerCapture(e.pointerId)
      }
      import('./Sounds').then(m => m.playMoveEnd())
      setEmotion('Idle')
      setDragVelocity({ x: 0, y: 0 })
    }
  }, [isStandalone, setEmotion, setDragVelocity])

  const handlePointerMove = useCallback((e: any) => {
    if (isStandalone && isDraggingBody) {
      const dx = e.nativeEvent.screenX - lastScreenPos.current.x
      const dy = e.nativeEvent.screenY - lastScreenPos.current.y
      if (dx !== 0 || dy !== 0) {
        if (typeof window !== 'undefined' && (window as any).ipcRenderer) {
          (window as any).ipcRenderer.send('move-pet-window', { x: dx, y: dy })
        }
        lastScreenPos.current = { x: e.nativeEvent.screenX, y: e.nativeEvent.screenY }
        
        const velocity = { x: dx * 20, y: dy * 20 }
        setDragVelocity(velocity)
        if (Math.abs(velocity.x) > 200 || Math.abs(velocity.y) > 200) {
          setEmotion('Surprised')
        }
      }
    } else if (emotion !== 'Sleep') {
      const px = (e.clientX / window.innerWidth) * 2 - 1
      const py = -(e.clientY / window.innerHeight) * 2 + 1
      setTargetLook(px * 12, py * 8 + 2, 8)
    }
  }, [isStandalone, isDraggingBody, emotion, setTargetLook, setEmotion, setDragVelocity])

  const handleDoubleClick = useCallback((e: any) => {
    e.stopPropagation?.()
    import('./Sounds').then(m => m.playBlip(600))
    setDetailsOpen((v) => !v)
    setEmotion('Happy')
    setTimeout(() => setEmotion('Idle'), 3000)
  }, [setEmotion])

  const handleSendMessage = async () => {
    if (message.trim() === '' || isTyping) return
    const userMsg = message
    setMessage('')
    setAiResponse(null)
    setIsTyping(true)
    
    if (sessionMode === 'supervised') {
      const msg = "I am your invigilator for this supervised session. I cannot answer your questions or provide assistance. Please focus on your screen.";
      setEmotion('Warning')
      import('./Sounds').then(m => {
        m.playWarningTone();
        m.speakText(msg);
      })
      setAiResponse(msg)
      setIsTyping(false)
      setTimeout(() => setEmotion('Idle'), 5000)
      return
    }
    
    setEmotion('Listening')
    import('./Sounds').then(m => m.playThinkingPulse())
    
    try {
      setTimeout(() => setEmotion('Thinking'), 1000)

      const backendUrl = getBackendUrl()
      let reply: string | null = null;
      
      try {
        reply = await fetch(`${backendUrl}/api/pet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMsg })
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`)
          }
          const data = await response.json()
          return data.text || "I didn't get that."
        })
      } catch (err) {
        // Fallback to Next.js API route if backend fails (e.g. old backend, CORS)
        if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
          reply = await fetch(`/api/pet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userMsg })
          }).then(async (response) => {
            if (!response.ok) {
              throw new Error(`Request failed with status ${response.status}`)
            }
            const data = await response.json()
            return data.text || "I didn't get that."
          })
        } else {
          throw err;
        }
      }

      setEmotion('Reasoning')
      setTimeout(() => {
        setEmotion('Answering')
        const finalReply = reply || "I didn't get that.";
        setAiResponse(finalReply)
        import('./Sounds').then(m => {
          m.playSuccessChime();
          m.speakText(finalReply);
        })
        setIsTyping(false)

        setTimeout(() => setEmotion('Idle'), 5000) // Reset to idle after a while
      }, 1000)

    } catch (e: any) {
      console.error('Pet AI Error:', e)
      const errorMessage = String(e?.message || e)
      setEmotion('Error')
      setAiResponse(`I hit a snag: ${errorMessage}`)
      import('./Sounds').then(m => {
        m.playWarningTone();
        m.speakText(errorMessage);
      })
      setIsTyping(false)
      setTimeout(() => setEmotion('Idle'), 4000)
    }
  }

  const handleDrag = useCallback(
    (_: unknown, info: { velocity: { x: number; y: number }, delta: { x: number; y: number } }) => {
      if (!isStandalone) {
        // Feed 2D drag velocity into the 3D physics store
        // We scale it down slightly so the 3D physics aren't completely chaotic
        setDragVelocity(info.velocity.x * 0.005, -info.velocity.y * 0.005)
      }
    },
    [setDragVelocity, isStandalone]
  )

  const handleDragEnd = useCallback(
    (_: unknown, info: { velocity: { x: number; y: number } }) => {
      // Rapidly decay velocity to 0 on release (the lerp in the store handles smoothness)
      setDragVelocity(0, 0)
      
      const wobble = THREE.MathUtils.clamp((info.velocity.x + info.velocity.y) / 4000, -15, 15)
      animate(rotate, [wobble, -wobble * 0.6, 0], { duration: 0.6, ease: 'easeOut' })

      const speed = Math.sqrt(info.velocity.x ** 2 + info.velocity.y ** 2)
      if (speed > 400) {
        setEmotion('Warning') // Surprised/Warning when thrown
        setTimeout(() => setEmotion('Idle'), 2000)
      }
    },
    [rotate, setEmotion, setDragVelocity]
  )

  return (
    <>
      <motion.div
        drag
        dragControls={dragControls}
        dragListener={false} // Disable default DOM listener so we can trigger it from R3F
        dragMomentum={!isStandalone}
        dragElastic={isStandalone ? 0 : 0.15}
        dragConstraints={isStandalone ? { left: 0, right: 0, top: 0, bottom: 0 } : bounds}
        onDragEnd={handleDragEnd}
        onDrag={handleDrag}
        style={{ width: 165, height: 320, x, y, rotate }}
        className="fixed bottom-6 right-6 z-[150] cursor-grab active:cursor-grabbing"
      >
        <Canvas frameloop="always" shadows dpr={[1, 2]} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }} camera={{ position: [0, 0, 7.5], fov: 40 }} className="pointer-events-auto">
          <RobotScene hovered={hovered} pokeTrigger={pokeTrigger} emotion={emotion} />
          <InteractionCatcher 
            onHover={setHovered} 
            onClick={handleClick} 
            onDoubleClick={handleDoubleClick} 
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          />
        </Canvas>
      </motion.div>

      {/* Chat & Details Overlays */}
      <AnimatePresence>
        {/* AI Speech Bubble */}
        {aiResponse && !chatOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 10 }}
            className={isStandalone
              ? "absolute bottom-8 left-4 right-4 z-[160] max-h-48 overflow-hidden overflow-y-auto bg-neutral-900 border border-neutral-700 text-neutral-100 p-3 rounded-2xl shadow-2xl text-sm whitespace-pre-wrap break-words text-left"
              : "fixed bottom-[340px] right-24 z-[160] max-w-[250px] max-h-48 overflow-hidden overflow-y-auto bg-neutral-900 border border-neutral-700 text-neutral-100 p-3 rounded-2xl rounded-br-sm shadow-2xl text-sm whitespace-pre-wrap break-words text-left"
            }
          >
            <button
              onClick={closeChat}
              aria-label="Dismiss AI Pet message"
              className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors"
            >
              ✕
            </button>
            <span className="pr-6 block">{aiResponse}</span>
          </motion.div>
        )}
        
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            className={isStandalone
              ? "absolute bottom-4 left-4 right-4 z-[160] rounded-xl bg-neutral-900 text-neutral-100 shadow-2xl p-3 border border-neutral-700"
              : "fixed bottom-72 right-6 z-[160] w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-neutral-900 text-neutral-100 shadow-2xl p-3"
            }
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-neutral-400 uppercase tracking-wider font-semibold">AI Pet</div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleMute}
                  aria-label={isMuted ? "Unmute AI Pet" : "Mute AI Pet"}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors"
                >
                  {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={closeChat}
                  aria-label="Close AI Pet chat"
                  className="w-6 h-6 flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
            {/* AI Speech Bubble inside chat */}
            {aiResponse && (
              <div className="mb-3 p-2 bg-neutral-800 rounded-lg text-sm border border-neutral-700 max-h-40 overflow-y-auto">
                <div className="mb-1"><span className="text-cyan-400 font-bold">Pet:</span></div>
                <div className="whitespace-pre-wrap break-words text-left leading-relaxed">{aiResponse}</div>
              </div>
            )}
            
            <div className="flex justify-between items-center mb-2">
              <div className="text-xs text-neutral-400 uppercase tracking-wider font-semibold">State: <span className="text-cyan-400">{emotion}</span></div>
              <input 
                type="color" 
                value={bodyColor} 
                onChange={(e) => useRobotStore.getState().setBodyColor(e.target.value)}
                className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                title="Change Robot Color"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ask something…"
                className="flex-1 min-w-0 bg-neutral-800 rounded-md px-2 py-1 text-sm outline-none text-neutral-100 placeholder-neutral-500 focus:ring-1 ring-cyan-500"
                onFocus={() => setEmotion('Reading')}
                onBlur={() => setEmotion('Idle')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSendMessage()
                }}
              />
              <button 
                onClick={handleSendMessage} 
                disabled={isTyping}
                className="text-sm bg-cyan-500 text-black rounded-md px-3 py-1 font-semibold hover:bg-cyan-400 active:scale-95 transition-all"
              >
                Send
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
