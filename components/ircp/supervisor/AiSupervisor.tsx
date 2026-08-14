"use client"

import React from 'react'

interface AiSupervisorProps {
  isActive: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
}

export function AiSupervisor({ isActive, status }: AiSupervisorProps) {
  if (!isActive) return null

  return (
    <div className="absolute right-2 top-2 z-10 flex items-center gap-2 rounded-md border border-[var(--accent)] bg-[var(--bg)]/60 px-2 py-1 text-xs text-[var(--text-primary)] backdrop-blur-md">
      <div className="h-2 w-2 rounded-full bg-[var(--accent)]" />
      {status === 'error' ? (
        <span className="text-red-300">AI Error</span>
      ) : status === 'loading' ? (
        <span>Loading AI</span>
      ) : (
        <span>AI Supervisor Active</span>
      )}
    </div>
  )
}
