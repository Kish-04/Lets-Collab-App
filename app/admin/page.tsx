"use client"

import { useState, useEffect } from "react"
import { Activity, ShieldAlert, Users, LayoutDashboard } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from "recharts"
import { getAuthHeaders, getBackendUrl } from "@/lib/utils"

export default function AdminOverviewPage() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState(false)
  
  useEffect(() => {
    fetch(`${getBackendUrl()}/api/admin/reports`, {
      credentials: 'include',
      headers: getAuthHeaders(),
    })
      .then(res => {
        if (res.status === 401 || res.status === 403) {
          window.location.href = '/admin/login'
          return null
        }
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
        <div className="w-10 h-10 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)] flex items-center justify-center text-[var(--accent)]">
          <LayoutDashboard className="w-5 h-5"/>
        </div>
        <div>
          <h1 className="font-display font-black text-2xl text-[var(--text-primary)]">Platform Overview</h1>
          <p className="text-sm font-mono text-[var(--text-dim)] mt-1">Real-time system health and intelligence</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <div className="p-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl flex items-center gap-4 hover:border-[var(--violet)] transition-colors group">
             <div className="p-4 rounded-xl bg-[var(--violet)]/10 text-[var(--violet)] group-hover:scale-110 transition-transform"><Users className="w-8 h-8"/></div>
             <div><p className="text-[var(--text-dim)] font-mono text-sm leading-none mb-2">Total Users</p><p className="font-display font-bold text-4xl leading-none">{data.userActivity?.length || 0}</p></div>
         </div>
         <div className="p-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl flex items-center gap-4 hover:border-[var(--red)] transition-colors group">
             <div className="p-4 rounded-xl bg-[var(--red)]/10 text-[var(--red)] group-hover:scale-110 transition-transform"><ShieldAlert className="w-8 h-8"/></div>
             <div><p className="text-[var(--text-dim)] font-mono text-sm leading-none mb-2">Active Alerts</p><p className="font-display font-bold text-4xl leading-none">{data.alerts?.length || 0}</p></div>
         </div>
         <div className="p-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl flex items-center gap-4 hover:border-[var(--emerald)] transition-colors group">
             <div className="p-4 rounded-xl bg-[var(--emerald)]/10 text-[var(--emerald)] group-hover:scale-110 transition-transform"><Activity className="w-8 h-8"/></div>
             <div><p className="text-[var(--text-dim)] font-mono text-sm leading-none mb-2">Verified Accounts</p><p className="font-display font-bold text-4xl leading-none">{data.userActivity?.filter((u:any) => u.isVerified).length || 0}</p></div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
         <div className="p-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
           <h3 className="font-display font-bold text-xl mb-6">User Session Activity</h3>
           <div className="h-72">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={activityData.length > 0 ? activityData : [{name: 'No Data', sessions: 0}]}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#2a2a42" vertical={false} />
                 <XAxis dataKey="name" stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <YAxis stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <Tooltip contentStyle={{ backgroundColor: '#0f0f1a', borderColor: '#1e1e30', borderRadius: '8px' }} cursor={{fill: 'rgba(255,255,255,0.05)'}} />
                 <Bar dataKey="sessions" fill="var(--violet)" radius={[4, 4, 0, 0]} maxBarSize={60} />
               </BarChart>
             </ResponsiveContainer>
           </div>
         </div>

         <div className="p-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl">
           <h3 className="font-display font-bold text-xl mb-6">Anti-Cheat Alert Frequency</h3>
           <div className="h-72">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={alertData.length > 0 ? alertData : [{time: 'Now', alerts: 0}]}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#2a2a42" vertical={false} />
                 <XAxis dataKey="time" stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <YAxis stroke="#8890a8" fontSize={12} tickLine={false} axisLine={false} />
                 <Tooltip contentStyle={{ backgroundColor: '#0f0f1a', borderColor: '#1e1e30', borderRadius: '8px' }} />
                 <Line type="monotone" dataKey="alerts" stroke="var(--red)" strokeWidth={3} dot={{r: 4, fill: "var(--red)"}} activeDot={{r: 6}} />
               </LineChart>
             </ResponsiveContainer>
           </div>
         </div>
      </div>
    </div>
  )
}






