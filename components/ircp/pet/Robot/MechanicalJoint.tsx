import React, { useRef } from 'react'
import { Sphere, Cylinder, Torus, RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CarbonChassis, CyanGlow, WhiteArmor, RubberJoint, BrushedMetal } from './Materials'

interface MechanicalJointProps {
  size?: number
  rotation?: [number, number, number]
  type?: 'shoulder' | 'elbow' | 'knee' | 'ankle'
}

export const MechanicalJoint = ({ size = 0.2, rotation = [0, 0, 0], type = 'elbow' }: MechanicalJointProps) => {
  const spinRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (!spinRef.current) return
    // Very subtle idle rotation for internal gear mechanisms if desired
    spinRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.5) * 0.05
  })

  // We can vary the joint style slightly based on type
  const isLarge = type === 'shoulder' || type === 'knee'

  return (
    <group rotation={rotation}>
      {/* Central Axis / Core */}
      <Sphere args={[size * 0.8, 32, 32]} material={CarbonChassis} />
      
      {/* Main Rotation Cylinder (The Axle) */}
      <Cylinder args={[size * 0.7, size * 0.7, size * 2.2, 32]} rotation={[Math.PI / 2, 0, 0]} material={BrushedMetal} />
      
      {/* Rubber Gaskets on ends */}
      <Cylinder args={[size * 0.75, size * 0.75, size * 2.3, 32]} rotation={[Math.PI / 2, 0, 0]} material={RubberJoint} />
      <Cylinder args={[size * 0.78, size * 0.78, size * 2.1, 32]} rotation={[Math.PI / 2, 0, 0]} material={RubberJoint} />
      
      {/* Carbon Fiber Outer Rings */}
      <Cylinder args={[size * 0.85, size * 0.85, size * 1.8, 32]} rotation={[Math.PI / 2, 0, 0]} material={CarbonChassis} />
      <Cylinder args={[size * 0.9, size * 0.9, size * 1.5, 32]} rotation={[Math.PI / 2, 0, 0]} material={CarbonChassis} />
      <Cylinder args={[size * 0.95, size * 0.95, size * 1.1, 32]} rotation={[Math.PI / 2, 0, 0]} material={CarbonChassis} />

      {/* Internal Rotating Gear Mechanism */}
      <group ref={spinRef} rotation={[Math.PI / 2, 0, 0]}>
        {/* Tiny gear teeth */}
        {[...Array(8)].map((_, i) => (
          <Cylinder 
            key={i}
            args={[size * 0.1, size * 0.1, size * 1.9, 8]} 
            position={[Math.cos((i / 8) * Math.PI * 2) * size * 0.6, 0, Math.sin((i / 8) * Math.PI * 2) * size * 0.6]}
            material={BrushedMetal} 
          />
        ))}
      </group>

      {/* LED Status Rings */}
      <Torus args={[size * 0.75, size * 0.05, 16, 32]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, size * 0.7]} material={CyanGlow} />
      <Torus args={[size * 0.75, size * 0.05, 16, 32]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -size * 0.7]} material={CyanGlow} />

      {/* Outer Armor Caps (for shoulders/knees) */}
      {isLarge && (
        <group>
          <RoundedBox args={[size * 1.2, size * 1.2, size * 2.5]} radius={size * 0.2} material={WhiteArmor} />
          {/* Decorative Screws on Caps */}
          <Cylinder args={[size * 0.1, size * 0.1, size * 2.55, 16]} rotation={[Math.PI / 2, 0, 0]} material={BrushedMetal} />
          <Cylinder args={[size * 0.1, size * 0.1, size * 2.55, 16]} rotation={[0, 0, Math.PI / 2]} material={BrushedMetal} />
        </group>
      )}
    </group>
  )
}
