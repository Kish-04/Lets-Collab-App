"use client"
import React from 'react'

export default function AppRouteError({ error, reset }: { error: Error, reset: () => void }) {
  const showDetails = process.env.NODE_ENV !== 'production'
  return (
    <div style={{ minHeight: '100vh', width: '100vw', display: 'grid', placeItems: 'center', padding: '24px', background: '#080810', color: '#e8eaf2', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '420px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '28px', marginBottom: '12px' }}>Dashboard error</h2>
        <p style={{ color: '#9aa6bd', marginBottom: '20px' }}>The dashboard could not finish loading. Try again once, and if it repeats, check the backend logs.</p>
        {showDetails && <p style={{ color: '#ff6b8a', fontFamily: 'monospace', fontSize: '12px' }}>{error?.message || 'Unknown error'}</p>}
        <button onClick={() => reset()} style={{ marginTop: '18px', padding: '10px 18px', borderRadius: '8px', border: '1px solid #2f7df6', background: '#2f7df6', color: 'white', fontWeight: 700 }}>Retry</button>
      </div>
    </div>
  )
}
