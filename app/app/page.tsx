"use client"

import React, { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence, useSpring } from "framer-motion"
import { Monitor, Gamepad2, LayoutDashboard, ArrowRight, User, Lock, Mail, ShieldAlert, Activity, Sparkles, Network, Download } from "lucide-react"
import { io, Socket } from "socket.io-client"
import emailjs from "@emailjs/browser"
import { AppLogo, StatusBadge, GlowButton, PermissionTag, LiveDot } from "@/components/ircp/shared"
import { cn, getBackendUrl } from "@/lib/utils"

// --- 3D Tilt Card Component ---
const TiltCard = ({ children, className }: { children: React.ReactNode, className?: string }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [rotateX, setRotateX] = useState(0)
  const [rotateY, setRotateY] = useState(0)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const width = rect.width
    const height = rect.height
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const xPct = mouseX / width - 0.5
    const yPct = mouseY / height - 0.5
    setRotateX(yPct * -10) // subtle 10deg max rotation
    setRotateY(xPct * 10)
  }

  const handleMouseLeave = () => {
    setRotateX(0)
    setRotateY(0)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ rotateX, rotateY }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      style={{ perspective: 1200, transformStyle: "preserve-3d" }}
      className={className}
    >
      <div style={{ transform: "translateZ(20px)" }} className="w-full h-full">
        {children}
      </div>
    </motion.div>
  )
}

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
    description: "Work together with host-approved screen observation and precise access control.",
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
    bg: "from-[var(--accent)]/20 to-transparent",
    glow: "group-hover:shadow-[0_0_40px_rgba(0,212,255,0.2)]"
  },
  violet: {
    border: "border-l-[var(--violet)]",
    text: "text-[var(--violet)]",
    bg: "from-[var(--violet)]/20 to-transparent",
    glow: "group-hover:shadow-[0_0_40px_rgba(138,43,226,0.2)]"
  },
  amber: {
    border: "border-l-[var(--amber)]",
    text: "text-[var(--amber)]",
    bg: "from-[var(--amber)]/20 to-transparent",
    glow: "group-hover:shadow-[0_0_40px_rgba(255,191,0,0.2)]"
  },
  blue: {
    border: "border-l-[#2f7df6]",
    text: "text-[#2f7df6]",
    bg: "from-[#2f7df6]/20 to-transparent",
    glow: "group-hover:shadow-[0_0_40px_rgba(47,125,246,0.2)]"
  },
  emerald: {
    border: "border-l-[var(--emerald)]",
    text: "text-[var(--emerald)]",
    bg: "from-[var(--emerald)]/20 to-transparent",
    glow: "group-hover:shadow-[0_0_40px_rgba(46,204,113,0.2)]"
  }
}

// Stagger variants for the page load
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.1 }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, damping: 20 } }
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
  const [isDesktop, setIsDesktop] = useState(false)

  const [activeSessions, setActiveSessions] = useState(0)
  const [latency, setLatency] = useState(0)
  const pingTsRef = useRef<number>(0)

  useEffect(() => {
    setIsAuth(!!localStorage.getItem('ircp_user'))
    if (navigator.userAgent.toLowerCase().includes('electron')) {
      setIsDesktop(true)
    }
    
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
      if (role === 'admin') router.push(href)
      else router.push('/admin/login')
      return
    }

    if (isAuth) router.push(href)
    else setAuthMode("login")
  }

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isAuth) { setAuthMode("login"); return }
    if (roomId.trim()) router.push(`/session?room=${roomId.toUpperCase()}`)
  }

  const sendOTPEmailJS = async (toEmail: string, otp: string, toName: string = 'User') => {
    try {
      const templateParams = { to_name: toName, to_email: toEmail, passcode: otp }
      const serviceId = process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID || 'service_vlnxzdl'
      const templateId = process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID || 'template_ogznez9'
      const publicKey = process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY || 'tQS6xbi2oi4XC64JV'
      await emailjs.send(serviceId, templateId, templateParams, publicKey)
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
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ name: formData.name, email: formData.email, password: formData.password })
        })
        const data = await res.json()
        if (res.ok) {
          if (data.otp) await sendOTPEmailJS(formData.email, data.otp, formData.name)
          setAuthMode("verify")
        } else setErrorMsg(data.message || "Registration failed")
      }
      else if (authMode === "verify") {
        const res = await fetch(`${getBackendUrl()}/api/auth/verify-otp`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ email: formData.email, otp: formData.otp })
        })
        const data = await res.json()
        if (res.ok) {
          localStorage.setItem('ircp_user', JSON.stringify(data))
          localStorage.setItem('ircp_name', data.name || formData.email)
          localStorage.setItem('ircp_email', formData.email)
          setIsAuth(true)
          setAuthMode(null)
        } else setErrorMsg(data.message || "Verification failed")
      }
      else if (authMode === "login") {
        const res = await fetch(`${getBackendUrl()}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
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
          } else {
            await sendOTPEmailJS(formData.email, data.otp, data.name || 'User')
            setAuthMode("verify")
          }
        } else setErrorMsg(data.message || "Login failed")
      }
      else if (authMode === "forgot") {
        const res = await fetch(`${getBackendUrl()}/api/auth/forgot-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ email: formData.email })
        })
        const data = await res.json()
        if (res.ok) {
          if (data.otp) await sendOTPEmailJS(formData.email, data.otp, 'User')
          setAuthMode("reset")
        } else setErrorMsg(data.message || "Failed to send reset link")
      }
      else if (authMode === "reset") {
        const res = await fetch(`${getBackendUrl()}/api/auth/reset-password`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ email: formData.email, otp: formData.otp, newPassword: formData.password })
        })
        const data = await res.json()
        if (res.ok) {
          setAuthMode("login")
          setFormData({ ...formData, password: "", otp: "" })
        } else setErrorMsg(data.message || "Reset failed")
      }
    } catch (err: any) {
      setErrorMsg("Network error. Ensure the server is running.")
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    try { await fetch(`${getBackendUrl()}/api/auth/logout`, { method: 'POST', credentials: 'include' }) } catch (e) {}
    localStorage.removeItem('ircp_user')
    setIsAuth(false)
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] selection:bg-[var(--accent)] selection:text-black flex flex-col relative overflow-hidden">
      
      {/* Background Mesh */}
      <div className="fixed inset-0 z-0 bg-[url('/grid.svg')] bg-center opacity-[0.05] pointer-events-none" />
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <motion.div 
          animate={{ rotate: 360, scale: [1, 1.1, 1] }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          className="absolute -top-[30%] -right-[10%] w-[60vw] h-[60vw] bg-[var(--accent)]/5 rounded-full blur-[120px]"
        />
        <motion.div 
          animate={{ rotate: -360, scale: [1, 1.2, 1] }}
          transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
          className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] bg-[var(--violet)]/5 rounded-full blur-[150px]"
        />
      </div>

      <header className="relative z-10 flex items-center justify-between px-10 py-6 border-b border-[var(--border)] bg-[var(--bg)]/60 backdrop-blur-xl">
        <AppLogo size="default" />
        <div className="flex items-center gap-6">
          <span className="hidden text-xs font-bold tracking-[0.2em] text-[var(--text-dim)] uppercase sm:block">Permission-First Engine</span>
          {!isDesktop && (
            <motion.a 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              href="/downloads/Lets-Collab-Cloud-Setup.exe" 
              download 
              className="hidden sm:flex items-center gap-2 px-5 py-2.5 bg-[var(--text-primary)] text-[var(--bg)] font-bold rounded-full shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all text-sm"
            >
              <Download className="w-4 h-4" />
              Download App
            </motion.a>
          )}
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        
        {/* Left — Hero */}
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="flex-[0.55] p-12 lg:p-20 flex flex-col justify-center"
        >
          <motion.div variants={itemVariants}>
            <StatusBadge status="live" label="Protocol Online" className="mb-8 w-fit bg-[var(--emerald)]/10 border-[var(--emerald)]/20 text-[var(--emerald)] font-bold tracking-widest uppercase text-xs px-4 py-1.5" />
          </motion.div>

          <motion.h1 variants={itemVariants} className="font-display font-black text-6xl lg:text-[5.5rem] leading-[0.9] text-[var(--text-primary)] mb-8 tracking-tighter">
            Control your <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--accent)] to-[var(--violet)]">
              Workspace.
            </span>
          </motion.h1>

          <motion.p variants={itemVariants} className="text-xl text-[var(--text-secondary)] max-w-lg leading-relaxed mb-12 font-light">
            Create a collaborative room or a visibly supervised session. Access begins view-only, and every intervention is explicit and verified.
          </motion.p>

          <motion.div variants={itemVariants} className="flex flex-wrap gap-4">
            <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-full bg-[var(--surface)] border border-[var(--border)] font-mono text-xs font-bold text-[var(--text-secondary)] backdrop-blur-md">
              {activeSessions > 0 ? <LiveDot color="emerald" /> : <div className="w-2 h-2 rounded-full bg-[var(--text-dim)]" />}
              {activeSessions} Active Nodes
            </div>
            <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-full bg-[var(--surface)] border border-[var(--border)] font-mono text-xs font-bold text-[var(--text-secondary)] backdrop-blur-md">
              <Network className="w-3.5 h-3.5 text-[#2f7df6]" />
              {latency === 0 ? "—ms" : `${latency}ms`} Latency
            </div>
          </motion.div>
        </motion.div>

        {/* Right — Role Cards */}
        <div className="flex-[0.45] p-8 lg:p-16 flex flex-col justify-center relative">
          
          {/* Auth strip */}
          <div className="absolute top-8 right-8 z-20">
            {isAuth ? (
              <div className="flex items-center gap-6 bg-[var(--surface)]/80 border border-[var(--border)] px-5 py-2.5 rounded-full backdrop-blur-md">
                <span className="text-sm font-bold tracking-wider text-[var(--emerald)] flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[var(--emerald)] animate-pulse" /> Verified
                </span>
                <button onClick={handleLogout} className="text-xs font-bold tracking-widest uppercase text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors">
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-4 bg-[var(--surface)]/80 border border-[var(--border)] px-2 py-2 rounded-full backdrop-blur-md">
                <button onClick={() => setAuthMode('login')} className="px-4 text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">Login</button>
                <button onClick={() => setAuthMode('register')} className="px-5 py-2 bg-[var(--text-primary)] text-[var(--bg)] text-sm font-bold rounded-full hover:bg-[var(--accent)] hover:text-black transition-colors">
                  Sign Up
                </button>
              </div>
            )}
          </div>

          <motion.div 
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-5 mt-16 lg:mt-0 relative z-10"
          >
            {!isAuth && (
              <motion.div variants={itemVariants} className="bg-[var(--amber)]/10 border border-[var(--amber)]/30 rounded-[var(--app-radius)] p-5 mb-2 flex items-center gap-4 backdrop-blur-md">
                <Lock className="w-6 h-6 text-[var(--amber)]" />
                <p className="text-sm font-medium text-[var(--amber)]">Authentication required. Please login or register to initialize sessions.</p>
              </motion.div>
            )}

            {roles.map((role) => (
              <TiltCard key={role.id} className={!isAuth ? "opacity-40 grayscale pointer-events-none" : ""}>
                <button
                  onClick={() => handleRoleClick(role.href)}
                  className={cn(
                    "group relative w-full text-left p-8 bg-[rgba(var(--surface-rgb),var(--surface-alpha))] backdrop-blur-xl border border-[var(--border)] border-l-[4px] rounded-[var(--app-radius)] overflow-hidden",
                    "transition-all duration-300 hover:-translate-y-2 hover:border-[var(--border-bright)]",
                    colorStyles[role.color].border,
                    colorStyles[role.color].glow
                  )}
                >
                  {/* Hover Gradient Background */}
                  <div className={cn("absolute inset-0 bg-gradient-to-r opacity-0 group-hover:opacity-10 transition-opacity duration-500", colorStyles[role.color].bg)} />
                  
                  <div className="flex items-start justify-between relative z-10">
                    <div className="flex items-start gap-6">
                      <div className={cn("p-4 rounded-[var(--app-radius)] bg-[var(--bg)]/50 border border-[var(--border)]", colorStyles[role.color].text)}>
                        {role.icon}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-display font-black text-2xl text-[var(--text-primary)] mb-2">{role.title}</h3>
                        <p className="text-[var(--text-secondary)] mb-4 leading-relaxed font-light">{role.description}</p>
                        <div className="flex flex-wrap gap-2">
                          {role.tags.map((tag) => (
                            <span key={tag} className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)] bg-[var(--elevated)] border border-[var(--border)] rounded-md">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-[var(--elevated)] flex items-center justify-center group-hover:bg-[var(--text-primary)] group-hover:text-[var(--bg)] transition-colors shrink-0">
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </div>
                </button>
              </TiltCard>
            ))}
          </motion.div>
        </div>
      </main>

      {/* Floating Action Bar — Room Join */}
      <motion.div 
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1, type: "spring", damping: 20 }}
        className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40"
      >
        <form 
          onSubmit={handleJoinRoom} 
          className="flex items-center gap-3 bg-[rgba(var(--surface-rgb),var(--surface-alpha))] backdrop-blur-2xl border border-[var(--border)] p-3 rounded-full shadow-[0_10px_40px_var(--accent-glow)] group focus-within:border-[var(--accent)] focus-within:shadow-[0_0_30px_var(--accent-glow)] transition-all duration-500"
        >
          <div className="pl-6 pr-2 py-2 flex items-center gap-4">
            <span className="font-bold text-xs uppercase tracking-widest text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors">
              Join Room
            </span>
            <div className="w-px h-6 bg-[var(--border)]" />
            <input
              type="text"
              maxLength={8}
              placeholder="e.g. CF8WB8Y7"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              className="w-32 bg-transparent font-mono font-black text-lg text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none tracking-widest"
            />
          </div>
          <button type="submit" className="w-12 h-12 rounded-full bg-[var(--accent)] text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform">
            <ArrowRight className="w-5 h-5 font-bold" />
          </button>
        </form>
      </motion.div>

      {/* Glassmorphic Auth Modal */}
      <AnimatePresence>
        {authMode && (
          <motion.div 
            initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
            animate={{ opacity: 1, backdropFilter: "blur(20px)" }}
            exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: -20, opacity: 0 }}
              transition={{ type: "spring", damping: 25 }}
              className="bg-[rgba(var(--surface-rgb),var(--surface-alpha))] border border-[var(--border)] rounded-[var(--app-radius)] p-10 max-w-md w-full shadow-[0_0_50px_var(--accent-glow)] relative overflow-hidden backdrop-blur-3xl"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[var(--accent)] to-[var(--violet)]" />
              
              <button
                onClick={() => setAuthMode(null)}
                className="absolute top-6 right-6 w-8 h-8 rounded-full bg-[var(--bg)] flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)] transition-colors"
              >✕</button>

              <div className="mb-8 text-center">
                <div className="w-16 h-16 rounded-full bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-8 h-8 text-[var(--accent)]" />
                </div>
                <h2 className="text-3xl font-black text-[var(--text-primary)]">
                  {authMode === 'login' ? 'Welcome Back' : authMode === 'register' ? 'Create Account' : authMode === 'forgot' ? 'Reset Password' : authMode === 'reset' ? 'Set New Password' : 'Verify Email'}
                </h2>
              </div>

              {errorMsg && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-[var(--red)]/10 border border-[var(--red)]/30 text-[var(--red)] text-sm font-bold p-4 rounded-[var(--app-radius)] mb-6 text-center">
                  {errorMsg}
                </motion.div>
              )}

              <form onSubmit={handleAuthSubmit} className="space-y-5">
                {authMode === 'register' && (
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors" />
                    <input
                      required type="text" placeholder="Full Name"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-[rgba(var(--surface-rgb),0.5)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-[var(--app-radius)] pl-12 pr-4 py-4 focus:border-[var(--accent)] outline-none transition-all focus:bg-[rgba(var(--surface-rgb),0.8)]"
                    />
                  </div>
                )}

                {(authMode === 'login' || authMode === 'register' || authMode === 'forgot') && (
                  <>
                    <div className="relative group">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors" />
                      <input
                        required type="email" placeholder="Email Address"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-[rgba(var(--surface-rgb),0.5)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-[var(--app-radius)] pl-12 pr-4 py-4 focus:border-[var(--accent)] outline-none transition-all focus:bg-[rgba(var(--surface-rgb),0.8)]"
                      />
                    </div>
                    {(authMode === 'login' || authMode === 'register') && (
                      <div className="relative group">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors" />
                        <input
                        required type="password" placeholder="Password"
                        value={formData.password}
                        onChange={e => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-[rgba(var(--surface-rgb),0.5)] border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-[var(--app-radius)] pl-12 pr-4 py-4 focus:border-[var(--accent)] outline-none transition-all focus:bg-[rgba(var(--surface-rgb),0.8)]"
                      />
                      </div>
                    )}
                    {authMode === 'login' && (
                      <div className="flex justify-end pt-1">
                        <button type="button" onClick={() => setAuthMode('forgot')} className="text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                          Forgot Password?
                        </button>
                      </div>
                    )}
                  </>
                )}

                {(authMode === 'verify' || authMode === 'reset') && (
                  <div className="space-y-4">
                    <input
                      required type="text" placeholder="Enter 6-digit OTP"
                      value={formData.otp}
                      onChange={e => setFormData({ ...formData, otp: e.target.value })}
                      className="w-full text-center tracking-[0.5em] font-mono font-black text-2xl text-[var(--accent)] bg-[var(--bg)]/50 border border-[var(--border)] rounded-xl px-4 py-4 focus:border-[var(--accent)] outline-none transition-all"
                    />
                    {authMode === 'reset' && (
                      <div className="relative group">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-dim)] group-focus-within:text-[var(--accent)] transition-colors" />
                        <input
                          required type="password" placeholder="New Password"
                          value={formData.password}
                          onChange={e => setFormData({ ...formData, password: e.target.value })}
                          className="w-full bg-[var(--bg)]/50 border border-[var(--border)] text-[var(--text-primary)] font-medium rounded-xl pl-12 pr-4 py-4 focus:border-[var(--accent)] outline-none transition-all focus:bg-[var(--elevated)]"
                        />
                      </div>
                    )}
                    <div className="text-center bg-[var(--elevated)] rounded-xl p-4 border border-[var(--border)]">
                      <p className="text-sm font-bold text-[var(--text-primary)] mb-1">
                        Code sent to <span className="text-[var(--accent)]">{formData.email}</span>
                      </p>
                      <p className="text-xs text-[var(--text-dim)]">Expires in 10 minutes</p>
                    </div>
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full py-4 bg-[var(--text-primary)] text-[var(--bg)] font-black text-lg rounded-xl hover:bg-[var(--accent)] hover:text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_var(--accent-glow)]"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> Processing
                    </span>
                  ) : authMode === 'login' ? 'Login to Dashboard' : authMode === 'register' ? 'Create Account' : authMode === 'forgot' ? 'Send Reset Link' : authMode === 'reset' ? 'Reset Password' : 'Verify & Enter'}
                </button>
              </form>

              <div className="mt-8 text-center text-sm font-bold text-[var(--text-dim)]">
                {authMode === 'login' ? (
                  <p>Don't have an account? <button onClick={() => setAuthMode('register')} className="text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors ml-2">Sign Up</button></p>
                ) : authMode === 'register' ? (
                  <p>Already have an account? <button onClick={() => setAuthMode('login')} className="text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors ml-2">Login</button></p>
                ) : authMode === 'forgot' ? (
                  <p>Remember your password? <button onClick={() => setAuthMode('login')} className="text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors ml-2">Login</button></p>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
