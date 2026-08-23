"use client"

import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { LayoutDashboard, Activity, Shield, Link2, Users, FileText, LogOut } from "lucide-react"
import { BrandMark, StatusBadge } from "@/components/ircp/shared"
import { cn, getBackendUrl } from "@/lib/utils"

const navItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/sessions", label: "Live Sessions", icon: Activity },
  { href: "/admin/alerts", label: "Anti-Cheat Alerts", icon: Shield },
  { href: "/admin/blockchain", label: "Blockchain Logs", icon: Link2 },
  { href: "/admin/users", label: "User Management", icon: Users },
  { href: "/admin/reports", label: "Reports", icon: FileText },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isLoginPage = pathname === "/admin/login"

  const [userName, setUserName] = useState("Admin")
  const [userInitials, setUserInitials] = useState("A")

  useEffect(() => {
    if (isLoginPage) return
    const user = localStorage.getItem('ircp_user')
    const role = localStorage.getItem('ircp_role')
    if (!user || role !== 'admin') { 
      router.push('/admin/login')
      return 
    }
    const name = localStorage.getItem('ircp_name') || localStorage.getItem('ircp_email') || "Admin"
    setUserName(name)
    setUserInitials(name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase())
  }, [router, pathname, isLoginPage])

  useEffect(() => {
    if (isLoginPage) return
    fetch(`${getBackendUrl()}/api/auth/me`, { 
      credentials: 'include',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('ircp_user') ? JSON.parse(localStorage.getItem('ircp_user')!).token : ''}`
      }
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          router.push('/admin/login')
        }
      })
      .catch(() => {})
  }, [router, isLoginPage])

  const handleLogout = async () => {
    try {
      await fetch(`${getBackendUrl()}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch {
      // Local cleanup still happens even if the backend is unreachable.
    }
    localStorage.removeItem('ircp_user')
    localStorage.removeItem('ircp_name')
    localStorage.removeItem('ircp_email')
    localStorage.removeItem('ircp_role')
    router.push('/admin/login')
  }

  if (isLoginPage) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] relative overflow-hidden flex font-sans text-[var(--text-primary)]">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[var(--accent)]/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[var(--violet)]/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Floating Glass Sidebar */}
      <aside className="w-[240px] m-4 rounded-2xl border border-[var(--border)]/60 bg-[var(--surface)]/30 backdrop-blur-xl flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.4)] z-10">
        {/* Logo */}
        <div className="p-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/20 border border-[var(--accent)]/30 flex items-center justify-center shadow-[0_0_15px_rgba(0,255,255,0.2)]">
              <BrandMark className="w-5 h-5 text-[var(--accent)] drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]" />
            </div>
            <div>
              <h1 className="font-display font-bold text-sm tracking-wide text-[var(--text-primary)]">Let&apos;s Collab!</h1>
              <p className="font-mono text-[9px] text-[var(--text-dim)] uppercase tracking-wider">Operations Console</p>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="p-4 border-b border-[var(--border)]">
          <StatusBadge status="live" label="System Online" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href))
            return (
              <button key={item.href} onClick={() => router.push(item.href)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-300",
                  isActive
                    ? "bg-[var(--accent)]/20 text-[var(--text-primary)] border border-[var(--accent)]/30 shadow-[0_0_10px_rgba(0,255,255,0.1)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)] hover:scale-[1.02]"
                )}>
                <Icon className={cn("w-4 h-4 transition-colors", isActive ? "text-[var(--accent)]" : "text-[var(--text-dim)]")} />
                <span className="font-medium">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-[var(--border)] bg-[var(--elevated)]/60 rounded-b-2xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--violet)] to-[var(--accent)] p-[1px]">
               <div className="w-full h-full rounded-full bg-[var(--bg)] flex items-center justify-center">
                 <span className="font-display font-bold text-xs text-[var(--text-primary)]">{userInitials}</span>
               </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{userName}</p>
              <p className="text-[10px] font-mono text-[var(--text-dim)]">Administrator</p>
            </div>
            <button onClick={handleLogout}
              className="p-2 rounded-lg text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors" title="Sign Out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 h-screen overflow-y-auto z-0 p-4 pl-0">
        <div className="w-full h-full rounded-2xl bg-[var(--surface)]/20 border border-[var(--border)]/60 backdrop-blur-md overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  )
}







