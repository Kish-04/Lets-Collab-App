"use client"

import React, { useRef, useMemo, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { EffectComposer, Bloom, ChromaticAberration, Noise, Vignette } from '@react-three/postprocessing'

interface Particle {
  id: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  age: number
  maxAge: number
  color: THREE.Color
}

const MAX_PARTICLES = 400
const SPAWN_RATE = 3

function ParticleSystem() {
  const { size, viewport, mouse } = useThree()
  
  const particles = useRef<Particle[]>([])
  const prevMouse = useRef(new THREE.Vector2())
  const mouseVelocity = useRef(new THREE.Vector2())
  
  const meshRef = useRef<THREE.InstancedMesh>(null)
  
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const colorArray = useMemo(() => new Float32Array(MAX_PARTICLES * 3), [])
  
  const accentColor = useMemo(() => new THREE.Color('#00ffff'), []) // Pure cyan
  const magentaColor = useMemo(() => new THREE.Color('#ff00ff'), []) // Pure magenta
  
  let particleIdCounter = 0

  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }
  }, [])

  useFrame((state, delta) => {
    const currentMouse = new THREE.Vector2(
      (mouse.x * viewport.width) / 2,
      (mouse.y * viewport.height) / 2
    )
    
    mouseVelocity.current.subVectors(currentMouse, prevMouse.current)
    
    if (mouseVelocity.current.length() > 0.05 && particles.current.length < MAX_PARTICLES) {
      for (let i = 0; i < SPAWN_RATE; i++) {
        if (particles.current.length >= MAX_PARTICLES) break;
        
        const spread = 0.5
        const pX = currentMouse.x + (Math.random() - 0.5) * spread
        const pY = currentMouse.y + (Math.random() - 0.5) * spread
        
        const isAccent = Math.random() > 0.5
        
        particles.current.push({
          id: particleIdCounter++,
          position: new THREE.Vector3(pX, pY, (Math.random() - 0.5) * 2), // Deeper Z spread
          velocity: new THREE.Vector3(
            mouseVelocity.current.x * 3 + (Math.random() - 0.5) * 3,
            mouseVelocity.current.y * 3 + (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 3
          ),
          age: 0,
          maxAge: 1.5 + Math.random() * 1.5,
          color: isAccent ? accentColor : magentaColor
        })
      }
    }
    
    prevMouse.current.copy(currentMouse)
    
    const dt = Math.min(delta, 0.1)
    const center = new THREE.Vector3(0, 0, -5) // Pull deeper into Z
    
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i]
      p.age += dt
      
      if (p.age >= p.maxAge) {
        particles.current.splice(i, 1)
        continue
      }
      
      p.velocity.multiplyScalar(0.92) // Higher drag
      
      const toCenter = center.clone().sub(p.position)
      p.velocity.add(toCenter.multiplyScalar(0.02))
      
      p.position.add(p.velocity.clone().multiplyScalar(dt))
    }
    
    if (meshRef.current) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (i < particles.current.length) {
          const p = particles.current[i]
          dummy.position.copy(p.position)
          const scale = 1 - Math.pow(p.age / p.maxAge, 2)
          dummy.scale.set(scale, scale, scale)
          dummy.updateMatrix()
          
          meshRef.current.setMatrixAt(i, dummy.matrix)
          
          p.color.toArray(colorArray, i * 3)
        } else {
          dummy.position.set(9999, 9999, 9999)
          dummy.scale.set(0, 0, 0)
          dummy.updateMatrix()
          meshRef.current.setMatrixAt(i, dummy.matrix)
        }
      }
      
      meshRef.current.instanceMatrix.needsUpdate = true
      
      if (meshRef.current.instanceColor) {
        meshRef.current.instanceColor.needsUpdate = true
      }
    }
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PARTICLES]}>
      <icosahedronGeometry args={[0.08, 0]} /> {/* Sharp geometry instead of spheres */}
      <meshBasicMaterial 
        transparent 
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  )
}

export function HeroCanvas() {
  const [mounted, setMounted] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  
  useEffect(() => {
    setMounted(true)
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(mediaQuery.matches)
    
    const listener = (e: MediaQueryListEvent) => setReduceMotion(e.matches)
    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }, [])

  if (!mounted || reduceMotion) return null

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 75 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: false, powerPreference: "high-performance" }}
      >
        <ParticleSystem />
      </Canvas>
    </div>
  )
}
