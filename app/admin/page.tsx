"use client"

import { useState, useEffect } from "react"
import { Activity, ShieldAlert, Users, LayoutDashboard } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts"
import { getAuthHeaders, getBackendUrl } from "@/lib/utils"
import { ActivityHeatmap } from "@/components/ircp/shared"

export default function AdminOverviewPage() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState(false)
  
  useEffect(() => {
    fetch(`${getBackendUrl()}/api/admin/reports`, {
      credentials: 'include',
      headers: getAuthHeaders(),
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to load")
        return res.json()
      })
      .then(d => {
        if (!d) return // Handled by redirect
        if (d.success) setData(d)
        else setError(true)
      })
      .catch(() => setError(true))
  }, [])

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-[var(--red)] font-mono p-8">
        Error loading analytics from backend. Ensure the backend server is running.
      </div>
    )
  }

  if (!data) return <div className="h-full flex items-center justify-center text-[var(--text-dim)] font-mono animate-pulse p-8">Loading Platform Analytics...</div>

  // Prepare chart data realistically based on server data
  const activityData = (data.userActivity || []).slice(0, 10).map((u: any) => ({
    name: u.name?.split(' ')[0] || "User", sessions: u.sessionCount || 0
  }))

  const alertData = (data.alerts || []).reduce((acc: any, a: any) => {
    const d = new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const ev = acc.find((e: any) => e.time === d)
    if (ev) ev.alerts += 1
    else acc.push({ time: d, alerts: 1 })
    return acc
  }, []).slice(-15)

  return (
    <div className="p-8 lg:p-12 w-full max-w-7xl mx-auto space-y-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/20 border border-[var(--accent)]/30 shadow-[0_0_15px_rgba(0,255,255,0.2)] flex items-center justify-center text-[var(--accent)]">
          <LayoutDashboard className="w-5 h-5 drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]"/>
        </div>
        <div>
          <h1 className="font-display font-black text-2xl text-[var(--text-primary)]">Platform Overview</h1>
          <p className="text-sm font-mono text-[var(--text-dim)] mt-1 uppercase tracking-wider">Real-time system health and intelligence</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="p-6 bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-2xl flex items-center gap-4 hover:border-[var(--violet)]/50 hover:shadow-[0_8px_32px_rgba(139,92,246,0.15)] hover:-translate-y-1 transition-all duration-300 group">
             <div className="p-4 rounded-xl bg-[var(--violet)]/20 border border-[var(--violet)]/30 text-[var(--violet)] group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-all duration-300"><Users className="w-8 h-8"/></div>
             <div><p className="text-[var(--text-dim)] font-mono text-sm uppercase tracking-widest mb-1">Total Users</p><p className="font-display font-bold text-4xl leading-none text-[var(--text-primary)]">{data.userActivity?.length || 0}</p></div>
         </div>
         <div className="p-6 bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-2xl flex items-center gap-4 hover:border-[var(--red)]/50 hover:shadow-[0_8px_32px_rgba(244,63,94,0.15)] hover:-translate-y-1 transition-all duration-300 group">
             <div className="p-4 rounded-xl bg-[var(--red)]/20 border border-[var(--red)]/30 text-[var(--red)] group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(244,63,94,0.3)] transition-all duration-300"><ShieldAlert className="w-8 h-8"/></div>
             <div><p className="text-[var(--text-dim)] font-mono text-sm uppercase tracking-widest mb-1">Active Alerts</p><p className="font-display font-bold text-4xl leading-none text-[var(--text-primary)]">{data.alerts?.length || 0}</p></div>
         </div>
         <div className="p-6 bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-2xl flex items-center gap-4 hover:border-[var(--emerald)]/50 hover:shadow-[0_8px_32px_rgba(16,185,129,0.15)] hover:-translate-y-1 transition-all duration-300 group">
             <div className="p-4 rounded-xl bg-[var(--emerald)]/20 border border-[var(--emerald)]/30 text-[var(--emerald)] group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all duration-300"><Activity className="w-8 h-8"/></div>
             <div><p className="text-[var(--text-dim)] font-mono text-sm uppercase tracking-widest mb-1">Verified Accounts</p><p className="font-display font-bold text-4xl leading-none text-[var(--text-primary)]">{data.userActivity?.filter((u:any) => u.isVerified).length || 0}</p></div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
         <div className="p-6 bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-2xl hover:border-[var(--border-bright)] transition-colors">
           <h3 className="font-display font-bold text-xl mb-6 text-[var(--text-primary)]">User Session Activity</h3>
           <div className="h-72">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={activityData.length > 0 ? activityData : [{name: 'No Data', sessions: 0}]}>
                 <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                 <XAxis dataKey="name" stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <YAxis stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <Tooltip itemStyle={{ color: 'var(--text-primary)' }} labelStyle={{ color: 'var(--text-primary)' }} contentStyle={{ backgroundColor: 'var(--surface)', backdropFilter: 'blur(12px)', borderColor: 'var(--border-bright)', borderRadius: '12px', color: 'var(--text-primary)' }} cursor={{fill: 'var(--elevated)'}} />
                 <Bar dataKey="sessions" fill="var(--violet)" radius={[6, 6, 0, 0]} maxBarSize={50} />
               </BarChart>
             </ResponsiveContainer>
           </div>
         </div>

         <div className="p-6 bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-2xl hover:border-[var(--border-bright)] transition-colors">
           <h3 className="font-display font-bold text-xl mb-6 text-[var(--text-primary)]">Anti-Cheat Alert Frequency</h3>
           <div className="h-72">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={alertData.length > 0 ? alertData : [{time: 'Now', alerts: 0}]}>
                 <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                 <XAxis dataKey="time" stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <YAxis stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <Tooltip itemStyle={{ color: 'var(--text-primary)' }} labelStyle={{ color: 'var(--text-primary)' }} contentStyle={{ backgroundColor: 'var(--surface)', backdropFilter: 'blur(12px)', borderColor: 'var(--border-bright)', borderRadius: '12px', color: 'var(--text-primary)' }} />
                 <Line type="monotone" dataKey="alerts" stroke="var(--red)" strokeWidth={3} dot={{r: 4, fill: "var(--red)"}} activeDot={{r: 6}} />
               </LineChart>
             </ResponsiveContainer>
           </div>
         </div>
      </div>

      <div className="mt-6 p-6 bg-[var(--surface)]/30 backdrop-blur-xl border border-[var(--border)]/60 rounded-2xl hover:border-[var(--border-bright)] transition-colors">
         <h3 className="font-display font-bold text-xl mb-2 text-[var(--text-primary)]">System Activity History</h3>
         <p className="text-sm font-mono text-[var(--text-dim)] mb-6">Daily event density over the last 90 days</p>
         <div className="flex justify-center">
           <ActivityHeatmap />
         </div>
      </div>
    </div>
  )
}
