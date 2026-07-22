"use client"
import React from 'react'

export default function ErrorBoundary({ error, reset }: { error: Error, reset: () => void }) {
  return (
    <div style={{ padding: '20px', color: 'red', fontFamily: 'monospace' }}>
      <h2>Route Error Boundary</h2>
      <p>{error.message}</p>
      <pre>{error.stack}</pre>
      <button onClick={() => reset()}>Retry</button>
    </div>
  )
}
