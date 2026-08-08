"use client"

import React, { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { motion } from 'framer-motion'

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
uniform float uTime;
uniform float uProgress;
uniform vec3 uColor1;
uniform vec3 uColor2;
varying vec2 vUv;

// Simple 2D noise
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {
  float noise = random(vUv * 10.0 + uTime * 0.1);
  float mask = step(vUv.x + (noise * 0.2 - 0.1), uProgress * 1.2);
  
  // Mixed gradient
  vec3 color = mix(uColor1, uColor2, vUv.y);
  
  if (mask < 0.5) discard;
  
  // Add a slight glow edge
  float edge = smoothstep(uProgress * 1.2 - 0.05, uProgress * 1.2, vUv.x + (noise * 0.2 - 0.1));
  vec3 finalColor = mix(color, vec3(1.0), edge);
  
  gl_FragColor = vec4(finalColor, mask * 0.5);
}
`

function ShaderMask({ progress }: { progress: number }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uColor1: { value: new THREE.Color('#00d4ff') },
    uColor2: { value: new THREE.Color('#a855f7') }
  }), [])

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime
      // Smoothly interpolate progress
      materialRef.current.uniforms.uProgress.value += (progress - materialRef.current.uniforms.uProgress.value) * 0.1
    }
  })

  return (
    <mesh>
      <planeGeometry args={[10, 10]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  )
}

export function ShowcaseShaderMask({ children }: { children: React.ReactNode }) {
  const [inView, setInView] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true)
      },
      { threshold: 0.2 }
    )
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <div className="absolute inset-0 z-0 pointer-events-none opacity-50">
        <Canvas camera={{ position: [0, 0, 1] }}>
          <ShaderMask progress={inView ? 1 : 0} />
        </Canvas>
      </div>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: inView ? 1 : 0 }}
        transition={{ duration: 1.5, delay: 0.5 }}
        className="relative z-10 w-full h-full"
      >
        {children}
      </motion.div>
    </div>
  )
}
