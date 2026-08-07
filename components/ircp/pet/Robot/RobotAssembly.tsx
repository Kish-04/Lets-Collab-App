import React, { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Head } from './Head'
import { Torso } from './Torso'
import { Arm } from './Arm'
import { Leg } from './Leg'
import { useRobotStore } from './StateMachine'
import { WhiteArmor } from './Materials'
import { useUserAwareness } from './Awareness'

interface RobotAssemblyProps {
  hovered: boolean
  pokeTrigger: number
}

export const RobotAssembly = ({ hovered, pokeTrigger }: RobotAssemblyProps) => {
  const robotRef = useRef<THREE.Group>(null)
  const scaleRef = useRef(1)
  const pokeVelocity = useRef(0)
  
  // Attach user awareness system (tab focus, typing, inactivity)
  useUserAwareness()
  
  const bodyColor = useRobotStore(state => state.bodyColor)

  useEffect(() => {
    // Dynamically update the main armor color when state changes
    WhiteArmor.color.set(bodyColor)
  }, [bodyColor])

  useEffect(() => {
    if (pokeTrigger === 0) return
    pokeVelocity.current = 1
  }, [pokeTrigger])

  useFrame((state, delta) => {
    if (!robotRef.current) return
    const t = state.clock.elapsedTime
    const currentEmotion = useRobotStore.getState().emotion
    const targetLook = useRobotStore.getState().targetLook
    
    // Smooth idle float (centered around 0.5 to keep legs in frame)
    let targetY = 0.5 + Math.sin(t * 1.5) * 0.12
    let targetRotX = 0
    let targetRotZ = 0

    // Weight shifting based on looking direction (lean into the look)
    targetRotX -= (targetLook.y / 8) * 0.15
    targetRotZ += (targetLook.x / 12) * 0.1

    // Emotion-based posture
    if (currentEmotion === 'Sleep') {
      targetY -= 0.3 // Sink down
      targetRotX += 0.2 // Lean forward
    } else if (currentEmotion === 'Warning' || currentEmotion === 'Error') {
      targetRotX -= 0.15 // Lean back defensively
    } else if (currentEmotion === 'Greeting') {
      targetY += 0.2 // Perked up
      targetRotX -= 0.1 
    }

    // Smoothly apply physics
    robotRef.current.position.y = THREE.MathUtils.lerp(robotRef.current.position.y, targetY, 4 * delta)
    robotRef.current.rotation.x = THREE.MathUtils.lerp(robotRef.current.rotation.x, targetRotX, 4 * delta)
    robotRef.current.rotation.z = THREE.MathUtils.lerp(robotRef.current.rotation.z, targetRotZ, 4 * delta)

    // Interactive squishy scale
    const hoverTarget = hovered ? 1.05 : 1
    pokeVelocity.current *= 0.85
    const pokeSquash = 1 - pokeVelocity.current * 0.25
    
    scaleRef.current = THREE.MathUtils.lerp(scaleRef.current, hoverTarget, 10 * delta)
    
    const baseScale = 0.35 
    robotRef.current.scale.set(
      baseScale * (scaleRef.current / pokeSquash), 
      baseScale * (scaleRef.current * pokeSquash), 
      baseScale * (scaleRef.current / pokeSquash)
    )
  })

  return (
    <group ref={robotRef} position={[0, 0.5, 0]}>
      <Head />
      <Torso />
      <Arm side="left" />
      <Arm side="right" />
      <Leg side="left" />
      <Leg side="right" />
    </group>
  )
}
