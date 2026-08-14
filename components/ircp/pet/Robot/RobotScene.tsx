import React from 'react'
import { Canvas } from '@react-three/fiber'
import { PresentationControls, Float, Html } from '@react-three/drei'
import { RobotAssembly } from './RobotAssembly'
import { Lights } from './Lights'
import { Effects } from './Effects'
import { useRobotStore, EmotionState } from './StateMachine'
import { VerificationDataCollector } from './Verification'

interface RobotSceneProps {
  hovered: boolean
  pokeTrigger: number
  emotion: EmotionState
}

const STATUS_TEXT: Record<string, string> = {
  idle: 'All good',
  Idle: 'All good',
  thinking: 'Analyzing…',
  Thinking: 'Analyzing…',
  answering: 'Responding…',
  Answering: 'Responding…',
  warning: 'Check this',
  Warning: 'Check this',
  Happy: 'Great job!',
  Sleep: 'Zzz...',
  Listening: 'Listening...'
}

export const RobotScene = ({ hovered, pokeTrigger, emotion }: RobotSceneProps) => {
  const isCanvasMode = useRobotStore(state => state.isCanvasMode)
  
  const content = (
    <>
      {hovered && (
        <Html center position={[0, 0.5, 0]} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              background: 'rgba(17,17,17,0.85)',
              color: '#f5f5f5',
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 6,
              whiteSpace: 'nowrap',
              fontFamily: 'sans-serif',
            }}
          >
            {STATUS_TEXT[emotion] || emotion}
          </div>
        </Html>
      )}
      
      <RobotAssembly hovered={hovered} pokeTrigger={pokeTrigger} />
    </>
  )

  return (
    <>
      <Lights />
      <VerificationDataCollector />

      <Float
        speed={emotion === 'Thinking' ? 3 : 1.5}
        rotationIntensity={0.1}
        floatIntensity={0.2}
      >
        {content}
      </Float>

      <Effects />
    </>
  )
}
