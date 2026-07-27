"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Key, ShieldCheck, User } from "lucide-react"
import { AppLogo, GlowButton } from "@/components/ircp/shared"
import { getBackendUrl } from "@/lib/utils"

export default function AdminLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const [otpRequired, setOtpRequired] = useState(false)
  const [otp, setOtp] = useState("")

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setErrorMsg("")
    try {
      const endpoint = otpRequired ? '/api/auth/verify-otp' : '/api/auth/login'
      const response = await fetch(`${getBackendUrl()}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: username, password, otp: otpRequired ? otp : undefined }),
      })
      const data = await response.json()
      if (response.ok) {
        if (data.otpRequired) {
          setOtpRequired(true)
          setErrorMsg("OTP sent to your email. Please enter it below.")
          setLoading(false)
          return
        }

        const role = data.user?.role || data.role
        if (role === "admin") {
          const user = data.user || data
          localStorage.setItem("ircp_user", JSON.stringify(user))
          localStorage.setItem("ircp_name", user.name || "Administrator")
          localStorage.setItem("ircp_email", user.email || "admin")
          localStorage.setItem("ircp_role", "admin")
          router.push("/admin")
        } else {
          setErrorMsg("Administrator privileges are required.")
        }
      } else {
        setErrorMsg(data.message || "Administrator privileges are required.")
      }
    } catch {
      setErrorMsg("Unable to connect to the authentication service.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bg)] p-6">
      <div className="absolute left-0 top-0 h-96 w-96 rounded-full bg-[var(--accent)]/10 blur-3xl" />
      <button onClick={() => router.push("/")} className="absolute left-6 top-6 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="h-4 w-4" /> Back to home
      </button>
      <main className="relative grid w-full max-w-4xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl md:grid-cols-[1fr_420px]">
        <section className="hidden flex-col justify-between border-r border-[var(--border)] p-10 md:flex">
          <AppLogo size="default" />
          <div>
            <ShieldCheck className="mb-5 h-10 w-10 text-[var(--accent)]" />
            <h1 className="font-display text-3xl font-bold text-[var(--text-primary)]">Operations Console</h1>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">
              Supervise rooms visibly, review activity, and intervene with an accountable audit trail.
            </p>
          </div>
          <p className="text-xs text-[var(--text-dim)]">Work together. Stay in control.</p>
        </section>
        <section className="p-8 sm:p-10">
          <div className="mb-8 md:hidden"><AppLogo size="small" /></div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">Administrator Sign In</p>
          <h2 className="mt-2 font-display text-2xl font-bold text-[var(--text-primary)]">Welcome back</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Use an administrator account to continue.</p>
          {errorMsg && <div className="mt-6 rounded-lg border border-[var(--red)]/30 bg-[var(--red)]/10 px-4 py-3 text-sm text-[var(--red)]">{errorMsg}</div>}
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs text-[var(--text-secondary)]">Administrator ID</span>
              <span className="relative block">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-dim)]" />
                <input required value={username} onChange={event => setUsername(event.target.value)} autoComplete="username"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs text-[var(--text-secondary)]">Password</span>
              <span className="relative block">
                <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-dim)]" />
                <input required={!otpRequired} type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password"
                  disabled={otpRequired}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] py-3 pl-10 pr-4 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50" />
              </span>
            </label>
            
            {otpRequired && (
              <label className="block animate-in fade-in slide-in-from-top-2 duration-300">
                <span className="mb-2 block text-xs text-[var(--emerald)] font-bold tracking-widest uppercase">One-Time Passcode</span>
                <span className="relative block">
                  <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--emerald)]" />
                  <input required autoFocus type="text" value={otp} onChange={event => setOtp(event.target.value)} placeholder="6-digit code"
                    className="w-full rounded-lg border border-[var(--emerald)]/50 bg-[var(--emerald)]/5 py-3 pl-10 pr-4 text-sm text-[var(--emerald)] placeholder-[var(--emerald)]/30 outline-none focus:border-[var(--emerald)] font-mono tracking-widest" />
                </span>
              </label>
            )}

            <GlowButton type="submit" size="full" loading={loading} className="mt-3">
              {otpRequired ? "Verify & Enter Console" : "Enter Console"}
            </GlowButton>
          </form>
        </section>
      </main>
    </div>
  )
}







