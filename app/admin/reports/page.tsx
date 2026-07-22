"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { FileText, Download, RefreshCw, Users, Shield, Clock, Link2 } from "lucide-react"
import { DataCard } from "@/components/ircp/shared"
import { cn, getBackendUrl } from "@/lib/utils"

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

function downloadPDF(title: string, headers: string[], rows: string[][], filename: string) {
  // Build a simple HTML table and print it as PDF via browser
  const html = `
    <html><head><title>${title}</title>
    <style>
      body { font-family: monospace; padding: 24px; color: #000; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      p  { font-size: 11px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #111; color: #0ff; padding: 6px 8px; text-align: left; }
      td { padding: 5px 8px; border-bottom: 1px solid #eee; }
      tr:nth-child(even) td { background: #f9f9f9; }
    </style></head><body>
    <h1>${title}</h1>
    <p>Generated: ${new Date().toLocaleString()}</p>
    <table>
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
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
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="p-5 flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={cn("p-2.5 rounded-lg", `bg-[var(--${color})]/10`)}>
            <Icon className={cn("w-5 h-5", `text-[var(--${color})]`)} />
          </div>
          <div>
            <h3 className="font-display font-bold text-base text-[var(--text-primary)]">{title}</h3>
            <p className="text-xs text-[var(--text-dim)] mt-0.5">{subtitle}</p>
            <span className={cn("inline-block mt-2 px-2 py-0.5 rounded-full font-mono text-[10px]", `bg-[var(--${color})]/10 text-[var(--${color})]`)}>
              {count} records
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 items-end">
          <div className="flex gap-1.5">
            {[
              { label: "JSON", fn: onJSON, color: "var(--accent)" },
              { label: "CSV", fn: onCSV, color: "var(--emerald)" },
              { label: "PDF", fn: onPDF, color: "var(--amber)" },
            ].map(btn => (
              <button key={btn.label} onClick={btn.fn}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] text-[10px] font-mono font-bold transition-colors hover:border-current"
                style={{ color: btn.color }}>
                <Download className="w-3 h-3" />
                {btn.label}
              </button>
            ))}
          </div>
          <button onClick={() => setOpen(o => !o)}
            className="text-[10px] font-mono text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors">
            {open ? '▲ Hide preview' : '▼ Preview data'}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[var(--border)] max-h-64 overflow-y-auto">
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
    if (!localStorage.getItem('ircp_email')) router.push('/')
  }, [router])

  const fetchReports = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${getBackendUrl()}/api/admin/reports`, {
        credentials: 'include',
        
      })
      const json = await res.json()
      if (json.success) setData(json)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchReports() }, [])

  if (loading) return (
    <div className="p-6 flex items-center justify-center h-full">
      <p className="font-mono text-sm text-[var(--text-dim)]">Loading reports…</p>
    </div>
  )

  if (!data) return (
    <div className="p-6 flex items-center justify-center h-full">
      <p className="font-mono text-sm text-[var(--red)]">Failed to load reports. Is the server running?</p>
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-[var(--text-primary)]">Reports</h1>
          {generatedAt && (
            <p className="text-xs font-mono text-[var(--text-dim)] mt-1">
              Last generated: {formatDate(generatedAt)}
              {data.mock && <span className="ml-2 text-[var(--amber)]">· MOCK DATA (DB offline)</span>}
            </p>
          )}
        </div>
        <button onClick={fetchReports}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-black rounded-lg text-sm font-bold hover:brightness-110 transition-all">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <DataCard label="Total Users" value={userActivity.length.toString()} />
        <DataCard label="Total Sessions" value={totalSessions.toString()} color="accent" />
        <DataCard label="Total Alerts" value={alerts.length.toString()} color="amber" />
        <DataCard label="Total Penalty" value={totalPenalty.toString()} color="red" />
      </div>

      <div className="space-y-4">
        {/* User Activity */}
        <ReportCard icon={Users} title="User Activity Summary" color="accent"
          subtitle="Sessions per user, roles, verification status"
          count={userActivity.length}
          onJSON={handleUserJSON} onCSV={handleUserCSV} onPDF={handleUserPDF}>
          <table className="w-full text-xs font-mono">
            <thead><tr className="bg-[var(--elevated)]">
              {['Name', 'Email', 'Role', 'Sessions', 'Status'].map(h => (
                <th key={h} className="px-4 py-2 text-left text-[var(--text-dim)] font-normal">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {userActivity.map((u, i) => (
                <tr key={i} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 text-[var(--text-primary)]">{u.name}</td>
                  <td className="px-4 py-2 text-[var(--text-dim)]">{u.email}</td>
                  <td className="px-4 py-2">
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px]",
                      u.role === 'admin' ? 'bg-[var(--violet)]/10 text-[var(--violet)]' : 'bg-[var(--border)] text-[var(--text-dim)]')}>
                      {u.role.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[var(--accent)]">{u.sessionCount}</td>
                  <td className="px-4 py-2">
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px]",
                      u.banned ? 'bg-[var(--red)]/10 text-[var(--red)]'
                        : u.isVerified ? 'bg-[var(--emerald)]/10 text-[var(--emerald)]'
                          : 'bg-[var(--amber)]/10 text-[var(--amber)]')}>
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
            <div className="p-6 text-center text-xs font-mono text-[var(--text-dim)]">No alerts recorded yet</div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead><tr className="bg-[var(--elevated)]">
                {['Room', 'Host', 'Type', 'Message', 'Penalty', 'Time'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[var(--text-dim)] font-normal">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {alerts.slice(0, 50).map((a, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2 text-[var(--accent)]">{a.room.slice(0, 4)}·{a.room.slice(4, 8)}</td>
                    <td className="px-4 py-2 text-[var(--text-dim)]">{a.hostEmail}</td>
                    <td className="px-4 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-[var(--amber)]/10 text-[var(--amber)]">{a.type}</span>
                    </td>
                    <td className="px-4 py-2 text-[var(--text-secondary)] max-w-[200px] truncate">{a.message}</td>
                    <td className="px-4 py-2 text-[var(--red)]">+{a.penalty}</td>
                    <td className="px-4 py-2 text-[var(--text-dim)]">{formatDate(a.time)}</td>
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
          <div className="p-4 grid grid-cols-3 gap-3">
            {[
              { label: 'Total Users', value: userActivity.length },
              { label: 'Total Sessions', value: totalSessions },
              { label: 'Total Alerts', value: alerts.length },
              { label: 'Total Penalty', value: totalPenalty },
              { label: 'Banned Users', value: userActivity.filter(u => u.banned).length },
              { label: 'Verified Users', value: userActivity.filter(u => u.isVerified).length },
            ].map(s => (
              <div key={s.label} className="p-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg">
                <p className="font-mono text-[9px] text-[var(--text-dim)] uppercase tracking-wider">{s.label}</p>
                <p className="font-display font-bold text-xl text-[var(--text-primary)] mt-1">{s.value}</p>
              </div>
            ))}
          </div>
        </ReportCard>
      </div>
    </div>
  )
}







