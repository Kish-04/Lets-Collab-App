"use client"

import { cn } from "@/lib/utils"
import { Copy, ExternalLink } from "lucide-react"
import { useState, useEffect } from "react"

async function copyToClipboard(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fall through to the legacy copy path.
  }

  const textarea = document.createElement("textarea")
  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textarea)
  return copied
}

// Status Badge Component
type StatusType = "live" | "connecting" | "idle" | "high-risk" | "synced" | "warning"

const statusStyles: Record<StatusType, { dot: string; text: string; bg: string }> = {
  live: { dot: "bg-[var(--emerald)]", text: "text-[var(--emerald)]", bg: "bg-[var(--emerald)]/10" },
  connecting: { dot: "bg-[var(--amber)] animate-live-pulse", text: "text-[var(--amber)]", bg: "bg-[var(--amber)]/10" },
  idle: { dot: "bg-[var(--text-dim)]", text: "text-[var(--text-dim)]", bg: "bg-[var(--text-dim)]/10" },
  "high-risk": { dot: "bg-[var(--red)]", text: "text-[var(--red)]", bg: "bg-[var(--red)]/10" },
  synced: { dot: "bg-[var(--emerald)]", text: "text-[var(--emerald)]", bg: "bg-[var(--emerald)]/10" },
  warning: { dot: "bg-[var(--amber)]", text: "text-[var(--amber)]", bg: "bg-[var(--amber)]/10" },
}

export function StatusBadge({ 
  status, 
  label,
  className 
}: { 
  status: StatusType
  label?: string
  className?: string 
}) {
  const styles = statusStyles[status]
  const displayLabel = label || status.toUpperCase().replace("-", " ")
  
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[10px] tracking-wide uppercase",
      styles.bg,
      styles.text,
      className
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", styles.dot)} />
      {displayLabel}
    </span>
  )
}

// Room Code Display Component
export function RoomCodeDisplay({ 
  code,
  size = "default",
  className 
}: { 
  code: string
  size?: "small" | "default" | "large"
  className?: string 
}) {
  const [copied, setCopied] = useState(false)
  
  const handleCopy = async () => {
    if (await copyToClipboard(code)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  
  const chars = code.split("")
  const midpoint = Math.ceil(chars.length / 2)
  
  const sizeStyles = {
    small: "text-xs px-1.5 py-0.5 gap-0.5",
    default: "text-sm px-2 py-1 gap-1",
    large: "text-lg px-3 py-2 gap-1.5"
  }
  
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      <div className="flex items-center">
        {chars.map((char, i) => (
          <span key={i} className="flex items-center">
            {i === midpoint && (
              <span className="text-[var(--text-dim)] mx-1 font-mono">·</span>
            )}
            <span className={cn(
              "font-mono font-bold text-[var(--accent)] bg-[var(--surface)] border border-[var(--border)] rounded",
              sizeStyles[size]
            )}>
              {char}
            </span>
          </span>
        ))}
      </div>
      <button 
        onClick={handleCopy}
        className="p-1 text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors"
        aria-label="Copy room code"
      >
        <Copy className="w-4 h-4" />
      </button>
      {copied && (
        <span className="text-[var(--emerald)] text-xs font-mono animate-count-up">Copied!</span>
      )}
    </div>
  )
}

// Glow Button Component
export function GlowButton({ 
  children,
  variant = "primary",
  size = "default",
  loading = false,
  className,
  ...props 
}: { 
  children: React.ReactNode
  variant?: "primary" | "secondary" | "ghost"
  size?: "sm" | "default" | "lg" | "full"
  loading?: boolean
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variantStyles = {
    primary: "bg-[var(--accent)] text-black font-bold hover:shadow-[0_0_20px_rgba(0,212,255,0.4)]",
    secondary: "bg-[var(--violet)] text-white font-bold hover:shadow-[0_0_20px_rgba(110,63,255,0.4)]",
    ghost: "bg-transparent border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--border-bright)] hover:bg-[var(--elevated)]"
  }
  
  const sizeStyles = {
    sm: "px-3 py-1.5 text-sm rounded-md",
    default: "px-4 py-2 text-sm rounded-lg",
    lg: "px-6 py-3 text-base rounded-lg",
    full: "w-full px-4 py-3 text-sm rounded-lg"
  }
  
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-all duration-150",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        children
      )}
    </button>
  )
}

// Danger Button Component
export function DangerButton({ 
  children,
  pulsing = false,
  size = "default",
  className,
  ...props 
}: { 
  children: React.ReactNode
  pulsing?: boolean
  size?: "sm" | "default" | "lg" | "full"
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizeStyles = {
    sm: "px-3 py-1.5 text-sm rounded-md",
    default: "px-4 py-2 text-sm rounded-lg",
    lg: "px-6 py-3 text-base rounded-lg",
    full: "w-full px-4 py-3 text-sm rounded-lg"
  }
  
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-bold transition-all duration-150",
        "border border-[var(--red)] text-[var(--red)] bg-transparent",
        "hover:bg-[var(--red)] hover:text-white hover:shadow-[0_0_20px_rgba(255,59,92,0.4)]",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed",
        pulsing && "[--glow-color:rgba(255,59,92,0.4)] animate-pulse-glow",
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

// Data Card Component
export function DataCard({ 
  label,
  value,
  trend,
  color = "default",
  className 
}: { 
  label: string
  value: string | number
  trend?: string
  color?: "default" | "accent" | "violet" | "emerald" | "amber" | "red"
  className?: string 
}) {
  const colorStyles = {
    default: "text-[var(--text-primary)]",
    accent: "text-[var(--accent)]",
    violet: "text-[var(--violet)]",
    emerald: "text-[var(--emerald)]",
    amber: "text-[var(--amber)]",
    red: "text-[var(--red)]"
  }
  
  return (
    <div className={cn(
      "p-4 bg-[var(--surface)] border border-[var(--border)] rounded-lg",
      className
    )}>
      <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">
        {label}
      </span>
      <span className={cn(
        "block font-display font-extrabold text-2xl tracking-tight animate-count-up",
        colorStyles[color]
      )}>
        {value}
      </span>
      {trend && (
        <span className="block text-xs text-[var(--text-secondary)] mt-1">
          {trend}
        </span>
      )}
    </div>
  )
}

// Terminal Line Component
type EventType = "system" | "input" | "anticheat" | "chain" | "permission" | "user"

const eventStyles: Record<EventType, { border: string; badge: string; icon: string }> = {
  system: { border: "border-l-[var(--accent)]", badge: "text-[var(--accent)] bg-[var(--accent)]/10", icon: "●" },
  input: { border: "border-l-[var(--text-dim)]", badge: "text-[var(--text-secondary)] bg-[var(--text-dim)]/10", icon: "●" },
  anticheat: { border: "border-l-[var(--amber)]", badge: "text-[var(--amber)] bg-[var(--amber)]/10", icon: "⚠" },
  chain: { border: "border-l-[var(--violet)]", badge: "text-[var(--violet)] bg-[var(--violet)]/10", icon: "⛓" },
  permission: { border: "border-l-[var(--emerald)]", badge: "text-[var(--emerald)] bg-[var(--emerald)]/10", icon: "●" },
  user: { border: "border-l-[var(--violet)]", badge: "text-[var(--violet)] bg-[var(--violet)]/10", icon: "●" },
}

export function TerminalLine({ 
  time,
  type,
  message,
  className 
}: { 
  time: string
  type: EventType
  message: string
  className?: string 
}) {
  const styles = eventStyles[type] || eventStyles.system
  
  return (
    <div className={cn(
      "flex flex-col gap-1.5 py-2 px-3 font-mono text-[11px] border-l-2 bg-[var(--surface)] hover:bg-[var(--elevated)]/25 transition-all duration-150 rounded-r border-b border-[var(--border)]/10",
      styles.border,
      className
    )}>
      <div className="flex items-center justify-between gap-2 select-none">
        <span className="text-[var(--text-dim)] text-[9px] font-semibold">{time}</span>
        <div className="flex items-center gap-1.5">
          <span className={cn(
            "px-1.5 py-0.5 rounded text-[8px] uppercase tracking-wider font-bold",
            styles.badge
          )}>
            {type}
          </span>
          <span className="text-[9px] text-[var(--text-dim)]">{styles.icon}</span>
        </div>
      </div>
      <p className="text-[var(--text-secondary)] leading-relaxed text-xs break-words">{message}</p>
    </div>
  )
}

// Risk Gauge Component
export function RiskGauge({ 
  value,
  size = "default",
  className 
}: { 
  value: number
  size?: "small" | "default" | "large"
  className?: string 
}) {
  const normalizedValue = Math.min(100, Math.max(0, value))
  const circumference = 2 * Math.PI * 45
  const offset = circumference - (normalizedValue / 100) * circumference
  
  const getColor = (val: number) => {
    if (val < 30) return "var(--emerald)"
    if (val < 70) return "var(--amber)"
    return "var(--red)"
  }
  
  const color = getColor(normalizedValue)
  
  const sizeStyles = {
    small: { size: 80, fontSize: "text-lg", labelSize: "text-[8px]" },
    default: { size: 120, fontSize: "text-3xl", labelSize: "text-[10px]" },
    large: { size: 160, fontSize: "text-4xl", labelSize: "text-xs" }
  }
  
  const s = sizeStyles[size]
  
  return (
    <div className={cn("relative inline-flex flex-col items-center", className)}>
      <svg width={s.size} height={s.size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={s.size / 2}
          cy={s.size / 2}
          r={45 * (s.size / 120)}
          fill="none"
          stroke="var(--border)"
          strokeWidth="6"
        />
        {/* Progress circle */}
        <circle
          cx={s.size / 2}
          cy={s.size / 2}
          r={45 * (s.size / 120)}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference * (s.size / 120)}
          strokeDashoffset={offset * (s.size / 120)}
          className="transition-all duration-500"
        />
        {/* Threshold markers */}
        <circle
          cx={s.size / 2 + Math.cos((30 / 100) * 2 * Math.PI - Math.PI / 2) * 45 * (s.size / 120)}
          cy={s.size / 2 + Math.sin((30 / 100) * 2 * Math.PI - Math.PI / 2) * 45 * (s.size / 120)}
          r="2"
          fill="var(--text-dim)"
        />
        <circle
          cx={s.size / 2 + Math.cos((70 / 100) * 2 * Math.PI - Math.PI / 2) * 45 * (s.size / 120)}
          cy={s.size / 2 + Math.sin((70 / 100) * 2 * Math.PI - Math.PI / 2) * 45 * (s.size / 120)}
          r="2"
          fill="var(--text-dim)"
        />
      </svg>
      <span 
        className={cn(
          "absolute font-display font-extrabold tracking-tight",
          s.fontSize
        )}
        style={{ color, top: '50%', transform: 'translateY(-70%)' }}
      >
        {normalizedValue}
      </span>
      <span className={cn(
        "font-mono uppercase tracking-widest text-[var(--text-dim)] mt-2",
        s.labelSize
      )}>
        Risk Score
      </span>
    </div>
  )
}

// Live Dot Component
export function LiveDot({ 
  color = "emerald",
  className 
}: { 
  color?: "emerald" | "amber" | "red" | "accent" | "violet"
  className?: string 
}) {
  const colorStyles = {
    emerald: "bg-[var(--emerald)] [--glow-color:var(--emerald-glow)]",
    amber: "bg-[var(--amber)] [--glow-color:var(--amber-glow)]",
    red: "bg-[var(--red)] [--glow-color:var(--red-glow)]",
    accent: "bg-[var(--accent)] [--glow-color:var(--accent-glow)]",
    violet: "bg-[var(--violet)] [--glow-color:var(--violet-glow)]"
  }
  
  return (
    <span className={cn(
      "w-2 h-2 rounded-full animate-pulse-glow",
      colorStyles[color],
      className
    )} />
  )
}

// Let us Collab brand mark and wordmark
export function BrandMark({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" className={cn("text-[var(--accent)]", className)} aria-hidden="true" {...props}>
      <rect x="4" y="6" width="40" height="29" rx="9" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="2" />
      <path d="M17 38h14M24 35v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13 17c0-2.2 1.8-4 4-4h7v13h-7c-2.2 0-4-1.8-4-4v-5Z" fill="currentColor" />
      <path d="M35 17c0-2.2-1.8-4-4-4h-7v13h7c2.2 0 4-1.8 4-4v-5Z" fill="currentColor" fillOpacity="0.38" />
      <path d="m20 30 4-4 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AppLogo({ 
  size = "default",
  className 
}: { 
  size?: "small" | "default" | "large"
  className?: string 
}) {
  const sizeStyles = {
    small: { icon: 32, title: "text-xl", subtitle: "text-[8px]" },
    default: { icon: 56, title: "text-4xl", subtitle: "text-[11px]" },
    large: { icon: 72, title: "text-5xl", subtitle: "text-xs" }
  }
  
  const s = sizeStyles[size]
  
  return (
    <div className={cn("flex flex-row items-center gap-3", className)}>
      <div 
        className="flex items-center justify-center rounded-xl bg-transparent"
        style={{ width: s.icon, height: s.icon }}
      >
        <img 
          src="/logo.png" 
          alt="Let's Collab Logo" 
          className="w-full h-full object-contain"
        />
      </div>
      <div className="text-left flex flex-col justify-center">
        <h1 className={cn("font-display font-black tracking-tight text-[var(--text-primary)] leading-none", s.title)}>
          Let&apos;s Collab!
        </h1>
        <p className={cn("font-mono uppercase tracking-[0.1em] text-[var(--text-dim)] mt-1", s.subtitle)}>
          Work together. Stay in control.
        </p>
      </div>
    </div>
  )
}

// Section Header Component
export function SectionHeader({ 
  title,
  className 
}: { 
  title: string
  className?: string 
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 py-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]",
      className
    )}>
      <span className="text-[var(--border-bright)]">────</span>
      <span>{title}</span>
      <span className="text-[var(--border-bright)]">────</span>
    </div>
  )
}

// Security Badge Component
export function SecurityBadge({ 
  icon,
  label,
  className 
}: { 
  icon: string
  label: string
  className?: string 
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-[var(--border)] font-mono text-[10px] text-[var(--text-dim)]",
      className
    )}>
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}

// Animated Background Component
export function AnimatedBackground({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden pointer-events-none", className)}>
      {/* Mesh gradient blobs */}
      <div 
        className="absolute w-[600px] h-[600px] rounded-full opacity-30 blur-[100px] animate-gradient-shift"
        style={{ 
          background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
          top: "-20%",
          left: "-10%"
        }}
      />
      <div 
        className="absolute w-[500px] h-[500px] rounded-full opacity-20 blur-[80px] animate-gradient-shift"
        style={{ 
          background: "radial-gradient(circle, var(--violet) 0%, transparent 70%)",
          bottom: "-10%",
          right: "-5%",
          animationDelay: "-5s"
        }}
      />
      <div 
        className="absolute w-[400px] h-[400px] rounded-full opacity-10 blur-[60px] animate-gradient-shift"
        style={{ 
          background: "radial-gradient(circle, var(--surface) 0%, transparent 70%)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          animationDelay: "-10s"
        }}
      />
      {/* Noise overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat"
        }}
      />
    </div>
  )
}

// Skeleton Loader Component
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn(
      "bg-[var(--surface)] rounded animate-shimmer",
      className
    )} />
  )
}

// Permission Tag Component
export function PermissionTag({ 
  label,
  active = false,
  className 
}: { 
  label: string
  active?: boolean
  className?: string 
}) {
  return (
    <span className={cn(
      "px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wide border",
      active 
        ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10" 
        : "border-[var(--border)] text-[var(--text-dim)]",
      className
    )}>
      {label}
    </span>
  )
}

// Transaction Hash Display
export function TxHash({ 
  hash,
  className 
}: { 
  hash: string
  className?: string 
}) {
  const [copied, setCopied] = useState(false)
  const truncated = `${hash.slice(0, 6)}...${hash.slice(-4)}`
  
  const handleCopy = async () => {
    if (await copyToClipboard(hash)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", className)}>
      <span className="text-[var(--text-secondary)]">{truncated}</span>
      <button 
        onClick={handleCopy}
        className="p-0.5 text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors"
        aria-label="Copy transaction hash"
      >
        <Copy className="w-3 h-3" />
      </button>
      <a 
        href={`https://sepolia.etherscan.io/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="p-0.5 text-[var(--text-dim)] hover:text-[var(--accent)] transition-colors"
        aria-label="View on Etherscan"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
      {copied && (
        <span className="text-[var(--emerald)] text-[10px] animate-count-up">Copied!</span>
      )}
    </span>
  )
}

// Animated Counter Component
export function AnimatedCounter({ 
  value,
  className 
}: { 
  value: number
  className?: string 
}) {
  const [displayValue, setDisplayValue] = useState(0)
  
  useEffect(() => {
    const duration = 500
    const startTime = Date.now()
    const startValue = displayValue
    
    const animate = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      
      setDisplayValue(Math.round(startValue + (value - startValue) * eased))
      
      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }
    
    requestAnimationFrame(animate)
  }, [value])
  
  return (
    <span className={className}>{displayValue}</span>
  )
}
