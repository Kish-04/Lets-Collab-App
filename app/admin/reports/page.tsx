"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { FileText, Download, RefreshCw, Users, Shield, Clock, Link2 } from "lucide-react"
import { DataCard } from "@/components/ircp/shared"
import { cn, getAuthHeaders, getBackendUrl, getStoredAuthToken } from "@/lib/utils"

type UserActivity = {
  name: string; email: string; role: string; sessionCount: number
  isVerified: boolean; banned: boolean; lastSeen: string; joinedAt: string
}
type AlertEntry = {
  room: string; hostEmail: string; type: string; event: string
  message: string; penalty: number; time: string
}
type ReportData = {
  userActivity: UserActivity[]
  alerts: AlertEntry[]
  generatedAt: string
  mock?: boolean
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Download helpers ──────────────────────────────────────────────────────────
function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function downloadCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function downloadPDF(title: string, headers: string[], rows: string[][], filename: string) {
  // Build a simple HTML table and print it as PDF via browser
  const html = `
    <html><head><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: monospace; padding: 24px; color: #000; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      p  { font-size: 11px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #111; color: #0ff; padding: 6px 8px; text-align: left; }
      td { padding: 5px 8px; border-bottom: 1px solid #eee; }
      tr:nth-child(even) td { background: #f9f9f9; }
    </style></head><body>
    <h1>${escapeHtml(title)}</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    <table>
      <thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    </body></html>`
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 500)
}

// ── Report Card ───────────────────────────────────────────────────────────────
function ReportCard({
  icon: Icon, title, subtitle, count, color, onJSON, onCSV, onPDF, children,
}: {
  icon: any; title: string; subtitle: string; count: number; color: string
  onJSON: () => void; onCSV: () => void; onPDF: () => void
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 shadow-[0_8px_32px_rgba(0,0,0,0.3)] rounded-2xl overflow-hidden hover:border-[var(--border-bright)] transition-all">
      <div className="p-6 flex items-start justify-between bg-[var(--elevated)]/60">
        <div className="flex items-start gap-4">
          <div className={cn("p-3 rounded-xl border shadow-inner", `bg-[var(--${color})]/20 border-[var(--${color})]/30`)}>
            <Icon className={cn("w-5 h-5 drop-shadow-[0_0_5px_currentColor]", `text-[var(--${color})]`)} />
          </div>
          <div>
            <h3 className="font-display font-bold text-lg text-[var(--text-primary)] drop-shadow-md">{title}</h3>
            <p className="text-xs text-[var(--text-dim)] mt-1">{subtitle}</p>
            <span className={cn("inline-block mt-3 px-2.5 py-1 rounded-md font-mono text-[10px] border", `bg-[var(--${color})]/10 border-[var(--${color})]/30 text-[var(--${color})] drop-shadow-[0_0_5px_currentColor]`)}>
              {count} records
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-3 items-end">
          <div className="flex gap-2">
            {[
              { label: "JSON", fn: onJSON, color: "var(--accent)" },
              { label: "CSV", fn: onCSV, color: "var(--emerald)" },
              { label: "PDF", fn: onPDF, color: "var(--amber)" },
            ].map(btn => (
              <button key={btn.label} onClick={btn.fn}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)]/60 bg-[var(--elevated)]/80 backdrop-blur-sm text-[10px] font-mono font-bold transition-all hover:border-current hover:bg-[var(--bg)]/80 shadow-sm"
                style={{ color: btn.color }}>
                <Download className="w-3.5 h-3.5 drop-shadow-[0_0_3px_currentColor]" />
                {btn.label}
              </button>
            ))}
          </div>
          <button onClick={() => setOpen(o => !o)}
            className="text-[10px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors bg-[var(--elevated)] px-2 py-1 rounded mt-1 border border-[var(--border)]">
            {open ? '▲ Hide preview' : '▼ Preview data'}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[var(--border)]/60 max-h-80 overflow-y-auto custom-scrollbar bg-[var(--bg)]/70 shadow-inner">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const router = useRouter()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getStoredAuthToken()) router.push('/admin/login')
  }, [router])

  const fetchReports = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${getBackendUrl()}/api/admin/reports`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      })
      const json = await res.json()
      if (json.success) setData(json)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchReports() }, [])

  if (loading) return (
    <div className="p-6 flex flex-col items-center justify-center h-[60vh] gap-4">
      <RefreshCw className="w-8 h-8 text-[var(--accent)] animate-spin drop-shadow-[0_0_10px_rgba(0,255,255,0.5)]" />
      <p className="font-mono text-sm text-[var(--text-dim)]">Generating reports…</p>
    </div>
  )

  if (!data) return (
    <div className="p-6 flex items-center justify-center h-full">
      <p className="font-mono text-sm text-[var(--red)] bg-[var(--red)]/10 px-4 py-2 rounded-lg border border-[var(--red)]/20">Failed to load reports. Is the server running?</p>
    </div>
  )

  const { userActivity, alerts, generatedAt } = data

  // ── User Activity ──
  const handleUserJSON = () => downloadJSON(userActivity, 'user_activity.json')
  const handleUserCSV = () => downloadCSV(userActivity.map(u => ({
    Name: u.name, Email: u.email, Role: u.role, Sessions: u.sessionCount,
    Verified: u.isVerified, Banned: u.banned,
    'Last Seen': formatDate(u.lastSeen), 'Joined': formatDate(u.joinedAt),
  })), 'user_activity.csv')
  const handleUserPDF = () => downloadPDF(
    'User Activity Report',
    ['Name', 'Email', 'Role', 'Sessions', 'Verified', 'Banned', 'Last Seen'],
    userActivity.map(u => [u.name, u.email, u.role, String(u.sessionCount), String(u.isVerified), String(u.banned), formatDate(u.lastSeen)]),
    'user_activity.pdf'
  )

  // ── Alerts ──
  const handleAlertJSON = () => downloadJSON(alerts, 'alerts_log.json')
  const handleAlertCSV = () => downloadCSV(alerts.map(a => ({
    Room: a.room, Host: a.hostEmail, Type: a.type,
    Event: a.event, Message: a.message, Penalty: a.penalty, Time: formatDate(a.time),
  })), 'alerts_log.csv')
  const handleAlertPDF = () => downloadPDF(
    'Anti-Cheat Alerts Log',
    ['Room', 'Host', 'Type', 'Message', 'Penalty', 'Time'],
    alerts.map(a => [a.room, a.hostEmail, a.type, a.message, String(a.penalty), formatDate(a.time)]),
    'alerts_log.pdf'
  )

  // ── Full Activity (all combined) ──
  const fullActivity = {
    generatedAt,
    userActivity,
    alerts,
    summary: {
      totalUsers: userActivity.length,
      totalSessions: userActivity.reduce((s, u) => s + u.sessionCount, 0),
      totalAlerts: alerts.length,
      totalPenalty: alerts.reduce((s, a) => s + a.penalty, 0),
      bannedUsers: userActivity.filter(u => u.banned).length,
      verifiedUsers: userActivity.filter(u => u.isVerified).length,
    }
  }
  const handleFullJSON = () => downloadJSON(fullActivity, 'full_activity_report.json')
  const handleFullCSV = () => {
    downloadCSV(userActivity.map(u => ({
      Section: 'USER', Name: u.name, Email: u.email, Sessions: u.sessionCount,
      Role: u.role, Verified: u.isVerified, Banned: u.banned,
    })), 'full_activity_users.csv')
    setTimeout(() => downloadCSV(alerts.map(a => ({
      Section: 'ALERT', Room: a.room, Host: a.hostEmail, Message: a.message, Penalty: a.penalty,
    })), 'full_activity_alerts.csv'), 300)
  }
  const handleFullPDF = () => downloadPDF(
    "Full Activity Report - Let's Collab!",
    ['Section', 'Name/Room', 'Email/Host', 'Sessions/Penalty', 'Role/Type', 'Status'],
    [
      ...userActivity.map(u => ['USER', u.name, u.email, String(u.sessionCount), u.role, u.banned ? 'BANNED' : u.isVerified ? 'ACTIVE' : 'UNVERIFIED']),
      ...alerts.map(a => ['ALERT', a.room, a.hostEmail, String(a.penalty), a.type, a.message.slice(0, 40)]),
    ],
    'full_activity.pdf'
  )

  const totalSessions = userActivity.reduce((s, u) => s + u.sessionCount, 0)
  const totalPenalty = alerts.reduce((s, a) => s + a.penalty, 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-2xl text-[var(--text-primary)] drop-shadow-md">System Reports</h1>
          {generatedAt && (
            <p className="text-xs font-mono text-[var(--text-dim)] mt-2 bg-[var(--elevated)]/60 inline-block px-3 py-1 rounded-full border border-[var(--border)]">
              Last generated: {formatDate(generatedAt)}
              {data.mock && <span className="ml-2 text-[var(--amber)] drop-shadow-[0_0_3px_rgba(251,191,36,0.5)]">· MOCK DATA (DB offline)</span>}
            </p>
          )}
        </div>
        <button onClick={fetchReports}
          className="flex items-center gap-2 px-5 py-2.5 bg-[var(--accent)] text-black rounded-lg text-sm font-bold shadow-[0_0_15px_rgba(0,255,255,0.4)] hover:shadow-[0_0_25px_rgba(0,255,255,0.6)] hover:-translate-y-0.5 transition-all">
          <RefreshCw className="w-4 h-4" />
          Regenerate All
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <DataCard label="Total Users" value={userActivity.length.toString()} />
        <DataCard label="Total Sessions" value={totalSessions.toString()} color="accent" />
        <DataCard label="Total Alerts" value={alerts.length.toString()} color="amber" />
        <DataCard label="Total Penalty" value={totalPenalty.toString()} color="red" />
      </div>

      <div className="space-y-6">
        {/* User Activity */}
        <ReportCard icon={Users} title="User Activity Summary" color="accent"
          subtitle="Sessions per user, roles, verification status"
          count={userActivity.length}
          onJSON={handleUserJSON} onCSV={handleUserCSV} onPDF={handleUserPDF}>
          <table className="w-full text-xs font-mono">
            <thead><tr className="bg-[var(--elevated)]/80 border-b border-[var(--border)]/60">
              {['Name', 'Email', 'Role', 'Sessions', 'Status'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[var(--text-secondary)] font-normal uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {userActivity.map((u, i) => (
                <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--elevated)] transition-colors">
                  <td className="px-5 py-3 text-[var(--text-primary)] font-medium">{u.name}</td>
                  <td className="px-5 py-3 text-[var(--text-dim)]">{u.email}</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-md text-[9px] border",
                      u.role === 'admin' ? 'bg-[var(--violet)]/20 text-[var(--violet)] border-[var(--violet)]/30 drop-shadow-[0_0_3px_currentColor]' : 'bg-[var(--elevated)]/60 text-[var(--text-dim)] border-[var(--border)]')}>
                      {u.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[var(--accent)] font-bold">{u.sessionCount}</td>
                  <td className="px-5 py-3">
                    <span className={cn("px-2 py-0.5 rounded-md text-[9px] border",
                      u.banned ? 'bg-[var(--red)]/20 text-[var(--red)] border-[var(--red)]/30 drop-shadow-[0_0_3px_currentColor]'
                        : u.isVerified ? 'bg-[var(--emerald)]/20 text-[var(--emerald)] border-[var(--emerald)]/30 drop-shadow-[0_0_3px_currentColor]'
                          : 'bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30 drop-shadow-[0_0_3px_currentColor]')}>
                      {u.banned ? 'BANNED' : u.isVerified ? 'ACTIVE' : 'UNVERIFIED'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportCard>

        {/* Anti-Cheat Alerts */}
        <ReportCard icon={Shield} title="Anti-Cheat Alerts Log" color="amber"
          subtitle="All violations detected during sessions"
          count={alerts.length}
          onJSON={handleAlertJSON} onCSV={handleAlertCSV} onPDF={handleAlertPDF}>
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-sm font-mono text-[var(--text-dim)]">No alerts recorded yet</div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead><tr className="bg-[var(--elevated)]/80 border-b border-[var(--border)]/60">
                {['Room', 'Host', 'Type', 'Message', 'Penalty', 'Time'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[var(--text-secondary)] font-normal uppercase tracking-wider">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {alerts.slice(0, 50).map((a, i) => (
                  <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--elevated)] transition-colors">
                    <td className="px-5 py-3 text-[var(--accent)]">{a.room.slice(0, 4)}·{a.room.slice(4, 8)}</td>
                    <td className="px-5 py-3 text-[var(--text-primary)]">{a.hostEmail}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded-md text-[9px] bg-[var(--amber)]/20 text-[var(--amber)] border border-[var(--amber)]/30 drop-shadow-[0_0_3px_currentColor]">{a.type}</span>
                    </td>
                    <td className="px-5 py-3 text-[var(--text-secondary)] max-w-[200px] truncate">{a.message}</td>
                    <td className="px-5 py-3 text-[var(--red)] font-bold drop-shadow-[0_0_5px_rgba(244,63,94,0.5)]">+{a.penalty}</td>
                    <td className="px-5 py-3 text-[var(--text-dim)]">{formatDate(a.time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportCard>

        {/* Full Activity Report */}
        <ReportCard icon={FileText} title="Full Activity Report" color="violet"
          subtitle="Combined export of all system activity"
          count={userActivity.length + alerts.length}
          onJSON={handleFullJSON} onCSV={handleFullCSV} onPDF={handleFullPDF}>
          <div className="p-6 grid grid-cols-3 gap-4">
            {[
              { label: 'Total Users', value: userActivity.length },
              { label: 'Total Sessions', value: totalSessions },
              { label: 'Total Alerts', value: alerts.length },
              { label: 'Total Penalty', value: totalPenalty },
              { label: 'Banned Users', value: userActivity.filter(u => u.banned).length },
              { label: 'Verified Users', value: userActivity.filter(u => u.isVerified).length },
            ].map(s => (
              <div key={s.label} className="p-4 bg-[var(--elevated)]/60 border border-[var(--border)] rounded-xl backdrop-blur-sm shadow-inner hover:bg-[var(--elevated)]/80 transition-colors">
                <p className="font-mono text-[10px] text-[var(--text-dim)] uppercase tracking-wider flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/20"></span> {s.label}
                </p>
                <p className="font-display font-bold text-2xl text-[var(--text-primary)] mt-2 drop-shadow-md">{s.value}</p>
              </div>
            ))}
          </div>
        </ReportCard>
      </div>
    </div>
  )
}
