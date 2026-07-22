"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Monitor, Gamepad2, LayoutDashboard, ArrowRight, User, Lock, Mail, ShieldAlert, Activity } from "lucide-react"
import { io, Socket } from "socket.io-client"
import emailjs from "@emailjs/browser"
import { AppLogo, StatusBadge, GlowButton, PermissionTag, LiveDot } from "@/components/ircp/shared"
import { cn, getBackendUrl } from "@/lib/utils"

interface RoleCard {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  color: "accent" | "violet" | "amber" | "blue" | "emerald"
  tags: string[]
  href: string
}

const roles: RoleCard[] = [
  {
    id: "host-collab",
    title: "Collaboration Room",
    description: "Work together with host-approved screen observation and precise access.",
    icon: <Monitor className="w-8 h-8" />,
    color: "blue",
    tags: ["VIEW FIRST", "HOST APPROVAL", "CONTROL"],
    href: "/session?create=true&mode=collaboration"
  },
  {
    id: "host-supervised",
    title: "Supervised Session",
    description: "Visible oversight for support or assessment, with both activity feeds recorded.",
    icon: <ShieldAlert className="w-8 h-8" />,
    color: "amber",
    tags: ["VISIBLE ADMIN", "ACTIVITY", "AUDIT"],
    href: "/session?create=true&mode=supervised"
  },
  {
    id: "recent-sessions",
    title: "Recent Sessions",
    description: "Quickly rejoin or review your recent collaborative and supervised sessions.",
    icon: <Activity className="w-8 h-8" />,
    color: "emerald",
    tags: ["HISTORY", "QUICK JOIN"],
    href: "/recent"
  }
]

const colorStyles = {
  accent: {
    border: "border-l-[var(--accent)]",
    text: "text-[var(--accent)]",
    glow: "group-hover:shadow-[0_0_30px_var(--accent-glow)]"
  },
  violet: {
    border: "border-l-[var(--violet)]",
    text: "text-[var(--violet)]",
    glow: "group-hover:shadow-[0_0_30px_var(--violet-glow)]"
  },
  amber: {
    border: "border-l-[var(--amber)]",
    text: "text-[var(--amber)]",
    glow: "group-hover:shadow-[0_0_30px_var(--amber-glow)]"
  },
  blue: {
    border: "border-l-[#2f7df6]",
    text: "text-[#2f7df6]",
    glow: "group-hover:shadow-[0_0_30px_rgba(47,125,246,0.2)]"
  },
  emerald: {
    border: "border-l-[var(--emerald)]",
    text: "text-[var(--emerald)]",
    glow: "group-hover:shadow-[0_0_30px_var(--emerald-glow)]"
  }
}

export default function HomePage() {
  const router = useRouter()
  const [roomId, setRoomId] = useState("")

  // Auth state
  const [authMode, setAuthMode] = useState<"login" | "register" | "verify" | "forgot" | "reset" | null>(null)
  const [formData, setFormData] = useState({ name: "", email: "", password: "", otp: "" })
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [isAuth, setIsAuth] = useState(false)

  const [activeSessions, setActiveSessions] = useState(0)
  const [latency, setLatency] = useState(0)
  const pingTsRef = useRef<number>(0)

  // Read localStorage only on client to avoid SSR hydration mismatch
  useEffect(() => {
    setIsAuth(!!localStorage.getItem('ircp_user'))
    
    // Connect to signaling server for live stats
    const socket = io(getBackendUrl())
    
    socket.on('sessions-count', ({ active }: { active: number }) => {
      setActiveSessions(active)
    })
    
    socket.on('pong-ircp', () => {
      setLatency(Date.now() - pingTsRef.current)
    })
    
    const interval = setInterval(() => {
      if (socket.connected) {
        pingTsRef.current = Date.now()
        socket.emit('ping-ircp')
      }
    }, 2000)
    
    socket.on('connect', () => {
      socket.emit('get-session-count')
    })

    return () => {
      clearInterval(interval)
      socket.disconnect()
    }
  }, [])

  const handleRoleClick = (href: string) => {
    if (href.startsWith("/admin")) {
      const role = localStorage.getItem('ircp_role')
      if (role === 'admin') {
        router.push(href)
      } else {
        router.push('/admin/login')
      }
      return
    }

    if (isAuth) {
      router.push(href)
    } else {
      setAuthMode("login")
    }
  }

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAuth) { setAuthMode("login"); return }
    if (roomId.trim()) router.push(`/session?room=${roomId.toUpperCase()}`)
  }

  const sendOTPEmailJS = async (toEmail: string, otp: string, toName: string = 'User') => {
    try {
      const templateParams = {
        to_name: toName,
        to_email: toEmail,
        passcode: otp, // Matches the {{passcode}} variable in your EmailJS template!
      }
      const serviceId = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID || 'service_vlnxzdl'
      const templateId = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID || 'template_ogznez9'
      const publicKey = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY || 'tQS6xbi2oi4XC64JV'
      await emailjs.send(
        serviceId,
        templateId,
        templateParams,
        publicKey
      )
      console.log('[EmailJS] OTP sent successfully to', toEmail)
    } catch (err: any) {
      console.error('[EmailJS ERROR] Failed to send OTP:', err)
    }
  }

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg("")

    try {
      if (authMode === "register") {
        const res = await fetch(`${getBackendUrl()}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: formData.name, email: formData.email, password: formData.password })
        })
        const data = await res.json()
        if (res.ok) {
          if (data.otp) {
            await sendOTPEmailJS(formData.email, data.otp, formData.name)
          }
          setAuthMode("verify")
        } else {
          setErrorMsg(data.message || "Registration failed")
        }
      }
      else if (authMode === "verify") {
        const res = await fetch(`${getBackendUrl()}/api/auth/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: formData.email, otp: formData.otp })
        })
        const data = await res.json()
        if (res.ok) {
          localStorage.setItem('ircp_user', JSON.stringify(data))
          localStorage.setItem('ircp_name', data.name || formData.email)
          localStorage.setItem('ircp_email', formData.email)
          setIsAuth(true)
          setAuthMode(null)
          window.location.reload()
        } else {
          setErrorMsg(data.message || "Verification failed")
        }
      }
      else if (authMode === "login") {
        const res = await fetch(`${getBackendUrl()}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: formData.email, password: formData.password })
        })
        const data = await res.json()
        if (res.ok) {
          if (!data.otp) {
            localStorage.setItem('ircp_user', JSON.stringify(data))
            localStorage.setItem('ircp_name', data.name || formData.email)
            localStorage.setItem('ircp_email', formData.email)
            setIsAuth(true)
            setAuthMode(null)
            window.location.reload()
          } else {
            if (data.otp) {
              await sendOTPEmailJS(formData.email, data.otp, data.name || 'User')
            }
            setAuthMode("verify")
          }
        } else {
          setErrorMsg(data.message || "Login failed")
        }
      }
      else if (authMode === "forgot") {
        const res = await fetch(`${getBackendUrl()}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: formData.email })
        })
        const data = await res.json()
        if (res.ok) {
          if (data.otp) {
            await sendOTPEmailJS(formData.email, data.otp, 'User')
          }
          setAuthMode("reset")
        } else {
          setErrorMsg(data.message || "Failed to send reset link")
        }
      }
      else if (authMode === "reset") {
        const res = await fetch(`${getBackendUrl()}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: formData.email, otp: formData.otp, newPassword: formData.password })
        })
        const data = await res.json()
        if (res.ok) {
          setAuthMode("login")
          setFormData({ ...formData, password: "", otp: "" })
          // Alert user or show success in the UI (since errorMsg is red, let's just use alert for simplicity)
          alert("Password reset successful. You can now log in.")
        } else {
          setErrorMsg(data.message || "Reset failed")
        }
      }
    } catch (err: any) {
      setErrorMsg("Network error. Ensure the server is running.")
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch(`${getBackendUrl()}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch (e) {}
    localStorage.removeItem('ircp_user')
    setIsAuth(false)
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-10 py-5">
        <AppLogo size="default" />
        <div className="flex items-center gap-6">
          <span className="hidden text-xs text-[var(--text-dim)] sm:block">Permission-first remote collaboration</span>
          <a href="/downloads/IRCP-Setup-0.1.0.exe" download className="hidden sm:flex items-center gap-2 px-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-md hover:bg-[var(--elevated)] transition-colors text-sm font-medium">
            <Monitor className="w-4 h-4" />
            Download App
          </a>
        </div>
      </header>
      <main className="flex-1 flex flex-col lg:flex-row">
        {/* Left — Hero */}
        <div className="flex-[0.6] p-12 flex flex-col justify-center">
          <StatusBadge status="live" label="System Online" className="mb-6 w-fit" />

          <h1 className="font-display font-black text-5xl leading-tight text-[var(--text-primary)] mb-4">
            Remote work with
            <br />
            <span className="relative inline-block">
              clear control
              <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 100 8" preserveAspectRatio="none">
                <path d="M0 7 Q25 0, 50 4 T100 7" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </span>
          </h1>

          <p className="text-lg text-[var(--text-secondary)] max-w-md leading-relaxed mb-8">
            Create a collaborative room or a visibly supervised session. Access begins view-only, and every intervention is explicit.
          </p>

          <div className="flex flex-wrap gap-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] font-mono text-xs text-[var(--text-dim)]">
              {activeSessions > 0 ? <LiveDot color="emerald" /> : <div className="w-2 h-2 rounded-full bg-[var(--text-dim)]" />}
              {activeSessions} Active Sessions
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] font-mono text-xs text-[var(--text-dim)]">
              {latency === 0 ? "—ms" : `${latency}ms`} Latency
            </div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] font-mono text-xs text-[var(--text-dim)]">
              Chain: Sepolia
            </div>
          </div>
        </div>

        {/* Right — Role Cards */}
        <div className="flex-[0.45] p-8 xl:p-12 flex flex-col justify-center gap-3 lg:border-l border-[var(--border)] relative">

          {/* Auth strip */}
          <div className="absolute top-6 right-6 flex items-center gap-4">
            {isAuth ? (
              <div className="flex items-center gap-4">
                <span className="text-sm font-mono text-[var(--emerald)]">✓ Authenticated</span>
                <button onClick={handleLogout} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline">
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button onClick={() => setAuthMode('login')} className="text-sm text-[var(--text-secondary)] hover:text-white transition-colors">Login</button>
                <GlowButton size="sm" onClick={() => setAuthMode('register')}>Sign Up</GlowButton>
              </div>
            )}
          </div>

          {!isAuth && (
            <div className="bg-[var(--surface)] border border-[var(--amber)]/30 rounded-lg p-4 mb-4 mt-8 text-sm text-[var(--amber)]">
              Authentication required. Please login or register to access roles.
            </div>
          )}

          {roles.map((role) => (
            <div key={role.id} className="relative">
              {!isAuth && (
                <div className="absolute inset-0 z-10 bg-black/5 rounded-lg cursor-not-allowed" onClick={() => setAuthMode('login')} />
              )}
              <button
                onClick={() => handleRoleClick(role.href)}
                className={cn(
                  "group w-full text-left p-6 bg-[var(--surface)] border border-[var(--border)] border-l-[3px] rounded-lg",
                  "transition-all duration-200 hover:-translate-y-1 hover:border-[var(--border-bright)]",
                  colorStyles[role.color].border,
                  colorStyles[role.color].glow,
                  !isAuth && "opacity-50"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={cn("p-2 rounded-lg bg-[var(--elevated)]", colorStyles[role.color].text)}>
                      {role.icon}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-display font-bold text-lg text-[var(--text-primary)] mb-1">{role.title}</h3>
                      <p className="text-sm text-[var(--text-secondary)] mb-3 leading-relaxed">{role.description}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {role.tags.map((tag) => (
                          <PermissionTag key={tag} label={tag} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-[var(--text-dim)] group-hover:text-[var(--text-primary)] transition-colors" />
                </div>
              </button>
            </div>
          ))}
        </div>
      </main>

      {/* Footer — Room Join */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)] py-4">
        <form onSubmit={handleJoinRoom} className="flex items-center justify-center gap-4">
          <label className="font-mono text-xs text-[var(--text-dim)] uppercase tracking-wide">
            Enter Room ID:
          </label>
          <div className="flex items-center">
            <input
              type="text"
              maxLength={8}
              placeholder="e.g. CF8WB8Y7"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              className={cn(
                "w-36 h-10 px-3 text-center font-mono font-bold text-[var(--accent)] bg-[var(--bg)] border border-[var(--border)] rounded",
                "focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-glow)] outline-none transition-all tracking-[0.2em]"
              )}
            />
          </div>
          <GlowButton type="submit" className="gap-1">
            JOIN
            <ArrowRight className="w-4 h-4" />
          </GlowButton>
        </form>
      </footer>

      {/* Auth Modal */}
      {authMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-8 max-w-sm w-full shadow-2xl relative">
            <button
              onClick={() => setAuthMode(null)}
              className="absolute top-4 right-4 text-[var(--text-dim)] hover:text-white transition-colors text-lg font-bold"
            >✕</button>

            <h2 className="text-2xl font-display font-bold mb-6 text-center text-[var(--text-primary)]">
              {authMode === 'login' ? 'Welcome Back' : authMode === 'register' ? 'Create Account' : authMode === 'forgot' ? 'Reset Password' : authMode === 'reset' ? 'Set New Password' : 'Verify Email'}
            </h2>

            {errorMsg && (
              <div className="bg-[var(--red)]/10 border border-[var(--red)]/50 text-[var(--red)] text-xs p-3 rounded mb-4 text-center">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {authMode === 'register' && (
                <div className="relative">
                  <User className="absolute left-3 top-3 w-4 h-4 text-[var(--text-dim)]" />
                  <input
                    required type="text" placeholder="Full Name"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg pl-10 pr-4 py-2.5 focus:border-[var(--accent)] outline-none transition-colors"
                  />
                </div>
              )}

              {(authMode === 'login' || authMode === 'register' || authMode === 'forgot') && (
                <>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 w-4 h-4 text-[var(--text-dim)]" />
                    <input
                      required type="email" placeholder="Email Address"
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      className="w-full bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg pl-10 pr-4 py-2.5 focus:border-[var(--accent)] outline-none transition-colors"
                    />
                  </div>
                  {(authMode === 'login' || authMode === 'register') && (
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-[var(--text-dim)]" />
                      <input
                        required type="password" placeholder="Password"
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg pl-10 pr-4 py-2.5 focus:border-[var(--accent)] outline-none transition-colors"
                      />
                    </div>
                  )}
                  {authMode === 'login' && (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => setAuthMode('forgot')} className="text-xs text-[var(--accent)] hover:underline">
                        Forgot Password?
                      </button>
                    </div>
                  )}
                </>
              )}

              {(authMode === 'verify' || authMode === 'reset') && (
                <div>
                  <input
                    required type="text" placeholder="Enter 6-digit OTP"
                    value={formData.otp}
                    onChange={e => setFormData({ ...formData, otp: e.target.value })}
                    className="w-full text-center tracking-[0.2em] font-mono font-bold text-[var(--accent)] bg-[var(--surface)] border border-[var(--border)] text-lg rounded-lg px-4 py-3 focus:border-[var(--accent)] outline-none transition-colors"
                  />
                  {authMode === 'reset' && (
                    <div className="relative mt-4">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-[var(--text-dim)]" />
                      <input
                        required type="password" placeholder="New Password"
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-[var(--surface)] border border-[var(--border)] text-sm rounded-lg pl-10 pr-4 py-2.5 focus:border-[var(--accent)] outline-none transition-colors"
                      />
                    </div>
                  )}
                  <p className="text-xs text-center text-[var(--text-dim)] mt-3">
                    A verification code was sent to <span className="text-[var(--accent)]">{formData.email}</span>
                  </p>
                  <p className="text-xs text-center text-[var(--text-dim)] mt-1">
                    Check your inbox — expires in 10 minutes
                  </p>
                </div>
              )}

              <GlowButton type="submit" size="full" loading={loading} className="mt-2">
                {authMode === 'login' ? 'Login' : authMode === 'register' ? 'Send OTP' : authMode === 'forgot' ? 'Send Reset Link' : authMode === 'reset' ? 'Reset Password' : 'Verify & Enter'}
              </GlowButton>
            </form>

            <div className="mt-6 text-center text-xs text-[var(--text-dim)]">
              {authMode === 'login' ? (
                <p>Don't have an account?
                  <button onClick={() => setAuthMode('register')} className="text-[var(--accent)] hover:underline ml-1">Sign Up</button>
                </p>
              ) : authMode === 'register' ? (
                <p>Already have an account?
                  <button onClick={() => setAuthMode('login')} className="text-[var(--accent)] hover:underline ml-1">Login</button>
                </p>
              ) : authMode === 'forgot' ? (
                <p>Remember your password?
                  <button onClick={() => setAuthMode('login')} className="text-[var(--accent)] hover:underline ml-1">Login</button>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}







