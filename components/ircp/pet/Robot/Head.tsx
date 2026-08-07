import React, { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox, Cylinder, Sphere, Torus, Plane } from '@react-three/drei'
import * as THREE from 'three'
import { useRobotStore } from './StateMachine'
import { WhiteArmor, CarbonChassis, VisorGlass, VisorScreen, CyanGlow, BrushedMetal, RubberJoint } from './Materials'

export const Head = () => {
  const headRef = useRef<THREE.Group>(null)
  const leftEyeRef = useRef<THREE.Mesh>(null)
  const rightEyeRef = useRef<THREE.Mesh>(null)
  
  const emotion = useRobotStore(state => state.emotion)
  // Target values for smooth animation
  const eyeScale = useRef(new THREE.Vector3(1, 1, 1))
  const eyePosition = useRef(new THREE.Vector3(0, 0, 0))
  const dummyObject = useMemo(() => new THREE.Object3D(), [])
  
  useFrame((state, delta) => {
    if (!headRef.current || !leftEyeRef.current || !rightEyeRef.current) return

    const t = state.clock.elapsedTime
    const currentEmotion = useRobotStore.getState().emotion
    const targetLook = useRobotStore.getState().targetLook
    const focusTarget = useRobotStore.getState().focusTarget

    if (currentEmotion !== 'Sleep') {
      // Prioritize DOM focus target if the user is interacting with an input
      const actualTarget = focusTarget || targetLook

      // Use a dummy object to calculate the lookAt rotation
      dummyObject.position.copy(headRef.current.position)
      dummyObject.lookAt(actualTarget.x, actualTarget.y, actualTarget.z)
      
      // Clamp the head rotation so it doesn't break its neck
      const maxYaw = Math.PI / 2.5
      const maxPitch = Math.PI / 4
      dummyObject.rotation.y = THREE.MathUtils.clamp(dummyObject.rotation.y, -maxYaw, maxYaw)
      dummyObject.rotation.x = THREE.MathUtils.clamp(dummyObject.rotation.x, -maxPitch, maxPitch)
      
      // Smoothly lerp the actual head rotation to the dummy target
      headRef.current.quaternion.slerp(dummyObject.quaternion, 5 * delta)
    } else {
      // Idle/Sleep head movement (drooped down)
      headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, Math.sin(t * 0.5) * 0.05, 2 * delta)
      headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, 0.3 + Math.sin(t * 0.7) * 0.02, 2 * delta)
      headRef.current.rotation.z = THREE.MathUtils.lerp(headRef.current.rotation.z, Math.sin(t * 0.3) * 0.01, 2 * delta)
    }

    // Emotion Animations
    let targetScaleY = 1
    let targetScaleX = 1
    let eyeOffsetY = 0
    let eyeOffsetX = 0

    switch(emotion) {
      case 'Happy':
        targetScaleY = 0.5 + Math.sin(t * 10) * 0.1 // Squint / bounce
        targetScaleX = 1.2
        eyeOffsetY = 0.2
        break
      case 'Warning':
        targetScaleY = 0.6
        targetScaleX = 1.1
        eyeOffsetY = -0.1
        headRef.current.rotation.z = Math.sin(t * 20) * 0.02 // Shake
        break
      case 'Searching':
        targetScaleX = 0.8
        targetScaleY = 0.8
        eyeOffsetX = Math.sin(t * 4) * 0.3 // Scanning left to right
        break
      case 'Sleep':
        targetScaleY = 0.05 // Eyes closed
        break
      default:
        // Occasional blink in idle
        if (t % 4 < 0.1) targetScaleY = 0.1
        else {
          targetScaleY = 1
          targetScaleX = 1
        }
        break
    }

    eyeScale.current.lerp(new THREE.Vector3(targetScaleX, targetScaleY, 1), 10 * delta)
    eyePosition.current.lerp(new THREE.Vector3(eyeOffsetX, eyeOffsetY, 0), 10 * delta)

    leftEyeRef.current.scale.copy(eyeScale.current)
    rightEyeRef.current.scale.copy(eyeScale.current)
    
    // Apply eye position offsets relative to their base positions
    leftEyeRef.current.position.y = 0.2 + eyePosition.current.y
    leftEyeRef.current.position.x = -0.4 + eyePosition.current.x
    rightEyeRef.current.position.y = 0.2 + eyePosition.current.y
    rightEyeRef.current.position.x = 0.4 + eyePosition.current.x
  })

  // Pre-calculate positions for micro details like screws and vents
  const screws = useMemo(() => {
    const arr = []
    // Helmet rim screws
    for(let i=0; i<8; i++) {
      const angle = (i / 8) * Math.PI * 2
      arr.push([Math.cos(angle) * 1.05, 0.9, Math.sin(angle) * 1.05])
      arr.push([Math.cos(angle) * 1.05, -0.9, Math.sin(angle) * 1.05])
    }
    return arr
  }, [])

  return (
    <group ref={headRef} position={[0, 1.8, 0]}>
      {/* 1. Main Outer Ceramic Helmet Shell */}
      <RoundedBox args={[2.2, 2.0, 2.2]} radius={0.6} smoothness={16} material={WhiteArmor} />
      
      {/* 2. Inner Carbon Fiber Helmet Shell (Visible in seams) */}
      <RoundedBox args={[2.18, 1.98, 2.22]} radius={0.58} smoothness={16} material={CarbonChassis} />

      {/* 3. Top Removable Access Plate */}
      <RoundedBox args={[1.5, 2.05, 1.5]} radius={0.4} smoothness={8} material={WhiteArmor} position={[0, 0.02, 0]} />
      {/* Plate seam shadow */}
      <RoundedBox args={[1.55, 2.04, 1.55]} radius={0.42} smoothness={8} material={CarbonChassis} position={[0, 0.02, 0]} />

      {/* 4. Side Ear Housings / Audio Modules */}
      <group position={[-1.1, 0, 0]}>
        <Cylinder args={[0.5, 0.5, 0.3, 32]} rotation={[0, 0, Math.PI/2]} material={WhiteArmor} />
        <Cylinder args={[0.4, 0.4, 0.32, 32]} rotation={[0, 0, Math.PI/2]} material={CarbonChassis} />
        <Cylinder args={[0.2, 0.2, 0.34, 32]} rotation={[0, 0, Math.PI/2]} material={BrushedMetal} />
        {/* Micro speaker grill rings */}
        <Torus args={[0.3, 0.02, 16, 32]} rotation={[0, Math.PI/2, 0]} position={[-0.15, 0, 0]} material={CarbonChassis} />
        <Torus args={[0.1, 0.02, 16, 32]} rotation={[0, Math.PI/2, 0]} position={[-0.15, 0, 0]} material={CarbonChassis} />
      </group>
      <group position={[1.1, 0, 0]}>
        <Cylinder args={[0.5, 0.5, 0.3, 32]} rotation={[0, 0, Math.PI/2]} material={WhiteArmor} />
        <Cylinder args={[0.4, 0.4, 0.32, 32]} rotation={[0, 0, Math.PI/2]} material={CarbonChassis} />
        <Cylinder args={[0.2, 0.2, 0.34, 32]} rotation={[0, 0, Math.PI/2]} material={BrushedMetal} />
        {/* Micro speaker grill rings */}
        <Torus args={[0.3, 0.02, 16, 32]} rotation={[0, Math.PI/2, 0]} position={[0.15, 0, 0]} material={CarbonChassis} />
        <Torus args={[0.1, 0.02, 16, 32]} rotation={[0, Math.PI/2, 0]} position={[0.15, 0, 0]} material={CarbonChassis} />
      </group>

      {/* 5. The Visor Assembly */}
      <group position={[0, 0.1, 1.0]}>
        {/* Rubber Weather Seal */}
        <RoundedBox args={[1.9, 1.2, 0.2]} radius={0.3} smoothness={16} material={RubberJoint} position={[0, 0, 0.05]} />
        {/* Inner Bezel Frame */}
        <RoundedBox args={[1.8, 1.1, 0.15]} radius={0.25} smoothness={16} material={BrushedMetal} position={[0, 0, 0.08]} />
        
        {/* The Dark OLED Display Screen Layer (Background) */}
        {/* Depth increased to 0.35 to support radius=0.15. Pushed back on Z to keep front face at Z=0.125 */}
        <RoundedBox args={[1.7, 1.0, 0.35]} radius={0.15} smoothness={16} material={VisorScreen} position={[0, 0, -0.05]} />

        {/* The Animated OLED Eyes (Positioned strictly in front of the screen, behind the glass) */}
        <group position={[0, 0, 0.15]}>
          
          {/* Left Eye Wrapper (Receives Blink/Squint scale animations) */}
          <group ref={leftEyeRef} position={[-0.35, 0.15, 0]} visible={!['Searching', 'Reading'].includes(emotion)}>
            {/* Normal */}
            <group visible={!['Booting', 'Updating', 'Waiting', 'Celebrating'].includes(emotion)}>
              {/* Main Eye */}
              <RoundedBox args={[0.15, 0.25, 0.05]} radius={0.05} smoothness={8} material={CyanGlow} />
              {/* Eyebrow (Thicker, angled) */}
              <RoundedBox args={[0.25, 0.06, 0.06]} radius={0.02} smoothness={4} position={[0, 0.20, 0]} rotation={[0, 0, 0.15]} material={CyanGlow} />
            </group>
            {/* Spinner */}
            <group visible={['Booting', 'Updating', 'Waiting'].includes(emotion)}>
              <Torus args={[0.15, 0.04, 16, 32, Math.PI * 1.5]} material={CyanGlow} />
            </group>
            {/* Heart */}
            <group visible={emotion === 'Celebrating'}>
              <group rotation={[0, 0, Math.PI / 4]}>
                <RoundedBox args={[0.25, 0.1, 0.05]} radius={0.01} material={CyanGlow} position={[0, 0.05, 0]} />
                <RoundedBox args={[0.1, 0.25, 0.05]} radius={0.01} material={CyanGlow} position={[-0.05, 0, 0]} />
              </group>
            </group>
          </group>

          {/* Right Eye Wrapper (Receives Blink/Squint scale animations) */}
          <group ref={rightEyeRef} position={[0.35, 0.15, 0]} visible={!['Searching', 'Reading'].includes(emotion)}>
            {/* Normal */}
            <group visible={!['Booting', 'Updating', 'Waiting', 'Celebrating'].includes(emotion)}>
              {/* Main Eye */}
              <RoundedBox args={[0.15, 0.25, 0.05]} radius={0.05} smoothness={8} material={CyanGlow} />
              {/* Eyebrow (Thicker, angled) */}
              <RoundedBox args={[0.25, 0.06, 0.06]} radius={0.02} smoothness={4} position={[0, 0.20, 0]} rotation={[0, 0, -0.15]} material={CyanGlow} />
            </group>
            {/* Spinner */}
            <group visible={['Booting', 'Updating', 'Waiting'].includes(emotion)}>
              <Torus args={[0.15, 0.04, 16, 32, Math.PI * 1.5]} material={CyanGlow} />
            </group>
            {/* Heart */}
            <group visible={emotion === 'Celebrating'}>
              <group rotation={[0, 0, Math.PI / 4]}>
                <RoundedBox args={[0.25, 0.1, 0.05]} radius={0.01} material={CyanGlow} position={[0, 0.05, 0]} />
                <RoundedBox args={[0.1, 0.25, 0.05]} radius={0.01} material={CyanGlow} position={[-0.05, 0, 0]} />
              </group>
            </group>
          </group>

          {/* Center Scanning Beam (Overrides eyes during Searching/Reading) */}
          <group visible={['Searching', 'Reading'].includes(emotion)}>
            <RoundedBox args={[1.2, 0.15, 0.05]} radius={0.05} smoothness={8} material={CyanGlow} position={[0, 0.15, 0]} />
          </group>

        </group>

        {/* The Premium Thick Glass Layer (Positioned entirely in front of the eyes to refract them) */}
        {/* Depth increased to 0.45 to support radius=0.2. Pushed back on Z to keep front face at Z=0.27 */}
        <RoundedBox args={[1.75, 1.05, 0.45]} radius={0.2} smoothness={16} material={VisorGlass} position={[0, 0, 0.045]} />
      </group>

      {/* 6. Lower Jaw / Chin Section */}
      <RoundedBox args={[1.6, 0.4, 1.8]} radius={0.15} smoothness={8} position={[0, -0.85, 0.2]} material={WhiteArmor} />
      {/* Jaw seam line */}
      <RoundedBox args={[1.5, 0.05, 1.9]} radius={0.02} smoothness={4} position={[0, -0.65, 0.15]} material={CarbonChassis} />

      {/* 7. Cooling Vents (Rear) */}
      <group position={[0, 0, -1.05]}>
        {[...Array(5)].map((_, i) => (
          <RoundedBox key={i} args={[1.0, 0.05, 0.1]} radius={0.01} position={[0, 0.4 - i * 0.15, 0]} material={CarbonChassis} />
        ))}
      </group>

      {/* 8. Micro Details: Tiny Screws everywhere */}
      {screws.map((pos, i) => (
        <Cylinder 
          key={i} 
          args={[0.03, 0.03, 0.05, 16]} 
          position={pos as [number, number, number]} 
          rotation={[pos[1] > 0 ? 0 : Math.PI, Math.atan2(pos[0], pos[2]), 0]} 
          material={BrushedMetal} 
        />
      ))}
      
      {/* Neck Joint Connection Base */}
      <Cylinder args={[0.4, 0.4, 0.4, 32]} position={[0, -1.0, 0]} material={RubberJoint} />
      <Cylinder args={[0.3, 0.3, 0.5, 32]} position={[0, -1.0, 0]} material={BrushedMetal} />
    </group>
  )
}
