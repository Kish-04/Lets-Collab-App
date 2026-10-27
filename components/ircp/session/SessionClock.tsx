"use client"

import { useEffect, useState } from "react"
import { formatDuration } from "@/lib/session/model"

// The session timer. It ticks once a second in its own small component, so the session page around
// it does not re-render every second.
export function SessionClock({ running }: { running: boolean }) {
    const [seconds, setSeconds] = useState(0)

    useEffect(() => {
        if (!running) return
        const startedAt = Date.now()
        const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
        return () => {
            window.clearInterval(timer)
            setSeconds(0)
        }
    }, [running])

    return <span>{formatDuration(seconds)}</span>
}
