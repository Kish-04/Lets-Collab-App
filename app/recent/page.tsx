"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, Clock, Monitor } from "lucide-react"

export default function RecentSessionsPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[var(--background)] p-8 font-sans text-[var(--text-primary)]">
      <button
        onClick={() => router.push("/app")}
        className="mb-8 flex items-center gap-2 text-sm text-[var(--text-dim)] transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Home
      </button>

      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--emerald)]/20 bg-[var(--emerald)]/10 text-[var(--emerald)]">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold">Recent Sessions</h1>
            <p className="text-[var(--text-dim)]">Review or rejoin your past rooms</p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--emerald)]/10 text-[var(--emerald)]">
            <Monitor className="h-6 w-6" />
          </div>
          <h2 className="font-display text-xl font-bold">No recent-session source is connected</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-dim)]">
            User-scoped recent sessions are not exposed by the backend yet. Create or join a room from the dashboard, or use admin reports for archived session history.
          </p>
        </div>
      </div>
    </div>
  )
}
