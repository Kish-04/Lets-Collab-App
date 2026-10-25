"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getAuthHeaders, getBackendUrl } from "@/lib/utils"

// A student who opened the course activity before the instructor started the exam waits here and
// joins as soon as the room is open.
function Waiting() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const link = searchParams.get("link") || ""
  const title = searchParams.get("title") || "your exam"
  const [status, setStatus] = useState("Waiting for your instructor to open the exam…")

  useEffect(() => {
    if (!link) {
      setStatus("This link is incomplete. Open the activity from your course again.")
      return
    }
    let stopped = false
    const check = async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/lti/room?link=${encodeURIComponent(link)}`, { headers: getAuthHeaders() })
        if (res.status === 401 || res.status === 403) {
          setStatus("Your sign-in expired. Open the activity from your course again.")
          stopped = true
          return
        }
        const data = await res.json()
        if (data.roomCode && !stopped) {
          stopped = true
          router.replace(`/session?room=${encodeURIComponent(data.roomCode)}`)
        }
      } catch {
        setStatus("Cannot reach the exam server; still trying…")
      }
    }
    void check()
    const timer = window.setInterval(() => { if (!stopped) void check() }, 3000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [link, router])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--bg)] p-6 text-center text-[var(--text-primary)]">
      <h1 className="font-display text-xl font-bold">{title}</h1>
      <p role="status" aria-live="polite" className="text-sm text-[var(--text-secondary)]">{status}</p>
      <p className="text-xs text-[var(--text-dim)]">This page joins automatically; keep it open.</p>
    </main>
  )
}

export default function LtiWaitingPage() {
  return (
    <Suspense fallback={null}>
      <Waiting />
    </Suspense>
  )
}
