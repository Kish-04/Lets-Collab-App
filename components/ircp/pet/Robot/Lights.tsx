import React from 'react'
import { Environment, ContactShadows } from '@react-three/drei'

export function Lights() {
  return (
    <>
      {/* Cinematic Studio Lighting Setup (Physically correct to prevent clipping/bloom on white surfaces) */}
      {/* Soft ambient fill */}
      <ambientLight intensity={0.4} color="#eef5ff" />
      
      {/* Primary Key Light (Warm, balanced intensity, casts sharp shadows) */}
      <directionalLight 
        position={[10, 20, 15]} 
        intensity={1.2} 
        color="#fffaee" 
        castShadow 
        shadow-mapSize={[2048, 2048]} 
        shadow-bias={-0.0001}
      />
      
      {/* Fill Light (Cool, soft, low intensity to fill dark sides without overexposing) */}
      <directionalLight position={[-15, 5, -10]} intensity={0.5} color="#88aaff" />
      
      {/* Rim Light (Bright, behind the subject to pop edges, kept below bloom threshold) */}
      <pointLight position={[0, 10, -15]} intensity={1.5} color="#ffffff" />
      
      {/* Ground Bounce Fill */}
      <directionalLight position={[0, -10, 0]} intensity={0.2} color="#ffffff" />

      {/* High-quality HDRI Environment (Intensity reduced so reflections don't bloom) */}
      <Environment preset="studio" environmentIntensity={0.6} />

      {/* Ground Contact Shadows for realistic weight */}
      <ContactShadows 
        position={[0, -4.0, 0]} 
        opacity={0.7} 
        scale={10} 
        blur={2} 
        far={5} 
        resolution={512} 
        color="#000000" 
      />
    </>
  )
}
