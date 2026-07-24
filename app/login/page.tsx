"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Lock, Check } from "lucide-react"
import { AppLogo, GlowButton, AnimatedBackground, SecurityBadge } from "@/components/ircp/shared"
import { cn } from "@/lib/utils"

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  useEffect(() => {
    // Auto-login if previously authenticated
    if (localStorage.getItem('user_session_token')) {
      router.push("/")
    }
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    // Simulate authentication
    await new Promise(resolve => setTimeout(resolve, 1500))
    setLoading(false)
    setSuccess(true)
    localStorage.setItem('user_session_token', 'active_session')
    
    // Navigate after success animation
    await new Promise(resolve => setTimeout(resolve, 800))
    router.push("/")
  }

  const handleDevSkip = () => {
    localStorage.setItem('user_session_token', 'active_session')
    router.push("/")
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[var(--bg)]">
      <AnimatedBackground />
      
      {/* Login Card */}
      <div className="relative z-10 w-full max-w-[420px] mx-4">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 shadow-2xl">
          {/* Logo */}
          <div className="mb-8">
            <AppLogo />
          </div>
          
          {/* Divider */}
          <div className="flex items-center gap-3 mb-8">
            <div className="flex-1 h-px bg-[var(--border)]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
              Secure Access
            </span>
            <div className="flex-1 h-px bg-[var(--border)]" />
          </div>
          
          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username Field */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField(null)}
                placeholder="user@letscollab"
                className={cn(
                  "w-full px-4 py-3 bg-[var(--surface)] border rounded-xl font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)]",
                  "transition-all duration-150 outline-none",
                  focusedField === "username" 
                    ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-glow)]" 
                    : "border-[var(--border)] hover:border-[var(--border-bright)]"
                )}
              />
            </div>
            
            {/* Password Field */}
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  placeholder="••••••••"
                  className={cn(
                    "w-full px-4 py-3 pr-12 bg-[var(--surface)] border rounded-xl font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)]",
                    "transition-all duration-150 outline-none",
                    focusedField === "password" 
                      ? "border-[var(--accent)] shadow-[0_0_0_3px_var(--accent-glow)]" 
                      : "border-[var(--border)] hover:border-[var(--border-bright)]"
                  )}
                />
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" />
              </div>
            </div>
            
            {/* Submit Button */}
            <GlowButton 
              type="submit" 
              size="full"
              loading={loading}
              className={cn(
                "h-12 text-base",
                success && "bg-[var(--emerald)]"
              )}
            >
              {success ? (
                <>
                  <Check className="w-5 h-5" />
                  <span>Authenticated</span>
                </>
              ) : loading ? (
                "Authenticating..."
              ) : (
                "Sign In"
              )}
            </GlowButton>
          </form>
          
          {/* Links */}
          <div className="mt-6 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              {"Don't have an account? "}
              <a href="#" className="text-[var(--accent)] hover:underline">
                Request Access
              </a>
            </p>
            <button 
              onClick={handleDevSkip}
              className="mt-3 text-sm text-[var(--amber)] hover:underline font-mono"
            >
              [DEV] Skip Auth →
            </button>
          </div>
        </div>
        
        {/* Security Badges */}
        <div className="flex items-center justify-center gap-3 mt-6">
          <SecurityBadge icon="🔐" label="AES-256" />
          <SecurityBadge icon="⛓" label="Blockchain Logged" />
          <SecurityBadge icon="🤖" label="AI Protected" />
        </div>
      </div>
    </div>
  )
}







