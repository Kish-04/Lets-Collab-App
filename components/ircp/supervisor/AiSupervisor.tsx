"use client"

import React from 'react'
import { useFederatedAI } from '@/hooks/useFederatedAI'

interface AiSupervisorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  isActive: boolean
  onMalpractice: (reason: string) => void
}

export function AiSupervisor({ videoRef, isActive, onMalpractice }: AiSupervisorProps) {
  const { isModelLoaded, loadError } = useFederatedAI(
    videoRef,
    isActive,
    (_type, message) => onMalpractice(message),
  )

  if (!isActive) return null

  return (
    <div className="absolute right-2 top-2 z-10 flex items-center gap-2 rounded-md border border-[var(--accent)] bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-md">
      <div className="h-2 w-2 rounded-full bg-[var(--accent)]" />
      {loadError ? (
        <span className="text-red-300">AI Error</span>
      ) : !isModelLoaded ? (
        <span>Loading AI</span>
      ) : (
        <span>AI Supervisor Active</span>
      )}
    </div>
  )
}
