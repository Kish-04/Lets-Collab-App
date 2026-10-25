"use client"

import React from 'react'

interface AiSupervisorProps {
  isActive: boolean
  status: 'idle' | 'loading' | 'ready' | 'error'
}

// The badge says what the anti-cheat engine is really doing: idle (not started), starting, active or failed
const STATUS_VIEW: Record<AiSupervisorProps['status'], { label: string; color: string; pulse?: boolean }> = {
  idle: { label: 'AI Supervisor Idle', color: 'var(--text-dim)' },
  loading: { label: 'AI Supervisor Starting', color: 'var(--amber)', pulse: true },
  ready: { label: 'AI Supervisor Active', color: 'var(--accent)' },
  error: { label: 'AI Supervisor Error', color: 'var(--red)' },
}

export function AiSupervisor({ isActive, status }: AiSupervisorProps) {
  if (!isActive) return null
  const view = STATUS_VIEW[status] || STATUS_VIEW.idle

  return (
    <div
      role="status"
      className="absolute right-2 top-2 z-10 flex items-center gap-2 rounded-md border bg-[var(--bg)]/60 px-2 py-1 text-xs text-[var(--text-primary)] backdrop-blur-md"
      style={{ borderColor: view.color }}
    >
      <div className={`h-2 w-2 rounded-full${view.pulse ? ' animate-pulse' : ''}`} style={{ backgroundColor: view.color }} />
      <span style={status === 'error' ? { color: view.color } : undefined}>{view.label}</span>
    </div>
  )
}
