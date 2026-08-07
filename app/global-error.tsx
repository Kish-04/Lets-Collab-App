"use client"
import React, { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error, reset: () => void }) {
  const isWasmError = error.message.toLowerCase().includes('index out of bounds') ||
                      error.message.toLowerCase().includes('wasm') ||
                      error.message.toLowerCase().includes('memory access');

  useEffect(() => {
    if (isWasmError) {
      console.warn('[GlobalError] Auto-recovering from Wasm glitch:', error.message);
      reset();
    }
  }, [error, isWasmError, reset]);

  return (
    <html>
      <body>
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: '#080810', color: '#e8eaf2', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: '420px', textAlign: 'center' }}>
            {isWasmError ? (
                <div className="flex flex-col items-center gap-4">
                    <div style={{ width: '40px', height: '40px', border: '3px solid var(--accent, #2f7df6)', borderTopColor: 'transparent', borderRadius: '50%' }} className="animate-spin" />
                    <p style={{ color: '#9aa6bd' }}>Recovering from AI subsystem glitch...</p>
                </div>
            ) : (
                <>
                    <h2 style={{ fontSize: '28px', marginBottom: '12px' }}>Application error</h2>
                    <p style={{ color: '#9aa6bd', marginBottom: '20px' }}>The app hit an unexpected error. Try again once, and if it repeats, check the backend logs.</p>
                    {process.env.NODE_ENV !== 'production' && <p style={{ color: '#ff6b8a', fontFamily: 'monospace', fontSize: '12px' }}>{error.message}</p>}
                    <button onClick={() => reset()} style={{ marginTop: '18px', padding: '10px 18px', borderRadius: '8px', border: '1px solid #2f7df6', background: '#2f7df6', color: 'white', fontWeight: 700 }}>Retry</button>
                </>
            )}
          </div>
        </div>
      </body>
    </html>
  )
}
