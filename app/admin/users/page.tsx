"use client"

import { useState, useEffect, useRef } from "react"
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
  if (!user) return null
  const initials = user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()

  return (
    <>
      <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[420px] bg-[var(--surface)] border-l border-[var(--border)] z-50 overflow-y-auto"
        style={{ animation: "slideInRight 0.2s ease-out" }}>

        <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-display font-bold text-sm",
              user.banned ? "bg-[var(--red)]/20 text-[var(--red)]" : "bg-[var(--accent)] text-black")}>
              {initials}
            </div>
            <div>
              <p className="font-display font-bold text-lg text-[var(--text-primary)]">{user.name}</p>
              <p className="text-xs text-[var(--text-dim)] font-mono">{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 border-b border-[var(--border)]">
          <div className="flex flex-wrap gap-2">
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono",
              user.online ? "bg-[var(--emerald)]/10 text-[var(--emerald)]" : "bg-[var(--border)] text-[var(--text-dim)]")}>
              <span className={cn("w-1.5 h-1.5 rounded-full", user.online ? "bg-[var(--emerald)]" : "bg-[var(--text-dim)]")} />
              {user.online ? "ONLINE" : "OFFLINE"}
            </div>
            <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono",
              user.isVerified ? "bg-[var(--accent)]/10 text-[var(--accent)]" : "bg-[var(--amber)]/10 text-[var(--amber)]")}>
              {user.isVerified ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
              {user.isVerified ? "VERIFIED" : "UNVERIFIED"}
            </div>
            <div className={cn("px-2.5 py-1 rounded-full text-xs font-mono",
              user.role === "admin" ? "bg-[var(--violet)]/10 text-[var(--violet)]" : "bg-[var(--border)] text-[var(--text-dim)]")}>
              {user.role.toUpperCase()}
            </div>
            {user.banned && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono bg-[var(--red)]/10 text-[var(--red)]">
                <ShieldOff className="w-3 h-3" /> BANNED
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 p-6 border-b border-[var(--border)]">
          <DataCard label="Sessions" value={user.sessionCount.toString()} color="accent" className="p-3" />
          <DataCard label="Joined" value={formatDate(user.createdAt)} className="p-3" />
          <DataCard label="Last Seen" value={formatRelative(user.lastSeen)} className="p-3" />
        </div>

        <div className="p-6 border-b border-[var(--border)]">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-dim)] mb-4 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" /> Session History
          </h3>
          {user.sessionCount === 0 ? (
            <p className="text-xs text-[var(--text-dim)] font-mono">No sessions recorded</p>
          ) : (
            <div className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs text-[var(--accent)]">Total Sessions</span>
                <span className="font-mono text-xs text-[var(--text-secondary)]">{user.sessionCount}</span>
              </div>
              <p className="text-xs text-[var(--text-dim)]">Last active {formatRelative(user.lastSeen)}</p>
            </div>
          )}
        </div>

        <div className="p-6 border-b border-[var(--border)]">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-dim)] mb-3">Role</h3>
          <div className="flex gap-2">
            {(["user", "admin"] as const).map(r => (
              <button key={r} onClick={() => onRoleChange(user._id, r)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-mono font-bold transition-colors border",
                  user.role === r
                    ? "bg-[var(--accent)] text-black border-[var(--accent)]"
                    : "bg-transparent text-[var(--text-dim)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                )}>
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 flex gap-3">
          <GlowButton variant="ghost" className="flex-1" onClick={onClose}>Close</GlowButton>
          <DangerButton className="flex-1" onClick={() => onBan(user._id)}>
            {user.banned ? "Unban User" : "Ban User"}
          </DangerButton>
        </div>
      </div>
    </>
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
    { key: "banned", label: "Banned", count: bannedCount },
    { key: "unverified", label: "Unverified", count: users.filter(u => !u.isVerified).length },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Users</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-72 pl-10 pr-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] outline-none" />
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <DataCard label="Total Users" value={users.length.toString()} />
        <DataCard label="Online Now" value={onlineCount.toString()} color="emerald" />
        <DataCard label="Verified" value={verifiedCount.toString()} color="accent" />
        <DataCard label="Admins" value={adminCount.toString()} color="violet" />
      </div>

      <div className="flex gap-1 mb-4 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-1 w-fit">
        {filterTabs.map(tab => (
          <button key={tab.key} onClick={() => setFilter(tab.key)}
            className={cn(
              "px-4 py-1.5 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5",
              filter === tab.key
                ? "bg-[var(--accent)] text-black font-bold"
                : "text-[var(--text-dim)] hover:text-[var(--text-primary)]"
            )}>
            {tab.label}
            <span className={cn("px-1.5 py-0.5 rounded-full text-[10px]",
              filter === tab.key ? "bg-black/20" : "bg-[var(--elevated)]")}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-[var(--text-dim)] font-mono text-sm">Loading users…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[var(--text-dim)] font-mono text-sm">
            {users.length === 0 ? "No users registered yet" : "No users match your search"}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["User", "Email", "Role", "Sessions", "Last Seen", "Status", ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{h}</th>
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-xs",
                          user.banned ? "bg-[var(--red)]/20 text-[var(--red)]" : "bg-[var(--accent)] text-black")}>
                          {user.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                        </div>
                        {user.online && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--emerald)] border-2 border-[var(--surface)]" />
                        )}
                      </div>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full font-mono text-[10px]",
                      user.role === "admin"
                        ? "bg-[var(--violet)]/10 text-[var(--violet)]"
                        : "bg-[var(--border)] text-[var(--text-dim)]")}>
                      {user.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-sm text-[var(--text-secondary)]">{user.sessionCount}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-dim)]">{formatRelative(user.lastSeen)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {user.banned && <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--red)]/10 text-[var(--red)]">BANNED</span>}
                      {!user.isVerified && <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--amber)]/10 text-[var(--amber)]">UNVERIFIED</span>}
                      {user.isVerified && !user.banned && <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--emerald)]/10 text-[var(--emerald)]">ACTIVE</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleBan(user._id)}
                      className={cn("p-1.5 rounded transition-colors",
                        user.banned
                          ? "text-[var(--emerald)] hover:bg-[var(--emerald)]/10"
                          : "text-[var(--text-dim)] hover:text-[var(--red)] hover:bg-[var(--red)]/10")}>
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







