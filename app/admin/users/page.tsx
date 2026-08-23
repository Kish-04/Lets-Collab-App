"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { io, Socket } from "socket.io-client"
import { Search, X, Shield, ShieldOff, UserCheck, UserX, Clock } from "lucide-react"
import { DataCard, GlowButton, DangerButton } from "@/components/ircp/shared"
import { cn, getAuthHeaders, getBackendUrl, getStoredAuthToken } from "@/lib/utils"

type AppUser = {
  _id: string
  name: string
  email: string
  role: "user" | "admin"
  isVerified: boolean
  banned: boolean
  sessionCount: number
  lastSeen: string
  createdAt: string
  online: boolean
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (m < 1) return "Just now"
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  return `${d}d ago`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function UserDetailDrawer({
  user, onClose, onBan, onRoleChange,
}: {
  user: AppUser | null
  onClose: () => void
  onBan: (id: string) => void
  onRoleChange: (id: string, role: "user" | "admin") => void
}) {
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!user || !mounted) return null
  const initials = user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()

  return createPortal(
    <>
      <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
      <div className="fixed inset-0 bg-[var(--bg)]/90 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[420px] bg-[var(--surface)]/80 backdrop-blur-3xl border-l border-[var(--border)]/60 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] z-50 overflow-y-auto"
        style={{ animation: "slideInRight 0.2s ease-out" }}>

        <div className="flex items-center justify-between p-6 border-b border-[var(--border)]/60 bg-[var(--elevated)]/60">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-sm shadow-md",
              user.banned ? "bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/30" : "bg-[var(--accent)] text-black drop-shadow-[0_0_10px_rgba(0,255,255,0.5)]")}>
              {initials}
            </div>
            <div>
              <p className="font-display font-bold text-lg text-[var(--text-primary)] drop-shadow-md">{user.name}</p>
              <p className="text-xs text-[var(--text-dim)] font-mono">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 border-b border-[var(--border)]/60 bg-[var(--elevated)]/40">
          <div className="flex flex-wrap gap-2">
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border",
              user.online ? "bg-[var(--emerald)]/20 text-[var(--emerald)] border-[var(--emerald)]/30 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]" : "bg-[var(--elevated)] border-[var(--border)] text-[var(--text-dim)]")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", user.online ? "bg-[var(--emerald)] shadow-[0_0_5px_currentColor]" : "bg-[var(--text-dim)]")} />
              {user.online ? "ONLINE" : "OFFLINE"}
            </div>
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border",
              user.isVerified ? "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)]/30 drop-shadow-[0_0_5px_rgba(0,255,255,0.3)]" : "bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30")}>
              {user.isVerified ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
              {user.isVerified ? "VERIFIED" : "UNVERIFIED"}
            </div>
            <div className={cn("px-2.5 py-1 rounded-full text-xs font-mono border",
              user.role === "admin" ? "bg-[var(--violet)]/20 text-[var(--violet)] border-[var(--violet)]/30 drop-shadow-[0_0_5px_rgba(139,92,246,0.3)]" : "bg-[var(--elevated)] border-[var(--border)] text-[var(--text-dim)]")}>
              {user.role.toUpperCase()}
            </div>
            {user.banned && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/30 drop-shadow-[0_0_5px_rgba(244,63,94,0.3)]">
                <ShieldOff className="w-3 h-3" /> BLOCKED
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 p-6 border-b border-[var(--border)]/60 bg-[var(--elevated)]/40">
          <DataCard label="Sessions" value={user.sessionCount.toString()} color="accent" className="p-3" />
          <DataCard label="Joined" value={formatDate(user.createdAt)} className="p-3" />
          <DataCard label="Last Seen" value={formatRelative(user.lastSeen)} className="p-3" />
        </div>

        <div className="p-6 border-b border-[var(--border)]/60 bg-[var(--elevated)]/40">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-dim)] mb-4 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Session History
          </h3>
          {user.sessionCount === 0 ? (
            <p className="text-xs text-[var(--text-dim)] font-mono">No sessions recorded</p>
          ) : (
            <div className="p-3 bg-[var(--elevated)]/60 border border-[var(--border)] rounded-lg backdrop-blur-sm shadow-inner">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs text-[var(--accent)]">Total Sessions</span>
                <span className="font-mono text-xs text-[var(--text-secondary)]">{user.sessionCount}</span>
              </div>
              <p className="text-xs text-[var(--text-dim)]">Last active {formatRelative(user.lastSeen)}</p>
            </div>
          )}
        </div>

        <div className="p-6 border-b border-[var(--border)]/60 bg-[var(--elevated)]/40">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-dim)] mb-3">Role</h3>
          <div className="flex gap-2">
            {(["user", "admin"] as const).map(r => (
              <button key={r} onClick={() => onRoleChange(user._id, r)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-all border shadow-sm",
                  user.role === r
                    ? "bg-[var(--accent)] text-black border-[var(--accent)] drop-shadow-[0_0_10px_rgba(0,255,255,0.4)]"
                    : "bg-[var(--elevated)]/60 text-[var(--text-dim)] border-[var(--border)]/60 hover:border-[var(--border-bright)]/80 hover:text-[var(--text-primary)]"
                )}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 flex gap-3 bg-[var(--elevated)]/60">
          <GlowButton variant="ghost" className="flex-1 border-[var(--border)]/60" onClick={onClose}>Close</GlowButton>
          <DangerButton className="flex-1" onClick={() => onBan(user._id)}>
            {user.banned ? "Unblock User" : "Block User"}
          </DangerButton>
        </div>
      </div>
    </>,
    document.body
  )
}

export default function UsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<AppUser[]>([])
  const [selectedUser, setSelectedUser] = useState<AppUser | null>(null)
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "online" | "banned" | "unverified">("all")
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!getStoredAuthToken()) router.push('/admin/login')
  }, [router])

  useEffect(() => {
    const token = getStoredAuthToken()
    if (!token) return
    const socket = io(getBackendUrl(), { auth: { token }, withCredentials: true })
    socketRef.current = socket
    const email = localStorage.getItem('ircp_email')
    if (email) socket.emit('identify-user', email)
    return () => { socket.disconnect() }
  }, [])

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${getBackendUrl()}/api/admin/users`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        setUsers(data.users)
        setSelectedUser(prev => prev ? (data.users.find((u: AppUser) => u._id === prev._id) || null) : null)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
    const id = setInterval(fetchUsers, 10000)
    return () => clearInterval(id)
  }, [])

  const handleBan = async (id: string) => {
    await fetch(`${getBackendUrl()}/api/admin/users/${id}/ban`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
    })
    fetchUsers()
  }

  const handleRoleChange = async (id: string, role: "user" | "admin") => {
    await fetch(`${getBackendUrl()}/api/admin/users/${id}/role`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ role }),
    })
    fetchUsers()
  }

  const filtered = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === "all" ? true :
        filter === "online" ? u.online :
          filter === "banned" ? u.banned :
            filter === "unverified" ? !u.isVerified : true
    return matchSearch && matchFilter
  })

  const onlineCount = users.filter(u => u.online).length
  const bannedCount = users.filter(u => u.banned).length
  const verifiedCount = users.filter(u => u.isVerified).length
  const adminCount = users.filter(u => u.role === 'admin').length

  const filterTabs: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: users.length },
    { key: "online", label: "Online", count: onlineCount },
    { key: "banned", label: "Blocked", count: bannedCount },
    { key: "unverified", label: "Unverified", count: users.filter(u => !u.isVerified).length },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)] drop-shadow-md">Users</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-72 pl-10 pr-4 py-2 bg-[var(--elevated)]/80 border border-[var(--border)]/60 rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] outline-none backdrop-blur-sm transition-colors shadow-inner" />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <DataCard label="Total Users" value={users.length.toString()} />
        <DataCard label="Online Now" value={onlineCount.toString()} color="emerald" />
        <DataCard label="Verified" value={verifiedCount.toString()} color="accent" />
        <DataCard label="Admins" value={adminCount.toString()} color="violet" />
      </div>

      <div className="flex gap-1 mb-4 bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-xl p-1 w-fit shadow-[0_4px_16px_rgba(0,0,0,0.2)]">
        {filterTabs.map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={cn(
              "px-4 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-1.5",
              filter === tab.key
                ? "bg-[var(--accent)] text-black font-bold shadow-[0_0_10px_rgba(0,255,255,0.5)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)]"
            )}>
            {tab.label}
            <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] transition-colors",
              filter === tab.key ? "bg-[var(--elevated)]/80 text-black font-bold" : "bg-[var(--elevated)]/60 text-[var(--text-dim)] border border-[var(--border)]")}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        {loading ? (
          <div className="p-16 text-center text-[var(--text-dim)] font-mono text-sm">Loading users…</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-[var(--text-dim)] font-mono text-sm">
            {users.length === 0 ? "No users registered yet" : "No users match your search"}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]/60 bg-[var(--elevated)]/60">
                {["User", "Email", "Role", "Sessions", "Last Seen", "Status", ""].map(h => (
                  <th key={h} className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(user => (
                <tr key={user._id} onClick={() => setSelectedUser(user)}
                  className={cn(
                    "border-b border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--elevated)]",
                    user.banned && "opacity-50"
                  )}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-xs shadow-md border",
                          user.banned ? "bg-[var(--red)]/20 text-[var(--red)] border-[var(--red)]/30" : "bg-[var(--accent)] text-black border-transparent drop-shadow-[0_0_5px_rgba(0,255,255,0.5)]")}>
                          {user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        {user.online && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[var(--emerald)] border-2 border-[var(--surface)] shadow-[0_0_5px_rgba(16,185,129,0.8)]" />
                        )}
                      </div>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-[var(--text-secondary)]">{user.email}</td>
                  <td className="px-5 py-4">
                    <span className={cn("px-2.5 py-1 rounded-md font-mono text-[10px] border",
                      user.role === "admin"
                        ? "bg-[var(--violet)]/20 text-[var(--violet)] border-[var(--violet)]/30 drop-shadow-[0_0_5px_rgba(139,92,246,0.3)]"
                        : "bg-[var(--elevated)]/60 text-[var(--text-secondary)] border-[var(--border)]")}>
                      {user.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center font-mono text-sm text-[var(--text-secondary)]">{user.sessionCount}</td>
                  <td className="px-5 py-4 font-mono text-xs text-[var(--text-dim)]">{formatRelative(user.lastSeen)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      {user.banned && <span className="px-2 py-0.5 rounded-md text-[9px] font-mono bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/30 drop-shadow-[0_0_5px_rgba(244,63,94,0.3)]">BLOCKED</span>}
                      {!user.isVerified && <span className="px-2 py-0.5 rounded-md text-[9px] font-mono bg-[var(--amber)]/20 text-[var(--amber)] border border-[var(--amber)]/30 drop-shadow-[0_0_5px_rgba(251,191,36,0.3)]">UNVERIFIED</span>}
                      {user.isVerified && !user.banned && <span className="px-2 py-0.5 rounded-md text-[9px] font-mono bg-[var(--emerald)]/20 text-[var(--emerald)] border border-[var(--emerald)]/30 drop-shadow-[0_0_5px_rgba(16,185,129,0.3)]">ACTIVE</span>}
                    </div>
                  </td>
                  <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleBan(user._id)}
                      className={cn("p-2 rounded-lg transition-colors border",
                        user.banned
                          ? "text-[var(--emerald)] bg-[var(--emerald)]/10 hover:bg-[var(--emerald)]/20 border-[var(--emerald)]/20"
                          : "text-[var(--text-dim)] bg-[var(--elevated)]/60 border-[var(--border)] hover:text-[var(--red)] hover:bg-[var(--red)]/20 hover:border-[var(--red)]/30")}>
                      {user.banned ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UserDetailDrawer
        user={selectedUser}
        onClose={() => setSelectedUser(null)}
        onBan={handleBan}
        onRoleChange={handleRoleChange}
      />
    </div>
  )
}
