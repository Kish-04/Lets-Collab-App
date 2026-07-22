"use client"
import React from 'react'

export default function AppRouteError({ error, reset }: { error: Error, reset: () => void }) {
  return (
    <div style={{ padding: '20px', backgroundColor: '#220000', color: '#ffaaaa', fontFamily: 'monospace', height: '100vh', width: '100vw' }}>
      <h2>App Route Crash</h2>
      <p>{error?.message || 'Unknown error'}</p>
      <pre>{error?.stack}</pre>
      <button onClick={() => reset()} style={{ padding: '10px', marginTop: '20px' }}>Retry</button>
    </div>
  )
}
