"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, Clock, Monitor, ShieldAlert } from "lucide-react"

export default function RecentSessionsPage() {
  const router = useRouter()

  // For phase 1, just a placeholder UI for the recently added route
  const recentSessions = [
    { id: "DV7X5ZLA", mode: "supervised", time: "2 hours ago", role: "host" },
    { id: "SUY2MSH2", mode: "supervised", time: "5 hours ago", role: "host" },
    { id: "KJFQAB8S", mode: "collaboration", time: "1 day ago", role: "controller" },
  ]

  return (
    <div className="min-h-screen bg-[var(--background)] p-8 font-sans text-[var(--text-primary)]">
      <button 
        onClick={() => router.push('/')}
        className="flex items-center gap-2 text-sm text-[var(--text-dim)] hover:text-white transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Home
      </button>

      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[var(--emerald)]/10 border border-[var(--emerald)]/20 flex items-center justify-center text-[var(--emerald)]">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold">Recent Sessions</h1>
            <p className="text-[var(--text-dim)]">Review or rejoin your past rooms</p>
          </div>
        </div>

        <div className="grid gap-4">
          {recentSessions.map(session => (
            <div key={session.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex items-center justify-between hover:border-[var(--emerald)]/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${session.mode === 'supervised' ? 'bg-[var(--amber)]/10 text-[var(--amber)]' : 'bg-[var(--blue)]/10 text-[var(--blue)]'}`}>
                  {session.mode === 'supervised' ? <ShieldAlert className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold text-lg tracking-wider font-mono">{session.id}</h3>
                  <p className="text-sm text-[var(--text-dim)] capitalize">{session.mode} • {session.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-sm text-[var(--text-dim)]">{session.time}</span>
                <button className="px-4 py-2 bg-[var(--emerald)]/10 text-[var(--emerald)] font-bold rounded-lg hover:bg-[var(--emerald)] hover:text-black transition-colors">
                  Details
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
