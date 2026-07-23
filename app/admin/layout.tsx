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
    <div className="min-h-screen bg-[var(--bg)] flex">
      <aside className="w-[220px] border-r border-[var(--border)] flex flex-col bg-[var(--surface)]">
        {/* Logo */}
        <div className="p-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)] flex items-center justify-center">
              <BrandMark className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-display font-bold text-sm text-[var(--text-primary)]">Let&apos;s Collab!</h1>
              <p className="font-mono text-[9px] text-[var(--text-dim)]">Operations Console</p>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="p-4 border-b border-[var(--border)]">
          <StatusBadge status="live" label="System Online" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href))
            return (
              <button key={item.href} onClick={() => router.push(item.href)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all",
                  isActive
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)]"
                )}>
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--violet)] flex items-center justify-center shrink-0">
              <span className="font-display font-bold text-xs text-white">{userInitials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{userName}</p>
              <p className="text-[10px] font-mono text-[var(--text-dim)]">Admin</p>
            </div>
            <button onClick={handleLogout}
              className="p-1.5 text-[var(--text-dim)] hover:text-[var(--red)] transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}







