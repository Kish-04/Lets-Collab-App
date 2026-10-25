"use client"

import { useCallback, useEffect, useState } from "react"
import { Scale, RefreshCw, CheckCircle, XCircle, MessageSquareWarning } from "lucide-react"
import { cn, getAuthHeaders, getBackendUrl } from "@/lib/utils"

type QueueItem = {
  _id: string
  room: string
  event?: string
  message: string
  penalty: number
  evidenceUrl?: string | null
  createdAt?: string
  candidate: string | null
  reviewStatus: string
  appeal: { text: string; createdAt: string; status: string } | null
}

function when(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  return isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

// Human review of proctoring alerts: uphold or dismiss each flag, and answer student appeals.
// Dismissing (or accepting an appeal) also teaches the on-device model that this was a false positive.
export default function ReviewQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${getBackendUrl()}/api/reviews/queue`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || "Could not load the review queue.")
      setItems(data.alerts)
    } catch (err: any) {
      setError(err.message || "Could not load the review queue.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const decide = async (item: QueueItem, path: "decision" | "appeal-decision", decision: string) => {
    const text = (drafts[item._id] || "").trim()
    if (path === "appeal-decision" && !text) {
      setError("Write a response the student will see before deciding the appeal.")
      return
    }
    setBusy(item._id)
    setError("")
    try {
      const body = path === "decision" ? { decision, note: text } : { decision, response: text }
      const res = await fetch(`${getBackendUrl()}/api/reviews/${encodeURIComponent(item._id)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || "Could not save the decision.")
      setItems(prev => prev.filter(entry => entry._id !== item._id))
    } catch (err: any) {
      setError(err.message || "Could not save the decision.")
    } finally {
      setBusy(null)
    }
  }

  const appeals = items.filter(item => item.appeal?.status === "open").length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-[var(--text-primary)]">
            <Scale className="h-6 w-6 text-[var(--accent)]" /> Review queue
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {loading ? "Loading…" : `${items.length} flag(s) waiting, ${appeals} with an open appeal. Dismissing a flag also trains the model that it was a false positive.`}
          </p>
        </div>
        <button onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-sm text-[var(--red)]">{error}</p>}

      {!loading && items.length === 0 && !error && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-dim)]">Nothing to review.</p>
      )}

      <ul className="space-y-4">
        {items.map(item => {
          const appealOpen = item.appeal?.status === "open"
          return (
            <li key={item._id} className={cn("rounded-xl border bg-[var(--surface)] p-5", appealOpen ? "border-[var(--amber)]/60" : "border-[var(--border)]")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--text-primary)]">{item.message}</p>
                  <p className="mt-1 font-mono text-xs text-[var(--text-dim)]">
                    {item.candidate || "unknown candidate"} · room {item.room} · {item.event || "alert"} · {when(item.createdAt)}
                  </p>
                </div>
                <span className="flex items-center gap-2">
                  {item.evidenceUrl && (
                    <a href={item.evidenceUrl.startsWith("http") ? item.evidenceUrl : `${getBackendUrl()}${item.evidenceUrl}`} target="_blank" rel="noreferrer"
                      className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10">
                      Evidence
                    </a>
                  )}
                  <span className="rounded bg-[var(--red)]/15 px-2 py-0.5 font-mono text-xs text-[var(--red)]">+{item.penalty} risk</span>
                </span>
              </div>

              {appealOpen && (
                <div className="mt-4 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase text-[var(--amber)]">
                    <MessageSquareWarning className="h-3.5 w-3.5" /> Appeal · {when(item.appeal!.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-primary)]">{item.appeal!.text}</p>
                </div>
              )}

              <label className="mt-4 block text-xs font-bold uppercase text-[var(--text-dim)]" htmlFor={`note-${item._id}`}>
                {appealOpen ? "Response to the student (required)" : "Note (optional, the student can see it)"}
              </label>
              <textarea
                id={`note-${item._id}`}
                value={drafts[item._id] || ""}
                onChange={event => setDrafts(prev => ({ ...prev, [item._id]: event.target.value }))}
                rows={2}
                maxLength={1000}
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={busy === item._id}
                  onClick={() => void decide(item, appealOpen ? "appeal-decision" : "decision", appealOpen ? "accepted" : "dismissed")}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--success)] px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
                >
                  <CheckCircle className="h-3.5 w-3.5" /> {appealOpen ? "Accept appeal (dismiss flag)" : "Dismiss (false positive)"}
                </button>
                <button
                  disabled={busy === item._id}
                  onClick={() => void decide(item, appealOpen ? "appeal-decision" : "decision", appealOpen ? "rejected" : "upheld")}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--red)]/50 px-3 py-2 text-xs font-bold text-[var(--red)] disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> {appealOpen ? "Reject appeal (keep flag)" : "Uphold flag"}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
