import * as THREE from 'three'

// ==========================================
// 1. HIGH-FIDELITY PBR MATERIALS
// ==========================================

// Matte ceramic white shell (Completely flat, ZERO glossy reflections)
export const WhiteArmor = new THREE.MeshStandardMaterial({
  color: '#E2E5E9', // Softer off-white to prevent blowout
  emissive: '#000000',
  emissiveIntensity: 0,
  roughness: 1.0, // 100% matte
  metalness: 0.0,
})

// Premium dark carbon/rubber composite for inner mechanics
export const CarbonChassis = new THREE.MeshStandardMaterial({
  color: '#1a1d20',
  roughness: 0.8,
  metalness: 0.3,
})

// Flexible dark rubber for joints
export const RubberJoint = new THREE.MeshStandardMaterial({
  color: '#0a0b0c',
  roughness: 0.95,
  metalness: 0.1,
})

// Brushed steel / anodized aluminum for mechanical rods and pistons
export const BrushedMetal = new THREE.MeshStandardMaterial({
  color: '#9aa0a6',
  roughness: 0.3,
  metalness: 0.85,
  envMapIntensity: 1.5,
})

// Premium Glass Visor (Highly refractive, thick, dark glass)
export const VisorGlass = new THREE.MeshStandardMaterial({
  color: '#000000',
  roughness: 0.1,
  metalness: 0.2,
  transparent: true,
  opacity: 0.25, // Simple transparency so the eyes inside are guaranteed to render!
})

// Inner display panel material (behind the glass)
export const VisorScreen = new THREE.MeshPhysicalMaterial({
  color: '#050505',
  roughness: 0.8, // Matte screen underneath the glass
  metalness: 0.1,
  clearcoat: 0,
  envMapIntensity: 0.1,
})

// Emissive cyan for eyes and mechanical accents
export const CyanGlow = new THREE.MeshStandardMaterial({
  color: '#00eeff',
  emissive: '#00eeff',
  emissiveIntensity: 5.0,
  toneMapped: false,
})

// Helper to update eye/LED color based on state
export function updateLEDColor(emotion: string) {
  let c = '#00eeff' // Default Cyan
  
  switch(emotion.toLowerCase()) {
    case 'warning':
    case 'error':
      c = '#ff1133' // Intense Red
      break
    case 'thinking':
    case 'searching':
    case 'downloading':
    case 'uploading':
      c = '#bb44ff' // Purple
      break
    case 'happy':
    case 'celebrating':
    case 'excited':
      c = '#00ff77' // Vibrant Green
      break
    case 'sleep':
    case 'low battery':
    case 'offline':
      c = '#ff8800' // Amber
      break
  }

  CyanGlow.color.set(c)
  CyanGlow.emissive.set(c)
}
