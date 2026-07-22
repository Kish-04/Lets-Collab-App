"use client"
import React from 'react'

export default function GlobalError({ error, reset }: { error: Error, reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{ padding: '20px', color: 'red', fontFamily: 'monospace' }}>
          <h2>Global Error Boundary</h2>
          <p>{error.message}</p>
          <pre>{error.stack}</pre>
          <button onClick={() => reset()}>Retry</button>
        </div>
      </body>
    </html>
  )
}
