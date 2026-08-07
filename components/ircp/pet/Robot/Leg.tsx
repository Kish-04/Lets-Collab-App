import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox, Cylinder, Torus, Sphere, Capsule } from '@react-three/drei'
import * as THREE from 'three'
import { WhiteArmor, CarbonChassis, BrushedMetal, RubberJoint, CyanGlow, VisorGlass } from './Materials'
import { MechanicalJoint } from './MechanicalJoint'
import { useRobotStore } from './StateMachine'

interface LegProps {
  side: 'left' | 'right'
}

export const Leg = ({ side }: LegProps) => {
  const legRef = useRef<THREE.Group>(null)
  const upperLegRef = useRef<THREE.Group>(null)
  const kneeRef = useRef<THREE.Group>(null)
  const lowerLegRef = useRef<THREE.Group>(null)
  
  const isLeft = side === 'left'
  const sign = isLeft ? -1 : 1

  const emotion = useRobotStore(state => state.emotion)

  useFrame((state, delta) => {
    if (!legRef.current || !upperLegRef.current || !kneeRef.current || !lowerLegRef.current) return
    const t = state.clock.elapsedTime
    const currentEmotion = useRobotStore.getState().emotion
    const velocity = useRobotStore.getState().dragVelocity
    
    let targetX = 0
    let targetZ = isLeft ? -0.05 : 0.05
    
    let upperLegRotX = 0
    let kneeRotX = 0
    let lowerLegRotX = 0

    if (currentEmotion === 'Walking') {
      // Marching stride
      targetX = Math.sin(t * 8 + (isLeft ? Math.PI : 0)) * 0.5
      kneeRotX = Math.max(0, Math.sin(t * 8 + (isLeft ? Math.PI : 0))) * 0.5
    } else {
      // Natural slight idle swaying
      targetX = Math.sin(t * 1.5 + (isLeft ? Math.PI : 0)) * 0.05
    }

    // 4. Inject Drag Physics (Inertia & IK Shock Absorber)
    // When dragged upward, legs dangle down straight (gravity).
    // When dragged downward, the legs compress upwards (air resistance).
    // When stationary (vx = 0, vy = 0), if it was just dropped, we compress the knee to absorb shock.
    
    targetX -= velocity.y * 1.2 // Trail behind drag
    targetZ += velocity.x * (isLeft ? 0.8 : -0.8) // Splay outwards when dragging horizontally
    
    // Knee IK Compression: If dragging down quickly (velocity.y < -0.1), or if we are dropping
    if (velocity.y < -0.1) {
       upperLegRotX = -0.5
       kneeRotX = 1.0 // Bend knee backwards
       lowerLegRotX = -0.5 // Keep foot level
    } else if (velocity.y > 0.1) {
       // Dangling straight down
       upperLegRotX = 0.2
       kneeRotX = 0.1
       lowerLegRotX = -0.1
    } else {
       // Idle standing posture (slight bend)
       upperLegRotX = -0.1
       kneeRotX = 0.2
       lowerLegRotX = -0.1
    }

    legRef.current.rotation.x = THREE.MathUtils.lerp(legRef.current.rotation.x, targetX, 10 * delta)
    legRef.current.rotation.z = THREE.MathUtils.lerp(legRef.current.rotation.z, targetZ, 10 * delta)
    
    upperLegRef.current.rotation.x = THREE.MathUtils.lerp(upperLegRef.current.rotation.x, upperLegRotX, 8 * delta)
    kneeRef.current.rotation.x = THREE.MathUtils.lerp(kneeRef.current.rotation.x, kneeRotX, 12 * delta)
    lowerLegRef.current.rotation.x = THREE.MathUtils.lerp(lowerLegRef.current.rotation.x, lowerLegRotX, 8 * delta)
  })

  return (
    <group ref={legRef} position={[sign * 0.6, -2.1, 0]}>
      {/* 1. Hip Joint (Complex multi-ring bearing) */}
      <group position={[0, 0, 0]}>
        <Sphere args={[0.35, 32, 32]} material={CarbonChassis} />
        <Torus args={[0.4, 0.05, 16, 32]} rotation={[Math.PI/2, 0, 0]} material={BrushedMetal} />
        <Torus args={[0.3, 0.03, 16, 32]} rotation={[0, Math.PI/2, 0]} material={RubberJoint} />
      </group>
      {/* Hip Armor Flap */}
      <RoundedBox args={[0.7, 0.4, 0.7]} radius={0.1} position={[0, -0.2, 0.1]} material={WhiteArmor} />

      {/* 2. Upper Leg (Thigh) */}
      <group ref={upperLegRef} position={[0, -1.0, 0]}>
        {/* Core Frame */}
        <Capsule args={[0.22, 1.4, 16, 16]} material={CarbonChassis} />
        
        {/* Thigh Armor */}
        <RoundedBox args={[0.65, 1.3, 0.65]} radius={0.15} material={WhiteArmor} />
        <RoundedBox args={[0.7, 1.0, 0.4]} radius={0.05} position={[0, 0, 0.15]} material={CarbonChassis} />
        
        {/* Exposed Matte Rubber Cables routing to knee */}
        <Cylinder args={[0.04, 0.04, 1.4, 8]} position={[sign * 0.35, 0, 0.2]} material={RubberJoint} />
        <Cylinder args={[0.04, 0.04, 1.4, 8]} position={[sign * 0.35, 0, -0.2]} material={RubberJoint} />
        
        {/* One single Internal Energy Conduit */}
        <Cylinder args={[0.02, 0.02, 1.35, 8]} position={[sign * 0.35, 0, 0]} material={CyanGlow} />
        {/* Encased in translucent/dark glass sleeve */}
        <Cylinder args={[0.03, 0.03, 1.4, 8]} position={[sign * 0.35, 0, 0]} material={VisorGlass} />
        
        {/* Screws */}
        <Cylinder args={[0.03, 0.03, 0.7, 8]} rotation={[0, 0, Math.PI/2]} position={[0, 0.5, 0]} material={BrushedMetal} />
        <Cylinder args={[0.03, 0.03, 0.7, 8]} rotation={[0, 0, Math.PI/2]} position={[0, -0.5, 0]} material={BrushedMetal} />
      </group>

      {/* 3. Knee Joint & Knee Cap */}
      <group ref={kneeRef} position={[0, -1.9, 0]}>
        {/* Mechanical Knee Hinge */}
        <Cylinder args={[0.3, 0.3, 0.6, 32]} rotation={[0, 0, Math.PI/2]} material={BrushedMetal} />
        <Cylinder args={[0.32, 0.32, 0.15, 32]} rotation={[0, 0, Math.PI/2]} position={[-0.25, 0, 0]} material={CarbonChassis} />
        <Cylinder args={[0.32, 0.32, 0.15, 32]} rotation={[0, 0, Math.PI/2]} position={[0.25, 0, 0]} material={CarbonChassis} />
        
        {/* Armored Knee Cap */}
        <RoundedBox args={[0.5, 0.6, 0.3]} radius={0.1} position={[0, 0, 0.25]} material={WhiteArmor} />
        <RoundedBox args={[0.4, 0.5, 0.35]} radius={0.1} position={[0, 0, 0.25]} material={CarbonChassis} />
      </group>

      {/* 4. Lower Leg (Calf) */}
      <group ref={lowerLegRef} position={[0, -2.8, 0]}>
        <Capsule args={[0.2, 1.4, 16, 16]} material={CarbonChassis} />
        
        {/* Calf Armor */}
        <RoundedBox args={[0.6, 1.3, 0.6]} radius={0.15} material={WhiteArmor} />
        
        {/* Small Calf LED Indicator (Instead of huge strip) */}
        <RoundedBox args={[0.08, 0.2, 0.05]} radius={0.02} position={[0, 0.4, 0.3]} material={CyanGlow} />
        
        {/* Calf Vents */}
        {[...Array(5)].map((_, i) => (
          <RoundedBox key={i} args={[0.4, 0.03, 0.05]} radius={0.01} position={[0, 0.1 - (i * 0.1), -0.3]} material={CarbonChassis} />
        ))}
      </group>

      {/* 5. Ankle Joint */}
      <group position={[0, -3.7, 0]}>
        <Sphere args={[0.22, 32, 32]} material={CarbonChassis} />
        <Cylinder args={[0.2, 0.2, 0.5, 16]} rotation={[0, 0, Math.PI/2]} material={BrushedMetal} />
        <Torus args={[0.2, 0.03, 16, 32]} rotation={[0, Math.PI/2, 0]} position={[0, 0, 0]} material={RubberJoint} />
      </group>

      {/* 6. The Foot */}
      <group position={[0, -4.0, 0]}>
        <RoundedBox args={[0.7, 0.3, 1.0]} radius={0.1} position={[0, 0, 0.2]} material={CarbonChassis} />
        <RoundedBox args={[0.75, 0.2, 1.05]} radius={0.1} position={[0, 0.1, 0.2]} material={WhiteArmor} />
        
        {/* Subtle Feet indicators (only the front toe cap) */}
        <RoundedBox args={[0.2, 0.05, 0.05]} radius={0.01} position={[0, 0.2, 0.7]} material={CyanGlow} />

        {/* Rubber Sole */}
        <RoundedBox args={[0.75, 0.1, 1.15]} radius={0.05} position={[0, -0.35, 0.1]} material={RubberJoint} />
        
        {/* Heel block */}
        <RoundedBox args={[0.85, 0.15, 0.4]} radius={0.05} position={[0, -0.3, -0.3]} material={CarbonChassis} />
        <RoundedBox args={[0.85, 0.2, 0.5]} radius={0.05} position={[0, -0.1, 0.5]} material={BrushedMetal} />
        
        {/* Top Foot Connection Bracket */}
        <RoundedBox args={[0.5, 0.2, 0.5]} radius={0.05} position={[0, 0.1, 0]} material={CarbonChassis} />
      </group>
    </group>
  )
}
