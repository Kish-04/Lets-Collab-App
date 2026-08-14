"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { ArrowLeft, Clock, Monitor, Users, Wifi } from "lucide-react"
import { getBackendUrl, getAuthHeaders } from "@/lib/utils"

export interface RecentSession {
  roomCode: string
  mode: "collaboration" | "supervised"
  hostName?: string | null
  hostEmail?: string | null
  hostUserId?: string | null
  participantUserIds?: string[]
  status: "active" | "ended"
  startedAt: string
  endedAt: string | null
  durationSeconds?: number
  riskScore?: number
  alertCount?: number
  latestTxHash?: string | null
  federated?: any
  isHost?: boolean
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return ""
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDate(iso?: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export default function RecentSessionsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<RecentSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchRecent = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/sessions/recent`, {
          credentials: 'include',
          headers: getAuthHeaders(),
        })
        if (res.status === 401 || res.status === 403) {
          setError('Your session has expired. Please sign in again.')
          return
        }
        if (!res.ok) {
          throw new Error(`Server responded ${res.status}`)
        }
        const data = await res.json()
        setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      } catch (err: any) {
        if (err.name === 'TypeError' && /failed to fetch/i.test(err.message || '')) {
          setError('Network error: could not reach the session service. If this persists, check that the backend is running and CORS is allowed for this origin.')
        } else {
          setError(err.message || "Failed to load recent sessions")
        }
      } finally {
        setLoading(false)
      }
    }
    fetchRecent()
  }, [])

  const host = (s: RecentSession) => s.hostName || s.hostEmail || "Unknown host"
  const role = (s: RecentSession) =>
    s.isHost ? "Hosted by you" : "You joined as a controller"
  const isLive = (s: RecentSession) => s.status === "active"

  return (
    <div className="min-h-screen bg-[var(--background)] p-8 font-sans text-[var(--text-primary)]">
      <button
        onClick={() => router.push("/app")}
        className="mb-8 flex items-center gap-2 text-sm text-[var(--text-dim)] transition-colors hover:text-[var(--text-primary)]"
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

        {loading && (
          <p className="text-sm text-[var(--text-dim)]">Loading recent sessions…</p>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
            <p className="text-sm text-red-300">{error}</p>
          <p className="mt-2 text-sm text-[var(--text-dim)]">
            Recent sessions are scoped to your account. Sign in from the dashboard, then reload this page.
          </p>
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--emerald)]/10 text-[var(--emerald)]">
              <Monitor className="h-6 w-6" />
            </div>
            <h2 className="font-display text-xl font-bold">No recent sessions yet</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--text-dim)]">
              Create or join a room from the dashboard. Your session history will appear
              here once a room ends.
            </p>
            <button
              onClick={() => router.push("/app")}
              className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--elevated)]"
            >
              Go to dashboard
            </button>
          </div>
        )}

        {!loading && !error && sessions.length > 0 && (
          <ul className="space-y-4">
            {sessions.map((s) => {
              const live = isLive(s)
              return (
                <li
                  key={s.roomCode}
                  className={`flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          live
                            ? "border border-green-400/30 bg-green-400/10 text-green-300"
                            : "border border-[var(--emerald)]/20 bg-[var(--emerald)]/10 text-[var(--emerald)]"
                        }`}
                      >
                        {live && <Wifi className="h-3 w-3" />}
                        {live ? "Live" : s.mode === "supervised" ? "Supervised" : "Collaboration"}
                      </span>
                      <code className="font-mono text-sm font-semibold">
                        {s.roomCode}
                      </code>
                      <span
                        className={`inline-flex items-center gap-1 text-xs text-[var(--text-dim)]`}
                      >
                        <Users className="h-3 w-3" />
                        {role(s)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                      <span className="font-medium text-[var(--text-primary)]">
                        {host(s)}
                      </span>
                      <span className="text-[var(--text-dim)]">
                        Started {formatDate(s.startedAt)}
                      </span>
                      {s.endedAt && s.durationSeconds != null && (
                        <span className="text-[var(--text-dim)]">
                          Duration {formatDuration(s.durationSeconds)}
                        </span>
                      )}
                      {s.alertCount != null && s.alertCount > 0 && (
                        <span className="text-xs text-amber-300/80">
                          {s.alertCount} alert{s.alertCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {live && (
                    <button
                      onClick={() => router.push(`/session?room=${s.roomCode}`)}
                      className={`ml-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--elevated)]`}
                    >
                      Rejoin
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
