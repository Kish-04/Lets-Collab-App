import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox, Cylinder, Sphere, Capsule, Torus } from '@react-three/drei'
import * as THREE from 'three'
import { WhiteArmor, CarbonChassis, BrushedMetal, RubberJoint, CyanGlow } from './Materials'
import { MechanicalJoint } from './MechanicalJoint'
import { useRobotStore } from './StateMachine'

interface ArmProps {
  side: 'left' | 'right'
}

// Helper to generate a thicker, cuter 2-joint finger
const Finger = ({ position, rotation, scale = 1, isTapping = false, tapOffset = 0 }: { position: [number, number, number], rotation: [number, number, number], scale?: number, isTapping?: boolean, tapOffset?: number }) => {
  const fingerRef = useRef<THREE.Group>(null)
  
  useFrame((state, delta) => {
    if (!fingerRef.current) return
    const targetX = isTapping ? Math.sin(state.clock.elapsedTime * 12 + tapOffset) * 0.4 + 0.3 : 0
    fingerRef.current.rotation.x = THREE.MathUtils.lerp(fingerRef.current.rotation.x, targetX, 10 * delta)
  })

  return (
    <group ref={fingerRef} position={position} rotation={rotation} scale={scale}>
      {/* Base Knuckle */}
      <Sphere args={[0.12, 16, 16]} material={CarbonChassis} />
      {/* Proximal Phalange */}
      <RoundedBox args={[0.2, 0.35, 0.2]} radius={0.05} position={[0, -0.2, 0]} material={WhiteArmor} />
      {/* Distal Knuckle */}
      <Sphere args={[0.1, 16, 16]} position={[0, -0.4, 0]} material={CarbonChassis} />
      {/* Fingertip */}
      <RoundedBox args={[0.18, 0.3, 0.18]} radius={0.05} position={[0, -0.55, 0]} material={RubberJoint} />
      {/* LED strip on fingertip */}
      <Cylinder args={[0.04, 0.04, 0.18, 8]} position={[0, -0.55, 0.08]} rotation={[Math.PI/2, 0, 0]} material={CyanGlow} />
    </group>
  )
}

export const Arm = ({ side }: ArmProps) => {
  const armRef = useRef<THREE.Group>(null)
  const elbowRef = useRef<THREE.Group>(null)
  
  const isLeft = side === 'left'
  const sign = isLeft ? -1 : 1
  const emotion = useRobotStore(state => state.emotion)
  const isTapping = emotion === 'Thinking' && !isLeft
  
  useFrame((state, delta) => {
    if (!armRef.current || !elbowRef.current) return
    const t = state.clock.elapsedTime
    const currentEmotion = useRobotStore.getState().emotion
    const targetLook = useRobotStore.getState().targetLook
    
    // Base resting pose (more relaxed, arms hanging down slightly outwards)
    let targetArmX = Math.sin(t * 1.5 + (isLeft ? 0 : Math.PI)) * 0.05
    let targetArmZ = isLeft ? -0.15 : 0.15 // Negative Z on left side rotates OUTWARDS
    let targetElbowX = Math.PI / 8 + Math.sin(t * 2) * 0.05 // Gentle forward bend
    let targetElbowZ = isLeft ? -0.05 : 0.05

    // 1. Shoulder Compensation based on Head Tracking
    const lookYaw = targetLook.x / 12
    targetArmX += isLeft ? (lookYaw * 0.1) : (-lookYaw * 0.1)

    // 2. Complex Gestures based on Emotion
    if (currentEmotion === 'Greeting' || currentEmotion === 'Happy') {
      if (!isLeft) {
        targetArmX = -Math.PI / 2.5 
        targetArmZ = -Math.PI / 4
        targetElbowX = Math.PI / 2 + Math.sin(t * 15) * 0.4 // Waving!
      } else {
        targetArmX = -Math.PI / 8
        targetElbowX = Math.PI / 4
      }
    } else if (currentEmotion === 'Thinking') {
      if (!isLeft) {
        targetArmX = -Math.PI / 3.5
        targetArmZ = 0.4
        targetElbowX = Math.PI / 1.5
      }
    } else if (currentEmotion === 'Warning' || currentEmotion === 'Error') {
      targetArmX = 0.1
      targetArmZ = isLeft ? 0.4 : -0.4
      targetElbowX = Math.PI / 8
    } else if (currentEmotion === 'Walking') {
      // Marching swing
      targetArmX = Math.sin(t * 8 + (isLeft ? 0 : Math.PI)) * 0.6
      targetElbowX = Math.PI / 4
    }

    // 3. Inject Drag Physics (Inertia)
    const velocity = useRobotStore.getState().dragVelocity
    // If dragging right, arms swing left. If dragging up, arms swing down/back.
    // The arms are slightly offset by side to give them independent physical weight
    targetArmX -= velocity.y * 0.8
    targetArmZ += velocity.x * (isLeft ? 0.6 : -0.6)
    
    // Elbows dangle dynamically based on velocity
    targetElbowX += Math.abs(velocity.y) * 0.4
    targetElbowZ += velocity.x * 0.2

    armRef.current.rotation.x = THREE.MathUtils.lerp(armRef.current.rotation.x, targetArmX, 5 * delta)
    armRef.current.rotation.z = THREE.MathUtils.lerp(armRef.current.rotation.z, targetArmZ, 5 * delta)
    elbowRef.current.rotation.x = THREE.MathUtils.lerp(elbowRef.current.rotation.x, targetElbowX, 6 * delta)
    elbowRef.current.rotation.z = THREE.MathUtils.lerp(elbowRef.current.rotation.z, targetElbowZ, 6 * delta)
  })

  return (
    <group ref={armRef} position={[sign * 1.3, -0.6, 0]}>
      {/* 1. Shoulder Joint (Complex Hinge & Bearing) */}
      <group position={[0, 0, 0]}>
        <Sphere args={[0.3, 32, 32]} material={CarbonChassis} />
        <Torus args={[0.35, 0.05, 16, 32]} rotation={[Math.PI/2, 0, 0]} material={BrushedMetal} />
        <Cylinder args={[0.2, 0.2, 0.7, 32]} rotation={[0, 0, Math.PI/2]} material={RubberJoint} />
      </group>

      {/* 2. Upper Arm (Bicep) Armor & Mechanics */}
      <group position={[0, -0.7, 0]}>
        {/* Inner Mechanical Frame (Capsule) */}
        <Capsule args={[0.18, 1.1, 16, 16]} material={CarbonChassis} />
        
        {/* Outer Ceramic Armor */}
        <RoundedBox args={[0.5, 1.1, 0.5]} radius={0.15} position={[0, 0.1, 0]} material={WhiteArmor} />
        
        {/* Armor Panel Lines / Vents */}
        <RoundedBox args={[0.55, 0.05, 0.55]} radius={0.01} position={[0, 0.3, 0]} material={CarbonChassis} />
        
        {/* Exposed routing cables */}
        <Cylinder args={[0.04, 0.04, 1.4, 8]} position={[sign * -0.28, 0, 0.28]} material={RubberJoint} />
        <Cylinder args={[0.04, 0.04, 1.4, 8]} position={[sign * -0.28, 0, -0.28]} material={RubberJoint} />
      </group>

      {/* 3. Elbow Joint Complex */}
      <group ref={elbowRef} position={[0, -1.4, 0]}>
        {/* Mechanical Hinge */}
        <Cylinder args={[0.25, 0.25, 0.5, 32]} rotation={[0, 0, Math.PI/2]} material={BrushedMetal} />
        <Cylinder args={[0.28, 0.28, 0.1, 32]} rotation={[0, 0, Math.PI/2]} position={[-0.2, 0, 0]} material={CarbonChassis} />
        <Cylinder args={[0.28, 0.28, 0.1, 32]} rotation={[0, 0, Math.PI/2]} position={[0.2, 0, 0]} material={CarbonChassis} />
        
        {/* Faint internal energy indicator on elbow */}
        <Cylinder args={[0.22, 0.22, 0.52, 32]} rotation={[0, 0, Math.PI/2]} material={CyanGlow} />

        {/* 4. Lower Arm (Forearm) Armor & Mechanics */}
        <group position={[0, -0.6, 0]}>
          {/* Inner Mechanical Frame */}
          <Capsule args={[0.15, 0.9, 16, 16]} material={CarbonChassis} />
          
          {/* Forearm Ceramic Armor */}
          <RoundedBox args={[0.4, 0.9, 0.4]} radius={0.1} position={[0, -0.1, 0]} material={WhiteArmor} />
          
          {/* Wrist Cuff */}
          <RoundedBox args={[0.45, 0.15, 0.45]} radius={0.05} position={[0, -0.5, 0]} material={BrushedMetal} />
        </group>

        {/* 5. Wrist Joint */}
        <group position={[0, -1.2, 0]}>
          <Sphere args={[0.2, 32, 32]} material={CarbonChassis} />
          <Cylinder args={[0.18, 0.18, 0.4, 16]} rotation={[0, 0, Math.PI/2]} material={BrushedMetal} />
        </group>

        {/* 6. The Hand (Palm & 3 Thick Fingers) */}
        <group position={[0, -1.4, 0]}>
          <RoundedBox args={[0.4, 0.3, 0.2]} radius={0.05} material={CarbonChassis} />
          <RoundedBox args={[0.45, 0.35, 0.1]} radius={0.05} position={[0, 0, 0.1]} material={WhiteArmor} />
          <Sphere args={[0.08, 16, 16]} position={[0, 0, -0.1]} material={CyanGlow} scale={[1, 1, 0.3]} />

          {/* 3-Finger Setup */}
          {/* We assume Finger component is available globally or we will re-inline it if it was lost. Wait, Finger was in this file! */}
          {/* I will re-inline the Finger helper since I deleted it earlier when fixing the duplicate! Wait! */}
          <group position={[sign * -0.25, -0.05, 0]} rotation={[0, 0, sign * 0.4]} scale={0.9}>
            <RoundedBox args={[0.15, 0.3, 0.15]} radius={0.05} position={[0, -0.15, 0]} material={RubberJoint} />
          </group>
          <group position={[sign * -0.1, -0.22, 0]} rotation={[0, 0, sign * 0.05]}>
            <RoundedBox args={[0.15, 0.4, 0.15]} radius={0.05} position={[0, -0.2, 0]} material={RubberJoint} />
          </group>
          <group position={[sign * 0.15, -0.2, 0]} rotation={[0, 0, sign * -0.05]} scale={0.95}>
            <RoundedBox args={[0.15, 0.4, 0.15]} radius={0.05} position={[0, -0.2, 0]} material={RubberJoint} />
          </group>
        </group>
      </group>
    </group>
  )
}
