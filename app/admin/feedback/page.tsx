"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MessageSquareHeart, RefreshCw, Star, Mail } from "lucide-react"
import { cn, getAuthHeaders, getBackendUrl } from "@/lib/utils"

type FeedbackItem = {
  _id: string
  name: string
  email: string
  role: string
  rating?: number
  problem: string
  improvement?: string
  contactOk: boolean
  userId?: string
  status: "new" | "read" | "planned" | "done"
  createdAt?: string
}

const STATUSES: FeedbackItem["status"][] = ["new", "read", "planned", "done"]
const STATUS_STYLE: Record<FeedbackItem["status"], string> = {
  new: "bg-[var(--accent)]/15 text-[var(--accent)]",
  read: "bg-[var(--elevated)] text-[var(--text-secondary)]",
  planned: "bg-[var(--amber)]/15 text-[var(--amber)]",
  done: "bg-[var(--emerald)]/15 text-[var(--emerald)]",
}

function when(value?: string) {
  if (!value) return ""
  const date = new Date(value)
  return isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
}

// What visitors sent from the landing page's "Help us improve" form
export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [averageRating, setAverageRating] = useState<number | null>(null)
  const [filter, setFilter] = useState<"all" | FeedbackItem["status"]>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`${getBackendUrl()}/api/feedback`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || "Could not load feedback.")
      setItems(data.items)
      setAverageRating(data.averageRating)
    } catch (err: any) {
      setError(err.message || "Could not load feedback.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const setStatus = async (item: FeedbackItem, status: FeedbackItem["status"]) => {
    setItems(prev => prev.map(entry => entry._id === item._id ? { ...entry, status } : entry))
    try {
      const res = await fetch(`${getBackendUrl()}/api/feedback/${encodeURIComponent(item._id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.message || "Could not update the status.")
    } catch (err: any) {
      setError(err.message || "Could not update the status.")
      setItems(prev => prev.map(entry => entry._id === item._id ? item : entry))
    }
  }

  const shown = useMemo(() => filter === "all" ? items : items.filter(item => item.status === filter), [items, filter])
  const unread = items.filter(item => item.status === "new").length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-[var(--text-primary)]">
            <MessageSquareHeart className="h-6 w-6 text-[var(--accent)]" /> Feedback
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {loading ? "Loading…" : `${items.length} response(s), ${unread} new${averageRating ? ` · average rating ${averageRating} / 5` : ""}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", ...STATUSES] as const).map(value => (
            <button key={value} onClick={() => setFilter(value)}
              className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold capitalize", filter === value ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]")}>
              {value}
            </button>
          ))}
          <button onClick={() => void load()} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-sm text-[var(--red)]">{error}</p>}

      {!loading && shown.length === 0 && !error && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-dim)]">No feedback here yet.</p>
      )}

      <ul className="space-y-4">
        {shown.map(item => (
          <li key={item._id} className={cn("rounded-xl border bg-[var(--surface)] p-5", item.status === "new" ? "border-[var(--accent)]/50" : "border-[var(--border)]")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--text-primary)]">
                  {item.name} <span className="font-normal text-[var(--text-dim)]">· {item.role}{item.userId ? " · signed in" : ""}</span>
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-[var(--text-dim)]">
                  {item.contactOk ? (
                    <a href={`mailto:${item.email}?subject=${encodeURIComponent("Your Let's Collab feedback")}`} className="flex items-center gap-1 text-[var(--accent)] hover:underline">
                      <Mail className="h-3 w-3" /> {item.email}
                    </a>
                  ) : (
                    <span title="Did not agree to be emailed">{item.email} (no contact)</span>
                  )}
                  <span>· {when(item.createdAt)}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                {item.rating ? (
                  <span className="flex items-center gap-0.5" aria-label={`${item.rating} out of 5`}>
                    {[1, 2, 3, 4, 5].map(value => <Star key={value} className={cn("h-3.5 w-3.5", value <= item.rating! ? "fill-[var(--amber)] text-[var(--amber)]" : "text-[var(--text-dim)]")} />)}
                  </span>
                ) : null}
                <select value={item.status} onChange={event => void setStatus(item, event.target.value as FeedbackItem["status"])}
                  aria-label="Status" className={cn("rounded px-2 py-1 font-mono text-xs capitalize border-0", STATUS_STYLE[item.status])}>
                  {STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
            </div>
            <p className="mt-4 text-xs font-bold uppercase text-[var(--text-dim)]">Problem</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-primary)]">{item.problem}</p>
            {item.improvement && (
              <>
                <p className="mt-3 text-xs font-bold uppercase text-[var(--text-dim)]">How we can improve</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-primary)]">{item.improvement}</p>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
