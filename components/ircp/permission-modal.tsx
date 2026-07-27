"use client"

import { useState } from "react"
import { Shield, Eye, MousePointer, Keyboard, Zap, X, Check, Clock, FileText } from "lucide-react"
import { GlowButton, DangerButton } from "@/components/ircp/shared"
import { cn } from "@/lib/utils"

type PermissionLevel = "view" | "mouse" | "keyboard" | "full"

interface PermissionRequestModalProps {
  isOpen: boolean
  onClose: () => void
  onAllow: (permission: PermissionLevel, options: { timeLimit?: number; logSession: boolean; clipboardAllowed: boolean }) => void
  onDeny: () => void
  requester: {
    name: string
    initials: string
    device: string
    ip: string
  }
}

const permissionLevels = [
  { id: "view" as const, label: "VIEW", icon: Eye },
  { id: "mouse" as const, label: "MOUSE", icon: MousePointer },
  { id: "keyboard" as const, label: "KEYBOARD", icon: Keyboard },
  { id: "full" as const, label: "FULL", icon: Zap },
]

const timeLimits = [
  { value: 5, label: "5 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 0, label: "No limit" },
]

export function PermissionRequestModal({ 
  isOpen, 
  onClose, 
  onAllow, 
  onDeny,
  requester 
}: PermissionRequestModalProps) {
  const [selectedPermission, setSelectedPermission] = useState<PermissionLevel>("view")
  const [hasTimeLimit, setHasTimeLimit] = useState(false)
  const [timeLimit, setTimeLimit] = useState(15)
  const [logSession, setLogSession] = useState(true)
  const [clipboardAllowed, setClipboardAllowed] = useState(false)

  if (!isOpen) return null

  const handleAllow = () => {
    onAllow(selectedPermission, {
      timeLimit: hasTimeLimit ? timeLimit : undefined,
      logSession,
      clipboardAllowed,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className="relative bg-[var(--surface)] border border-[var(--border)] rounded-t-2xl sm:rounded-2xl w-full max-w-md mx-auto p-6 animate-[slideUp_0.3s_ease-out]"
        style={{
          animationName: "slideUp",
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-[var(--amber)]/10">
            <Shield className="w-8 h-8 text-[var(--amber)]" />
          </div>
          <h2 className="font-display font-bold text-xl text-[var(--text-primary)]">
            Access Request
          </h2>
        </div>

        {/* Requester Info */}
        <div className="p-4 bg-[var(--bg)] border border-[var(--border)] rounded-xl mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[var(--violet)] flex items-center justify-center">
              <span className="font-display font-bold text-lg text-white">
                {requester.initials}
              </span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-[var(--text-primary)]">{requester.name}</p>
              <p className="font-mono text-xs text-[var(--text-dim)]">
                {requester.device} · {requester.ip}
              </p>
            </div>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-3">
            Requesting access to your screen
          </p>
        </div>

        {/* Permission Level Selector */}
        <div className="flex gap-2 mb-6">
          {permissionLevels.map((level) => {
            const Icon = level.icon
            const isActive = selectedPermission === level.id
            return (
              <button
                key={level.id}
                onClick={() => setSelectedPermission(level.id)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 py-3 rounded-lg transition-all",
                  isActive
                    ? "bg-[var(--accent)] text-black"
                    : "bg-[var(--elevated)] text-[var(--text-secondary)] hover:bg-[var(--border)]"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-mono font-semibold">{level.label}</span>
              </button>
            )
          })}
        </div>

        {/* Session Options */}
        <div className="space-y-3 mb-6">
          {/* Time Limit */}
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              onClick={() => setHasTimeLimit(!hasTimeLimit)}
              className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                hasTimeLimit
                  ? "bg-[var(--accent)] border-[var(--accent)]"
                  : "border-[var(--border)] hover:border-[var(--border-bright)]"
              )}
            >
              {hasTimeLimit && <Check className="w-3 h-3 text-black" />}
            </button>
            <Clock className="w-4 h-4 text-[var(--text-dim)]" />
            <span className="text-sm text-[var(--text-secondary)]">Set time limit</span>
            
            {hasTimeLimit && (
              <select
                value={timeLimit}
                onChange={(e) => setTimeLimit(Number(e.target.value))}
                className="ml-auto px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-sm font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              >
                {timeLimits.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            )}
          </label>

          {/* Log Session */}
          <label className="flex items-center gap-3 cursor-pointer">
            <button
              onClick={() => setLogSession(!logSession)}
              className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                logSession
                  ? "bg-[var(--accent)] border-[var(--accent)]"
                  : "border-[var(--border)] hover:border-[var(--border-bright)]"
              )}
            >
              {logSession && <Check className="w-3 h-3 text-black" />}
            </button>
            <FileText className="w-4 h-4 text-[var(--text-dim)]" />
            <span className="text-sm text-[var(--text-secondary)]">Log this session</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <button
              onClick={() => setClipboardAllowed(!clipboardAllowed)}
              className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                clipboardAllowed
                  ? "bg-[var(--accent)] border-[var(--accent)]"
                  : "border-[var(--border)] hover:border-[var(--border-bright)]"
              )}
            >
              {clipboardAllowed && <Check className="w-3 h-3 text-black" />}
            </button>
            <Shield className="w-4 h-4 text-[var(--text-dim)]" />
            <span className="text-sm text-[var(--text-secondary)]">Allow remote clipboard shortcuts</span>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <DangerButton 
            size="full"
            className="flex-1"
            onClick={onDeny}
          >
            <X className="w-4 h-4" />
            DENY
          </DangerButton>
          <GlowButton 
            size="full"
            className="flex-[1.5]"
            onClick={handleAllow}
          >
            <Check className="w-4 h-4" />
            ALLOW ACCESS
          </GlowButton>
        </div>

        {/* Fine Print */}
        <p className="text-center font-mono text-[10px] text-[var(--text-dim)] mt-4">
          All actions will be logged and blockchain-verified
        </p>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
