import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Torus, Sphere, Ring } from '@react-three/drei'
import * as THREE from 'three'
import { useRobotStore } from './StateMachine'

export const Hologram = () => {
  const groupRef = useRef<THREE.Group>(null)
  const ring1Ref = useRef<THREE.Mesh>(null)
  const ring2Ref = useRef<THREE.Mesh>(null)
  const ring3Ref = useRef<THREE.Mesh>(null)
  const particlesRef = useRef<THREE.Group>(null)

  const emotion = useRobotStore(state => state.emotion)
  const isActive = ['Searching', 'Reasoning', 'Coding', 'Writing'].includes(emotion)

  // Glow material for the holograms
  const hologramMaterial = new THREE.MeshBasicMaterial({
    color: '#00ffff',
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })

  useFrame((state, delta) => {
    if (!groupRef.current) return
    
    // Scale animation
    const targetScale = isActive ? 1 : 0
    groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 5 * delta)
    
    if (groupRef.current.scale.x < 0.01) {
      groupRef.current.visible = false
      return
    }
    groupRef.current.visible = true

    const t = state.clock.elapsedTime
    
    // Rotate rings
    if (ring1Ref.current) {
      ring1Ref.current.rotation.x = Math.sin(t * 0.5) * 0.5
      ring1Ref.current.rotation.y = t * 1.5
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.x = Math.cos(t * 0.3) * 0.8
      ring2Ref.current.rotation.y = -t * 1.2
    }
    if (ring3Ref.current) {
      ring3Ref.current.rotation.x = Math.PI / 2
      ring3Ref.current.rotation.z = t * 2.0
    }
    
    // Animate particles
    if (particlesRef.current) {
      particlesRef.current.rotation.y = t * 0.5
      particlesRef.current.children.forEach((child, i) => {
        const speed = 1 + (i % 3) * 0.5
        child.position.y = Math.sin(t * speed + i) * 0.8
        // Pulse opacity
        ;(child as any).material.opacity = 0.3 + Math.sin(t * 5 + i) * 0.3
      })
    }
  })

  return (
    <group ref={groupRef} position={[0, -0.4, 0.4]} scale={0}>
      {/* Expanding Orbit Rings */}
      <Ring ref={ring1Ref} args={[1.2, 1.25, 32]} material={hologramMaterial} />
      <Ring ref={ring2Ref} args={[1.5, 1.52, 32]} material={hologramMaterial} />
      
      {/* Vertical Data Stream Ring */}
      <Torus ref={ring3Ref} args={[1.0, 0.02, 16, 64]} material={hologramMaterial} />
      
      {/* Floating Data Particles */}
      <group ref={particlesRef}>
        {[...Array(12)].map((_, i) => {
          const angle = (i / 12) * Math.PI * 2
          const radius = 1.0 + (i % 2 === 0 ? 0.3 : 0)
          return (
            <Sphere 
              key={i}
              args={[0.04, 8, 8]}
              position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
              material={hologramMaterial.clone()}
            />
          )
        })}
      </group>
    </group>
  )
}
