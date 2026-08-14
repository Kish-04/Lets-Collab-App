"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { io, Socket } from "socket.io-client"
import { Search } from "lucide-react"
import { cn, getAuthHeaders, getBackendUrl, getStoredAuthToken } from "@/lib/utils"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

type FilterType = "all" | "high" | "medium" | "low"

type Alert = {
  time: string
  roomId: string
  eventType: string
  message: string
  penalty: number
  totalRisk: number
}

const roomRiskTotals = new Map<string, number>()

function getRiskTotal(roomId: string, delta: number): number {
  const prev = roomRiskTotals.get(roomId) || 0
  const next = Math.min(100, prev + delta)
  roomRiskTotals.set(roomId, next)
  return next
}

function friendlyType(raw: string): string {
  const map: Record<string, string> = {
    NO_FACE: "No face detected",
    MULTIPLE_FACES: "Multiple faces",
    LOOKING_AWAY: "Looking away",
    PHONE_DETECTED: "Phone detected",
    BLURR_EVENT: "Alt+Tab / blur",
    CLIPBOARD_CHANGE: "Clipboard change",
    os_anticheat_violation: "OS event",
    anticheat_violation: "AI detection",
  }
  return map[raw] || raw
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour12: false })
  } catch { return dateStr }
}

export default function AlertsPage() {
  const router = useRouter()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [filter, setFilter] = useState<FilterType>("all")
  const [search, setSearch] = useState("")
  const [loaded, setLoaded] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const token = getStoredAuthToken()
    if (!token) router.push('/admin/login')
  }, [router])

  // ── Load historical alerts from MongoDB on mount ──────────────────────────
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/admin/reports`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        })
        const data = await res.json()
        if (data.success && data.alerts?.length) {
          const historical: Alert[] = data.alerts.map((a: any) => {
            const penalty = a.penalty || 0
            const totalRisk = getRiskTotal(a.room || 'SYSTEM', penalty)
            return {
              time: formatTime(a.time),
              roomId: a.room || 'SYSTEM',
              eventType: friendlyType(a.event || a.type || 'Unknown'),
              message: a.message || '',
              penalty,
              totalRisk,
            }
          })
          // alerts from API are newest-first already
          setAlerts(historical.slice(0, 200))
        }
      } catch (e) {
        console.error('Failed to load alert history', e)
      } finally {
        setLoaded(true)
      }
    }
    loadHistory()
  }, [])

  // ── Live alerts via socket ────────────────────────────────────────────────
  useEffect(() => {
    const token = getStoredAuthToken()
    if (!token) return
    const socket = io(getBackendUrl(), { auth: { token }, withCredentials: true })
    socketRef.current = socket

    socket.on('system-alert', (payload: any) => {
      const roomId = payload.room || 'SYSTEM'
      const penalty = payload.penalty || 0
      const totalRisk = getRiskTotal(roomId, penalty)
      const entry: Alert = {
        time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        roomId,
        eventType: friendlyType(payload.event || payload.type || 'Unknown'),
        message: payload.message || '',
        penalty,
        totalRisk,
      }
      setAlerts(prev => [entry, ...prev].slice(0, 200))
    })

    return () => { socket.disconnect() }
  }, [])

  const filtered = alerts.filter(a => {
    const matchSearch =
      a.roomId.toLowerCase().includes(search.toLowerCase()) ||
      a.eventType.toLowerCase().includes(search.toLowerCase()) ||
      a.message.toLowerCase().includes(search.toLowerCase())
    if (!matchSearch) return false
    if (filter === "high") return a.totalRisk >= 70
    if (filter === "medium") return a.totalRisk >= 30 && a.totalRisk < 70
    if (filter === "low") return a.totalRisk < 30
    return true
  })

  const typeCounts = alerts.reduce<Record<string, number>>((acc, a) => {
    acc[a.eventType] = (acc[a.eventType] || 0) + 1
    return acc
  }, {})
  const pieColors = ["var(--amber)", "var(--violet)", "var(--accent)", "var(--emerald)", "var(--red)"]
  const pieData = Object.entries(typeCounts).map(([name, value], i) => ({
    name, value, color: pieColors[i % pieColors.length]
  }))

  const topOffenders = Array.from(roomRiskTotals.entries())
    .map(([room, score]) => ({ room, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const highCount = alerts.filter(a => a.totalRisk >= 70).length
  const totalPenalty = alerts.reduce((s, a) => s + a.penalty, 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Anti-Cheat Alerts</h1>
        <div className="flex items-center gap-4 font-mono text-xs text-[var(--text-dim)]">
          <span>{alerts.length} total</span>
          <span className="text-[var(--red)]">{highCount} high-risk</span>
          <span className="text-[var(--amber)]">+{totalPenalty} total penalty</span>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left — Alert Table */}
        <div className="flex-[0.65]">
          <div className="bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-[var(--border)]/60 flex items-center gap-4 bg-[var(--elevated)]/60">
              <div className="flex gap-2">
                {(["all", "high", "medium", "low"] as FilterType[]).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-mono uppercase transition-all duration-300",
                      filter === f
                        ? f === "high" ? "bg-[var(--red)] text-[var(--text-primary)] shadow-[0_0_10px_rgba(244,63,94,0.5)]"
                          : f === "medium" ? "bg-[var(--amber)] text-black shadow-[0_0_10px_rgba(251,191,36,0.5)]"
                            : f === "low" ? "bg-[var(--emerald)] text-black shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                              : "bg-[var(--accent)] text-black shadow-[0_0_10px_rgba(0,255,255,0.5)]"
                        : "bg-[var(--elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)]/80"
                    )}>
                    {f}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search alerts…"
                  className="w-64 pl-10 pr-4 py-2 bg-[var(--elevated)]/80 border border-[var(--border)]/60 rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] outline-none backdrop-blur-sm transition-colors" />
              </div>
            </div>

            {!loaded ? (
              <div className="p-10 text-center text-[var(--text-dim)] font-mono text-sm">Loading alerts…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-[var(--text-dim)] font-mono text-sm">
                {alerts.length === 0 ? "No alerts yet — system is clean" : "No alerts match the current filter"}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]/60 bg-[var(--elevated)]/60">
                    {["Time", "Room", "Alert Type", "Message", "Delta", "Risk"].map(h => (
                      <th key={h} className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((alert, i) => (
                    <tr key={i}
                      className={cn(
                        "border-b border-[var(--border)] transition-colors hover:bg-[var(--elevated)]",
                        alert.totalRisk >= 70 && "border-l-4 border-l-[var(--red)]"
                      )}>
                      <td className="px-5 py-4 font-mono text-sm text-[var(--text-dim)]">{alert.time}</td>
                      <td className="px-5 py-4 font-mono text-sm text-[var(--accent)] font-semibold">
                        {alert.roomId.length >= 8
                          ? `${alert.roomId.slice(0, 4)}·${alert.roomId.slice(4, 8)}`
                          : alert.roomId}
                      </td>
                      <td className="px-5 py-4">
                        <span className="px-2 py-1 rounded-md bg-[var(--amber)]/10 border border-[var(--amber)]/20 text-[var(--amber)] text-xs font-mono drop-shadow-[0_0_5px_rgba(251,191,36,0.3)]">
                          {alert.eventType}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-[var(--text-primary)] truncate max-w-[160px]">{alert.message}</td>
                      <td className="px-5 py-4 font-mono text-sm text-[var(--red)] font-bold drop-shadow-[0_0_5px_rgba(244,63,94,0.5)]">+{alert.penalty}</td>
                      <td className="px-5 py-4">
                        <span className={cn("px-2.5 py-1 rounded-full font-mono text-xs border drop-shadow-md",
                          alert.totalRisk >= 70 ? "bg-[var(--red)]/20 text-[var(--red)] border-[var(--red)]/30"
                            : alert.totalRisk >= 30 ? "bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30"
                              : "bg-[var(--emerald)]/20 text-[var(--emerald)] border-[var(--emerald)]/30")}>
                          {alert.totalRisk}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right — Charts */}
        <div className="flex-[0.35] space-y-6">
          <div className="bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl p-6 hover:border-[var(--border-bright)] transition-colors">
            <h2 className="font-display font-bold text-lg text-[var(--text-primary)] mb-4">Alert Types</h2>
            {pieData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-[var(--text-dim)] font-mono text-sm">No data yet</div>
            ) : (
              <>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} cx="50%" cy="50%" outerRadius={70} dataKey="value">
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip itemStyle={{ color: 'var(--text-primary)' }} labelStyle={{ color: 'var(--text-primary)' }} contentStyle={{ backgroundColor: 'var(--surface)', backdropFilter: 'blur(12px)', borderColor: 'var(--border-bright)', borderRadius: '12px', color: 'var(--text-primary)', fontSize: "12px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap justify-center gap-3 mt-2">
                  {pieData.map(item => (
                    <div key={item.name} className="flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
                      <span className="w-2 h-2 rounded-full shadow-[0_0_5px_rgba(255,255,255,0.5)]" style={{ backgroundColor: item.color }} />
                      {item.name}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl p-6 hover:border-[var(--border-bright)] transition-colors">
            <h2 className="font-display font-bold text-lg text-[var(--text-primary)] mb-4">Highest Risk Rooms</h2>
            {topOffenders.length === 0 ? (
              <div className="text-center text-[var(--text-dim)] font-mono text-sm py-4">No data yet</div>
            ) : (
              <div className="space-y-4">
                {topOffenders.map((item, i) => {
                  const color = item.score >= 70 ? "var(--red)" : item.score >= 30 ? "var(--amber)" : "var(--emerald)"
                  return (
                    <div key={item.room} className="flex items-center gap-3">
                      <span className="text-sm text-[var(--text-dim)] w-4">{i + 1}.</span>
                      <span className="font-mono text-sm text-[var(--accent)] flex-shrink-0 drop-shadow-[0_0_5px_rgba(0,255,255,0.3)]">
                        {item.room.length >= 8 ? `${item.room.slice(0, 4)}·${item.room.slice(4, 8)}` : item.room}
                      </span>
                      <div className="flex-1 h-3 bg-[var(--bg)]/70 rounded-full overflow-hidden shadow-inner border border-[var(--border)]">
                        <div className="h-full rounded-full transition-all shadow-[0_0_10px_currentColor]" style={{ width: `${item.score}%`, backgroundColor: color }} />
                      </div>
                      <span className="font-mono text-sm w-8 text-right font-bold" style={{ color }}>{item.score}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
