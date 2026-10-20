"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ShieldAlert } from "lucide-react"
import { cn, getAuthHeaders, getBackendUrl, getStoredAuthToken } from "@/lib/utils"

type MyAlert = {
  _id: string
  room: string
  event?: string
  message: string
  penalty: number
  createdAt?: string
  reviewStatus: "pending" | "upheld" | "dismissed" | "none"
  reviewNote: string | null
  appeal: { text: string; status: "open" | "accepted" | "rejected"; response?: string } | null
}

const STATUS_LABEL: Record<MyAlert["reviewStatus"], { text: string; tone: string }> = {
  pending: { text: "Awaiting review", tone: "bg-[var(--amber)]/15 text-[var(--amber)]" },
  upheld: { text: "Upheld", tone: "bg-[var(--red)]/15 text-[var(--red)]" },
  dismissed: { text: "Dismissed", tone: "bg-[var(--success)]/15 text-[var(--success)]" },
  none: { text: "Note only", tone: "bg-[var(--elevated)] text-[var(--text-secondary)]" },
}

function when(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  return isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

// A candidate's own proctoring flags: what was raised, how it was reviewed, and an appeal per flag.
export default function MyFlagsPage() {
  const router = useRouter()
  const [alerts, setAlerts] = useState<MyAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${getBackendUrl()}/api/reviews/mine`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || "Could not load your flags.")
      setAlerts(data.alerts)
    } catch (err: any) {
      setError(err.message || "Could not load your flags.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!getStoredAuthToken()) {
      router.push("/app")
      return
    }
    void load()
  }, [load, router])

  const appeal = async (alert: MyAlert) => {
    const text = (drafts[alert._id] || "").trim()
    if (text.length < 10) {
      setError("Explain what happened in at least 10 characters.")
      return
    }
    setBusy(alert._id)
    setError("")
    try {
      const res = await fetch(`${getBackendUrl()}/api/reviews/${encodeURIComponent(alert._id)}/appeal`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || "Could not submit the appeal.")
      setAlerts(prev => prev.map(item => (item._id === alert._id ? data.alert : item)))
    } catch (err: any) {
      setError(err.message || "Could not submit the appeal.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-10 text-[var(--text-primary)]">
      <div className="mx-auto max-w-3xl space-y-6">
        <button onClick={() => router.push("/app")} className="flex items-center gap-1.5 text-xs font-bold uppercase text-[var(--text-dim)] hover:text-[var(--text-primary)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
            <ShieldAlert className="h-6 w-6 text-[var(--accent)]" /> My proctoring flags
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Alerts raised about you during supervised sessions. A person reviews each one; if you think a flag is wrong, appeal it once with what happened.
          </p>
        </div>

        {error && <p role="alert" className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-sm text-[var(--red)]">{error}</p>}
        {loading && <p className="text-sm text-[var(--text-dim)]">Loading…</p>}
        {!loading && alerts.length === 0 && !error && (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-dim)]">No flags. Nothing was raised about you.</p>
        )}

        <ul className="space-y-4">
          {alerts.map(alert => {
            const status = STATUS_LABEL[alert.reviewStatus] || STATUS_LABEL.pending
            const canAppeal = !alert.appeal && alert.penalty > 0 && alert.reviewStatus !== "dismissed"
            return (
              <li key={alert._id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{alert.message}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--text-dim)]">room {alert.room} · {when(alert.createdAt)}{alert.penalty > 0 ? ` · −${alert.penalty} risk` : ""}</p>
                  </div>
                  <span className={cn("rounded px-2 py-0.5 text-xs font-bold", status.tone)}>{status.text}</span>
                </div>
                {alert.reviewNote && <p className="mt-3 text-sm text-[var(--text-secondary)]">Reviewer note: {alert.reviewNote}</p>}

                {alert.appeal && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-sm">
                    <p className="text-xs font-bold uppercase text-[var(--text-dim)]">Your appeal · {alert.appeal.status === "open" ? "waiting for a decision" : alert.appeal.status}</p>
                    <p className="mt-1 whitespace-pre-wrap">{alert.appeal.text}</p>
                    {alert.appeal.response && <p className="mt-2 text-[var(--text-secondary)]">Response: {alert.appeal.response}</p>}
                  </div>
                )}

                {canAppeal && (
                  <div className="mt-3">
                    <label htmlFor={`appeal-${alert._id}`} className="text-xs font-bold uppercase text-[var(--text-dim)]">Appeal this flag</label>
                    <textarea
                      id={`appeal-${alert._id}`}
                      value={drafts[alert._id] || ""}
                      onChange={event => setDrafts(prev => ({ ...prev, [alert._id]: event.target.value }))}
                      rows={3}
                      maxLength={2000}
                      placeholder="What happened? For example: my camera froze for a few seconds."
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      disabled={busy === alert._id}
                      onClick={() => void appeal(alert)}
                      className="mt-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
                    >
                      Submit appeal
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
