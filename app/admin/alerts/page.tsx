"use client"

import { useState, useEffect } from "react"
import { createPortal } from "react-dom"
import { useAdminReports, useAdminSocket, useLiveSessions, useSocketEvent } from "@/components/admin/AdminData"
import { Search, ShieldAlert, AlertTriangle, Download, CheckCircle, Flag, X } from "lucide-react"
import { cn, getAuthHeaders, getBackendUrl } from "@/lib/utils"
import { PROCTORING_RULES } from "@/lib/proctoringPolicy"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

type FilterType = "all" | "high" | "medium" | "low"

type Alert = {
  _id: string
  time: string
  roomId: string
  eventType: string
  message: string
  penalty: number
  totalRisk: number
  flagged: boolean
  falsePositive: boolean
  evidenceUrl?: string
  // Arrived live and was not stored by the server (database offline): kept across report refreshes
  liveOnly?: boolean
}

// Running risk per room, oldest alert first, capped at 100 (the list itself is newest first)
function withRiskTotals(newestFirst: Alert[]): Alert[] {
  const totals = new Map<string, number>()
  const oldestFirst = [...newestFirst].reverse().map(alert => {
    const total = Math.min(100, (totals.get(alert.roomId) || 0) + alert.penalty)
    totals.set(alert.roomId, total)
    return { ...alert, totalRisk: total }
  })
  return oldestFirst.reverse()
}

function friendlyType(raw: string): string {
  const map: Record<string, string> = {
    BLURR_EVENT: "Alt+Tab / blur",
    CLIPBOARD_CHANGE: "Clipboard change",
    os_anticheat_violation: "OS event",
    anticheat_violation: "AI detection",
  }
  // Every proctoring kind has a plain host-facing label (e.g. "Camera blocked or covered")
  return map[raw] || PROCTORING_RULES[raw]?.label || raw
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour12: false })
  } catch { return dateStr }
}

function AlertDetailsModal({
  alert, onClose, onFlag, onFalsePositive, onWarnUser, onKillSession
}: {
  alert: Alert | null
  onClose: () => void
  onFlag: (id: string, flagged: boolean) => void
  onFalsePositive: (id: string, fp: boolean) => void
  onWarnUser: (roomId: string) => void
  onKillSession: (roomId: string) => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!alert || !mounted) return null

  return createPortal(
    <>
      <style>{`@keyframes slideInUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div className="fixed inset-0 bg-[var(--bg)]/90 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] max-h-[85vh] bg-[var(--surface)]/90 border border-[var(--border)]/60 shadow-[0_0_50px_rgba(0,0,0,0.5)] z-50 rounded-2xl overflow-y-auto"
        style={{ animation: "slideInUp 0.3s ease-out" }}>
        
        <div className="flex items-center justify-between p-6 border-b border-[var(--border)]/60 bg-[var(--elevated)]/60 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--amber)]/20 border border-[var(--amber)]/30 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-[var(--amber)] drop-shadow-[0_0_5px_rgba(251,191,36,0.8)]" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg text-[var(--text-primary)]">Alert Deep Dive</h2>
              <p className="font-mono text-xs text-[var(--text-dim)]">{alert.time} • Room: {alert.roomId}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-[var(--elevated)]/40 border border-[var(--border)]/60">
              <p className="text-xs text-[var(--text-dim)] font-mono uppercase tracking-wider mb-1">Violation Type</p>
              <p className="font-medium text-[var(--text-primary)]">{alert.eventType}</p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--elevated)]/40 border border-[var(--border)]/60">
              <p className="text-xs text-[var(--text-dim)] font-mono uppercase tracking-wider mb-1">Risk Score Delta</p>
              <p className="font-bold text-[var(--red)] drop-shadow-[0_0_5px_rgba(244,63,94,0.5)]">+{alert.penalty}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[var(--elevated)]/40 border border-[var(--border)]/60">
             <p className="text-xs text-[var(--text-dim)] font-mono uppercase tracking-wider mb-2">Message Log</p>
             <p className="text-sm font-mono text-[var(--text-secondary)]">{alert.message}</p>
          </div>

          <div className="rounded-xl overflow-hidden border border-[var(--border)]/60 bg-[var(--elevated)]/40">
             <div className="px-4 py-3 border-b border-[var(--border)]/60 bg-[var(--elevated)]/80 flex items-center justify-between">
                <span className="text-xs font-mono text-[var(--text-dim)] uppercase tracking-wider">Evidence</span>
                <span className="text-[10px] bg-[var(--accent)]/20 text-[var(--accent)] px-2 py-0.5 rounded border border-[var(--accent)]/30">RISK +{alert.penalty}</span>
             </div>
             <div className="p-6 flex flex-col items-center justify-center bg-[var(--bg)]/50 min-h-[160px] relative overflow-hidden">
                {alert.evidenceUrl ? (
                  <img 
                    src={alert.evidenceUrl.startsWith('http') ? alert.evidenceUrl : `${getBackendUrl()}${alert.evidenceUrl}`} 
                    alt="Evidence Snapshot" 
                    className="absolute inset-0 w-full h-full object-cover opacity-80" 
                    // Never substitute a stock image for evidence; an expired link just needs a refresh
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                ) : (
                  <p className="text-sm text-[var(--text-dim)] text-center pt-6">No screenshot was captured for this alert.</p>
                )}
                <div className="absolute top-4 text-center bg-black/50 px-3 py-1 rounded-full">
                  <p className="text-sm text-white mb-0">Detected at {alert.time}</p>
                </div>
              </div>
           </div>

          <div className="flex gap-4 mt-2">
            <button onClick={() => { onWarnUser(alert.roomId); onClose(); }} className="flex-1 px-4 py-3 bg-[var(--amber)]/10 text-[var(--amber)] border border-[var(--amber)]/30 rounded-xl font-mono text-sm hover:bg-[var(--amber)] hover:text-black transition-colors flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Warn User
            </button>
            <button onClick={() => { onKillSession(alert.roomId); onClose(); }} className="flex-1 px-4 py-3 bg-[var(--red)]/10 text-[var(--red)] border border-[var(--red)]/30 rounded-xl font-mono text-sm hover:bg-[var(--red)] hover:text-black transition-colors flex items-center justify-center gap-2">
              <X className="w-4 h-4" /> Kill Session
            </button>
          </div>
        </div>

        <div className="p-6 border-t border-[var(--border)]/60 bg-[var(--surface)]/90 flex justify-between rounded-b-2xl">
          <button onClick={() => onFalsePositive(alert._id, !alert.falsePositive)}
            className={cn("px-4 py-2 rounded-lg font-mono text-xs flex items-center gap-2 transition-all",
            alert.falsePositive ? "bg-[var(--emerald)] text-black shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-[var(--elevated)] text-[var(--text-dim)] hover:text-[var(--emerald)] hover:bg-[var(--emerald)]/10")}>
            <CheckCircle className="w-4 h-4" />
            {alert.falsePositive ? "Marked as False Positive" : "Mark False Positive"}
          </button>
          
          <button onClick={() => onFlag(alert._id, !alert.flagged)}
            className={cn("px-4 py-2 rounded-lg font-mono text-xs flex items-center gap-2 transition-all",
            alert.flagged ? "bg-[var(--amber)] text-black shadow-[0_0_10px_rgba(251,191,36,0.5)]" : "bg-[var(--elevated)] text-[var(--text-dim)] hover:text-[var(--amber)] hover:bg-[var(--amber)]/10")}>
            <Flag className="w-4 h-4" />
            {alert.flagged ? "Flagged for Review" : "Flag for Review"}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [filter, setFilter] = useState<FilterType>("all")
  const [search, setSearch] = useState("")
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null)
  const [warningRoomId, setWarningRoomId] = useState<string | null>(null)
  const [warningMessage, setWarningMessage] = useState('')
  const { socket } = useAdminSocket()
  // Stored alerts come from the shared, cached report (components/admin/AdminData)
  const { data: report } = useAdminReports()
  const loaded = Boolean(report)

  useEffect(() => {
    if (!report) return
    const stored: Alert[] = (report.alerts || []).map((a: any) => ({
      _id: String(a._id),
      time: formatTime(a.time),
      roomId: a.room || 'SYSTEM',
      eventType: friendlyType(a.event || a.type || 'Unknown'),
      message: a.message || '',
      penalty: a.penalty || 0,
      totalRisk: 0,
      flagged: Boolean(a.flagged),
      falsePositive: Boolean(a.falsePositive),
      evidenceUrl: a.evidenceUrl,
    }))
    setAlerts(prev => {
      const storedIds = new Set(stored.map(a => a._id))
      const unsaved = prev.filter(a => a.liveOnly && !storedIds.has(a._id))
      return withRiskTotals([...unsaved, ...stored].slice(0, 200))
    })
  }, [report])

  // Live alerts on the dashboard's shared connection
  useSocketEvent('system-alert', (payload: any) => {
    const entry: Alert = {
      _id: payload._id ? String(payload._id) : `live-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      time: new Date().toLocaleTimeString('en-US', { hour12: false }),
      roomId: payload.room || 'SYSTEM',
      eventType: friendlyType(payload.event || payload.type || 'Unknown'),
      message: payload.message || '',
      penalty: payload.penalty || 0,
      totalRisk: 0,
      flagged: false,
      falsePositive: false,
      evidenceUrl: payload.evidenceUrl,
      liveOnly: !payload._id,
    }
    setAlerts(prev => withRiskTotals([entry, ...prev.filter(a => a._id !== entry._id)].slice(0, 200)))
  })

  // Warn and Kill act on a live room; most alerts in the list belong to sessions that have ended
  const liveRoomIds = new Set((useLiveSessions() || []).map((session: any) => session.id))
  const [notice, setNotice] = useState('')
  useSocketEvent('admin-action-complete', ({ message }: { message: string }) => setNotice(message))
  useSocketEvent('admin-error', (message: string) => setNotice(message))

  const requireLive = (roomId: string) => {
    if (liveRoomIds.has(roomId)) return true
    setNotice(`Room ${roomId} is no longer live, so there is nobody to warn or disconnect.`)
    return false
  }

  const handleWarnUser = (roomId: string) => {
    if (!requireLive(roomId)) return
    setWarningRoomId(roomId)
    setWarningMessage('')
  }

  const submitWarning = async () => {
    if (!warningRoomId) return
    socket?.emit('admin-warn-user', { roomId: warningRoomId, message: warningMessage })
    setNotice(`Warning sent to everyone in room ${warningRoomId}.`)
    setWarningRoomId(null)
  }

  const handleKillSession = (roomId: string) => {
    if (!requireLive(roomId)) return
    if (!window.confirm(`End room ${roomId} now? Everyone in it is disconnected.`)) return
    socket?.emit('kill-session', roomId)
    setNotice(`Room ${roomId} is being ended.`)
  }

  const updateAlertStatus = async (id: string, updates: { flagged?: boolean, falsePositive?: boolean }) => {
    const previous = alerts.find(a => a._id === id)
    const apply = (patch: Partial<Alert>) => {
      setAlerts(prev => prev.map(a => a._id === id ? { ...a, ...patch } : a))
      setSelectedAlert(prev => prev && prev._id === id ? { ...prev, ...patch } : prev)
    }
    // Optimistic UI update, rolled back if the server does not save it
    apply(updates)

    let saved = false
    try {
      // Without the JSON content type express.json leaves req.body empty and nothing is stored,
      // which also meant false positives never reached the device as federated training labels
      const res = await fetch(`${getBackendUrl()}/api/admin/alerts/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(updates),
      })
      const data = await res.json().catch(() => ({}))
      saved = res.ok && Boolean(data.success)
    } catch (e) {
      console.error('Failed to update alert', e)
    }
    if (!saved && previous) {
      apply({ flagged: previous.flagged, falsePositive: previous.falsePositive })
      window.alert('This verdict could not be saved. Alerts that were never stored (for example while the database was offline) cannot be reviewed.')
    }
  }

  const exportCSV = () => {
    const header = ["Time", "Room", "Alert Type", "Message", "Risk Delta", "Total Risk", "Flagged", "False Positive"].join(",")
    const rows = filtered.map(a => [
      `"${a.time}"`, `"${a.roomId}"`, `"${a.eventType}"`, `"${a.message.replace(/"/g, '""')}"`,
      a.penalty, a.totalRisk, a.flagged, a.falsePositive
    ].join(","))
    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alerts_export_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

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

  // The list is newest first, so a room's first entry carries its latest running total
  const latestRiskByRoom = new Map<string, number>()
  for (const alert of alerts) if (!latestRiskByRoom.has(alert.roomId)) latestRiskByRoom.set(alert.roomId, alert.totalRisk)
  const topOffenders = Array.from(latestRiskByRoom.entries())
    .map(([room, score]) => ({ room, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const highCount = alerts.filter(a => a.totalRisk >= 70).length
  const totalPenalty = alerts.reduce((s, a) => s + a.penalty, 0)

  return (
    <>
      {notice && (
        <div role="status" className="fixed bottom-6 right-6 z-[80] flex max-w-md items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text-primary)] shadow-xl">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Dismiss" className="text-[var(--text-dim)] hover:text-[var(--text-primary)]"><X className="h-4 w-4" /></button>
        </div>
      )}
      <AlertDetailsModal 
        alert={selectedAlert} 
        onClose={() => setSelectedAlert(null)} 
        onFlag={(id, f) => updateAlertStatus(id, { flagged: f })} 
        onFalsePositive={(id, fp) => updateAlertStatus(id, { falsePositive: fp })} 
        onWarnUser={handleWarnUser}
        onKillSession={handleKillSession}
      />

      {warningRoomId && createPortal(
        <>
          <div className="fixed inset-0 bg-black/60 z-[60]" onClick={() => setWarningRoomId(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl z-[70] overflow-hidden">
            <div className="p-4 border-b border-[var(--border)]/60 bg-[var(--elevated)] flex justify-between items-center">
              <h3 className="font-mono font-bold text-[var(--amber)] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Send Warning
              </h3>
              <button onClick={() => setWarningRoomId(null)} className="text-[var(--text-dim)] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6">
              <p className="text-xs text-[var(--text-dim)] font-mono mb-2">Message to Host/Controller</p>
              <textarea 
                value={warningMessage}
                onChange={e => setWarningMessage(e.target.value)}
                placeholder="Type your warning message here..."
                className="w-full h-24 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-sm text-[var(--text-primary)] font-mono placeholder-[var(--text-dim)] focus:border-[var(--amber)] outline-none resize-none"
              />
              <div className="flex gap-3 mt-4">
                <button onClick={() => setWarningRoomId(null)} className="flex-1 py-2 border border-[var(--border)] rounded-lg text-sm font-mono text-[var(--text-dim)] hover:text-white hover:bg-[var(--elevated)]">Cancel</button>
                <button onClick={submitWarning} className="flex-1 py-2 bg-[var(--amber)] text-black font-bold font-mono rounded-lg shadow-[0_0_15px_rgba(251,191,36,0.3)] hover:scale-[1.02] transition-transform">Send Warning</button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
      <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Anti-Cheat Alerts</h1>
        <div className="flex items-center gap-4 font-mono text-xs text-[var(--text-dim)]">
          <span>{alerts.length} total</span>
          <span className="text-[var(--red)]">{highCount} high-risk</span>
          <span className="text-[var(--amber)]">+{totalPenalty} total penalty</span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-140px)]">
        {/* Left — Alert Table */}
        <div className="flex-1 min-w-0 h-full">
          <div className="bg-[var(--surface)]/70 border border-[var(--border)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-[var(--border)]/60 flex flex-shrink-0 items-center gap-4 bg-[var(--elevated)]/60">
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
              <button onClick={exportCSV} className="px-3 py-2 bg-[var(--surface)]/50 border border-[var(--border)]/60 rounded-xl text-xs font-mono text-[var(--text-primary)] hover:bg-[var(--elevated)] hover:border-[var(--accent)]/50 transition-colors flex items-center gap-2">
                <Download className="w-3 h-3" />
                Export CSV
              </button>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search alerts…"
                  className="w-64 pl-10 pr-4 py-2 bg-[var(--elevated)]/80 border border-[var(--border)]/60 rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:border-[var(--accent)] outline-none transition-colors" />
              </div>
            </div>

            {!loaded ? (
              <div className="p-10 text-center text-[var(--text-dim)] font-mono text-sm">Loading alerts…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-[var(--text-dim)] font-mono text-sm flex-1">
                {alerts.length === 0 ? "No alerts yet — system is clean" : "No alerts match the current filter"}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-[var(--border)]/60 bg-[var(--elevated)]">
                      {["Time", "Room", "Alert Type", "Message", "Delta", "Risk", "Actions"].map(h => (
                        <th key={h} className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((alert, i) => (
                      <tr key={i} onClick={() => setSelectedAlert(alert)}
                        className={cn(
                          "border-b border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--elevated)] group",
                          alert.totalRisk >= 70 && "border-l-4 border-l-[var(--red)]",
                          alert.flagged && "bg-[var(--amber)]/5",
                          alert.falsePositive && "opacity-50"
                        )}>
                        <td className="px-5 py-4 font-mono text-sm text-[var(--text-dim)]">
                           <div className="flex items-center gap-2">
                              {alert.flagged && <Flag className="w-3 h-3 text-[var(--amber)]" />}
                              {alert.falsePositive && <CheckCircle className="w-3 h-3 text-[var(--emerald)]" />}
                              {alert.time}
                           </div>
                        </td>
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
                        <td className="px-5 py-4">
                           <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                              <button onClick={() => handleWarnUser(alert.roomId)} disabled={!liveRoomIds.has(alert.roomId)} title={liveRoomIds.has(alert.roomId) ? 'Warn everyone in this room' : 'This room has ended'} className="disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 bg-[var(--amber)]/20 text-[var(--amber)] border border-[var(--amber)]/30 rounded text-xs font-mono hover:bg-[var(--amber)] hover:text-black transition-colors">
                                Warn
                              </button>
                              <button onClick={() => handleKillSession(alert.roomId)} disabled={!liveRoomIds.has(alert.roomId)} title={liveRoomIds.has(alert.roomId) ? 'End this room now' : 'This room has ended'} className="disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/30 rounded text-xs font-mono hover:bg-[var(--red)] hover:text-black transition-colors">
                                Kill
                              </button>
                           </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right — Charts */}
        <div className="w-full lg:w-[350px] shrink-0 space-y-6 overflow-y-auto pb-4 pr-2">
          <div className="bg-[var(--surface)]/70 border border-[var(--border)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl p-6 hover:border-[var(--border-bright)] transition-colors">
            {pieData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-[var(--text-dim)] font-mono text-sm">No data yet</div>
            ) : (
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
            )}
          </div>

          <div className="bg-[var(--surface)]/70 border border-[var(--border)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl p-6 hover:border-[var(--border-bright)] transition-colors">
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
    </>
  )
}






