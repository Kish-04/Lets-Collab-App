import React, { useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { create } from 'zustand'

export const useVerificationStore = create<{
  stats: { triangles: number; calls: number; geometries: number; textures: number; totalMeshes: number };
  wireframe: boolean;
  setStats: (stats: any) => void;
  toggleWireframe: () => void;
}>((set) => ({
  stats: { triangles: 0, calls: 0, geometries: 0, textures: 0, totalMeshes: 0 },
  wireframe: false,
  setStats: (stats) => set({ stats }),
  toggleWireframe: () => set((state) => ({ wireframe: !state.wireframe }))
}))

// Place this INSIDE the Canvas
export const VerificationDataCollector = () => {
  const { gl, scene } = useThree()
  const { setStats, wireframe } = useVerificationStore()
  
  // Use a ref to throttle the state updates to avoid React render loops
  const lastUpdate = React.useRef(0)

  useFrame(() => {
    const now = performance.now()
    if (now - lastUpdate.current > 1000) { // Update stats every 1 second
      lastUpdate.current = now

      let totalMeshes = 0
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) totalMeshes++
      })

      // gl.info.render is volatile. R3F sometimes clears it. 
      // We read it right inside the render loop where it's populated.
      setStats({
        triangles: gl.info.render.triangles,
        calls: gl.info.render.calls,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        totalMeshes
      })
    }
  })

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => { m.wireframe = wireframe })
        } else {
          obj.material.wireframe = wireframe
        }
      }
    })
  }, [wireframe, scene])

  return null
}

// Place this OUTSIDE the Canvas
export const DesignVerificationOverlay = () => {
  const { stats, wireframe, toggleWireframe } = useVerificationStore()

  return (
    <div 
      style={{ position: 'fixed', bottom: '20px', left: '20px', width: '250px', zIndex: 99999, pointerEvents: 'auto' }}
      className="bg-black/90 text-green-400 p-4 rounded border border-green-900 font-mono text-xs shadow-2xl backdrop-blur"
    >
      <div className="font-bold text-white mb-2 text-sm border-b border-green-900 pb-1">DESIGN VERIFICATION</div>
      
      <div className="mb-2">
        <span className="text-gray-400">Total Meshes:</span> {stats.totalMeshes}
      </div>
      
      <div className="space-y-1 mb-3 border-t border-green-900 pt-2">
        <div className="text-white font-semibold">Renderer (gl.info)</div>
        <div className="flex justify-between"><span>Draw Calls:</span> <span>{stats.calls}</span></div>
        <div className="flex justify-between"><span>Triangles:</span> <span>{stats.triangles.toLocaleString()}</span></div>
        <div className="flex justify-between"><span>Geometries:</span> <span>{stats.geometries}</span></div>
        <div className="flex justify-between"><span>Textures:</span> <span>{stats.textures}</span></div>
      </div>

      <button 
        onClick={toggleWireframe}
        className={`w-full py-2 rounded font-bold transition-all ${wireframe ? 'bg-green-500 text-black' : 'bg-gray-800 text-white hover:bg-gray-700'}`}
      >
        {wireframe ? 'Disable Wireframe' : 'Enable Wireframe'}
      </button>
    </div>
  )
}
