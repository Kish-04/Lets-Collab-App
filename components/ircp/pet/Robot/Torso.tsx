import React, { useMemo, useRef } from 'react'
import { RoundedBox, Cylinder, Torus, Sphere, Tube } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { WhiteArmor, CarbonChassis, CyanGlow, BrushedMetal, RubberJoint, VisorGlass } from './Materials'
import { Hologram } from './Hologram'
import { useRobotStore } from './StateMachine'

export const Torso = () => {
  const torsoRef = useRef<THREE.Group>(null)
  
  // Pre-calculate positions for spine segments
  const spineSegments = useMemo(() => {
    const arr = []
    for(let i=0; i<6; i++) {
      arr.push(-0.2 - (i * 0.25)) // Y positions for the spine vertebrae
    }
    return arr
  }, [])

  // Create curved paths for exposed neck power cables
  const cablePaths = useMemo(() => {
    return [
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.3, -0.2, 0.4),
        new THREE.Vector3(-0.4, 0.2, 0.2),
        new THREE.Vector3(-0.2, 0.6, 0.0),
      ]),
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.3, -0.2, 0.4),
        new THREE.Vector3(0.4, 0.2, 0.2),
        new THREE.Vector3(0.2, 0.6, 0.0),
      ])
    ]
  }, [])

  useFrame((state, delta) => {
    if (!torsoRef.current) return
    const velocity = useRobotStore.getState().dragVelocity
    
    // Procedural Spring Physics: Tilt torso based on drag velocity (inertia)
    // Dragging right makes it tilt left, dragging up makes it tilt back
    const targetRotZ = -velocity.x * 0.5
    const targetRotX = velocity.y * 0.5
    
    // Add slight natural breathing/sway when idle
    const t = state.clock.elapsedTime
    const breathe = Math.sin(t * 1.5) * 0.02
    
    torsoRef.current.rotation.z = THREE.MathUtils.lerp(torsoRef.current.rotation.z, targetRotZ, 10 * delta)
    torsoRef.current.rotation.x = THREE.MathUtils.lerp(torsoRef.current.rotation.x, targetRotX + breathe, 10 * delta)
  })

  return (
    <group ref={torsoRef} position={[0, -0.2, 0]}>
      {/* 1. Core Internal Chassis (Carbon Fiber structure) */}
      <RoundedBox args={[1.5, 2.2, 1.2]} radius={0.3} smoothness={16} material={CarbonChassis} position={[0, -1.0, 0]} />

      {/* Holographic UI Projection Ring */}
      <group position={[0, -0.4, 0]}>
        <Hologram />
      </group>

      {/* 2. Dynamic TubeGeometry Cables (Routing from Chest to Neck) */}
      {cablePaths.map((path, i) => (
        <group key={`cable-${i}`}>
          <Tube args={[path, 20, 0.04, 8, false]} material={RubberJoint} />
          {/* Subtle cyan energy conduit inside one cable */}
          {i === 0 && (
            <Tube args={[path, 20, 0.02, 8, false]} material={CyanGlow} />
          )}
        </group>
      ))}

      {/* 3. Upper Chest Armor Plate (White Ceramic) */}
      <RoundedBox args={[1.7, 0.9, 0.5]} radius={0.2} smoothness={16} position={[0, -0.4, 0.45]} material={WhiteArmor} />
      {/* Chest Armor Bevel/Trim */}
      <RoundedBox args={[1.6, 0.8, 0.6]} radius={0.15} smoothness={16} position={[0, -0.4, 0.4]} material={BrushedMetal} />

      {/* 4. Central Power Core (Arc Reactor style) */}
      <group position={[0, -0.4, 0.7]}>
        <Torus args={[0.25, 0.05, 16, 32]} material={BrushedMetal} />
        <Torus args={[0.2, 0.03, 16, 32]} material={RubberJoint} />
        {/* Emissive Core */}
        <Sphere args={[0.18, 32, 32]} material={CyanGlow} scale={[1, 1, 0.3]} />
        {/* Protective Glass/Crystal Lens over the core */}
        <Sphere args={[0.22, 32, 32]} material={VisorGlass} scale={[1, 1, 0.4]} position={[0, 0, 0.05]} />
      </group>

      {/* 5. Lower Chest / Abdomen Armor Plates */}
      <RoundedBox args={[1.4, 0.8, 0.5]} radius={0.2} smoothness={16} position={[0, -1.4, 0.45]} material={WhiteArmor} />
      <RoundedBox args={[1.3, 0.7, 0.6]} radius={0.15} smoothness={16} position={[0, -1.4, 0.4]} material={BrushedMetal} />
      
      {/* Subtle Waist LED Strip (Replaced huge chest strips) */}
      <RoundedBox args={[0.3, 0.02, 0.05]} radius={0.01} position={[0, -1.8, 0.65]} material={CyanGlow} />

      {/* 6. Side Armor Ribs */}
      <group position={[0, -1.0, 0]}>
        {[-0.5, -0.9, -1.3].map((y, i) => (
          <group key={i}>
            {/* Left Rib */}
            <RoundedBox args={[0.4, 0.15, 0.8]} radius={0.05} position={[-0.75, y + 1.0, 0.2]} material={WhiteArmor} rotation={[0, -0.2, 0]} />
            {/* Right Rib */}
            <RoundedBox args={[0.4, 0.15, 0.8]} radius={0.05} position={[0.75, y + 1.0, 0.2]} material={WhiteArmor} rotation={[0, 0.2, 0]} />
          </group>
        ))}
      </group>

      {/* 7. Mechanical Spine (Rear) */}
      <group position={[0, -1.0, -0.55]}>
        {/* Main Spine Rod */}
        <Cylinder args={[0.15, 0.15, 2.0, 16]} material={BrushedMetal} />
        {/* Rubber cable routing along spine */}
        <Cylinder args={[0.05, 0.05, 2.0, 8]} position={[-0.15, 0, 0]} material={RubberJoint} />
        <Cylinder args={[0.05, 0.05, 2.0, 8]} position={[0.15, 0, 0]} material={RubberJoint} />
        
        {/* Individual Vertebrae */}
        {spineSegments.map((y, i) => (
          <group key={i} position={[0, y + 1.0, 0]}>
            {/* Vertebra block */}
            <RoundedBox args={[0.6, 0.15, 0.4]} radius={0.05} material={CarbonChassis} position={[0, 0, 0.1]} />
            {/* Vertebra armor cap */}
            <RoundedBox args={[0.5, 0.1, 0.1]} radius={0.02} material={WhiteArmor} position={[0, 0, -0.15]} />
          </group>
        ))}
        {/* Subtle Neck Status LED (Only top vertebra glows now) */}
        <Cylinder args={[0.02, 0.02, 0.65, 8]} rotation={[0, 0, Math.PI/2]} position={[0, 0.8, -0.15]} material={CyanGlow} />
      </group>

      {/* 8. Cooling Vents (Underarm / Sides) */}
      <group position={[-0.75, -0.6, 0]}>
        {[...Array(4)].map((_, i) => (
           <RoundedBox key={`l-${i}`} args={[0.1, 0.05, 0.4]} radius={0.01} position={[0, -i * 0.1, 0]} material={CarbonChassis} />
        ))}
      </group>
      <group position={[0.75, -0.6, 0]}>
        {[...Array(4)].map((_, i) => (
           <RoundedBox key={`r-${i}`} args={[0.1, 0.05, 0.4]} radius={0.01} position={[0, -i * 0.1, 0]} material={CarbonChassis} />
        ))}
      </group>

      {/* 9. Waist / Pelvis Joint Area */}
      <RoundedBox args={[1.3, 0.5, 1.1]} radius={0.2} smoothness={16} position={[0, -2.1, 0]} material={CarbonChassis} />
      <RoundedBox args={[1.4, 0.3, 1.2]} radius={0.1} smoothness={8} position={[0, -2.1, 0]} material={WhiteArmor} />
      
      {/* 10. Tiny Industrial Bolts scattered on armor plates */}
      {/* Upper Chest Bolts */}
      <Cylinder args={[0.04, 0.04, 0.05, 16]} rotation={[Math.PI/2, 0, 0]} position={[-0.7, -0.2, 0.68]} material={BrushedMetal} />
      <Cylinder args={[0.04, 0.04, 0.05, 16]} rotation={[Math.PI/2, 0, 0]} position={[0.7, -0.2, 0.68]} material={BrushedMetal} />
      {/* Lower Chest Bolts */}
      <Cylinder args={[0.04, 0.04, 0.05, 16]} rotation={[Math.PI/2, 0, 0]} position={[-0.5, -1.6, 0.68]} material={BrushedMetal} />
      <Cylinder args={[0.04, 0.04, 0.05, 16]} rotation={[Math.PI/2, 0, 0]} position={[0.5, -1.6, 0.68]} material={BrushedMetal} />
    </group>
  )
}
