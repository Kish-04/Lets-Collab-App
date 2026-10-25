"use client"

// Shared data for the admin dashboard. The layout mounts this once, so moving between admin pages
// reuses one Socket.IO connection and one cached copy of /api/admin/reports instead of every page
// opening its own connection and downloading the report again. Pages render the cached copy at once
// and it refreshes in the background. Screen observation and the Exam Wall still open their own
// short-lived connection (the server ends an observation or media viewer only when its socket closes).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { io, type Socket } from "socket.io-client"
import { getAuthHeaders, getBackendUrl, getStoredAuthToken } from "@/lib/utils"
import { StatusBadge } from "@/components/ircp/shared"

export type AdminReports = {
  success: boolean
  userActivity?: any[]
  alerts?: any[]
  sessionHistory?: any[]
  activeSessions?: number
  generatedAt?: string
  mock?: boolean
}

type AdminData = {
  socket: Socket | null
  connected: boolean
  sessions: any[] | null
  reports: AdminReports | null
  reportsError: string
  reportsAt: number
  refreshReports: () => Promise<void>
}

const AdminDataContext = createContext<AdminData | null>(null)

// A report younger than this is shown without asking the server again
const REPORTS_FRESH_MS = 15000
// While the dashboard is open and visible, the report refreshes on its own this often
const REPORTS_REFRESH_MS = 60000

export function signOutAdmin() {
  for (const key of ["ircp_user", "ircp_name", "ircp_email", "ircp_role"]) localStorage.removeItem(key)
  window.location.href = "/admin/login"
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [sessions, setSessions] = useState<any[] | null>(null)
  const [reports, setReports] = useState<AdminReports | null>(null)
  const [reportsError, setReportsError] = useState("")
  const inFlight = useRef<Promise<void> | null>(null)
  const [reportsAt, setReportsAt] = useState(0)

  useEffect(() => {
    const token = getStoredAuthToken()
    if (!token) return
    const next = io(getBackendUrl(), { auth: { token }, withCredentials: true })
    const onConnect = () => {
      setConnected(true)
      next.emit("identify-user")
      next.emit("get-sessions")
    }
    next.on("connect", onConnect)
    next.on("disconnect", () => setConnected(false))
    next.on("sessions-update", (list: any[]) => setSessions(Array.isArray(list) ? list : []))
    setSocket(next)
    return () => {
      next.disconnect()
      setSocket(null)
    }
  }, [])

  const loadReports = useCallback(() => {
    // Several pages asking at once share one request
    if (inFlight.current) return inFlight.current
    inFlight.current = (async () => {
      try {
        const res = await fetch(`${getBackendUrl()}/api/admin/reports`, { credentials: "include", headers: getAuthHeaders() })
        if (res.status === 401 || res.status === 403) return signOutAdmin()
        if (!res.ok) throw new Error(`Server returned ${res.status} ${res.statusText}`)
        const data = await res.json()
        if (!data?.success) throw new Error(data?.message || "Failed to load the report")
        setReports(data)
        setReportsError("")
        setReportsAt(Date.now())
      } catch (err: any) {
        setReportsError(err?.message || String(err))
      } finally {
        inFlight.current = null
      }
    })()
    return inFlight.current
  }, [])

  // First load, then quiet refreshes while the tab is visible
  useEffect(() => {
    void loadReports()
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadReports()
    }, REPORTS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [loadReports])

  // New alerts change the report: refresh it soon after (several alerts in a burst cause one refresh)
  useEffect(() => {
    if (!socket) return
    let timer: number | undefined
    const onAlert = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void loadReports(), 3000)
    }
    socket.on("system-alert", onAlert)
    return () => {
      socket.off("system-alert", onAlert)
      window.clearTimeout(timer)
    }
  }, [socket, loadReports])

  return (
    <AdminDataContext.Provider value={{ socket, connected, sessions, reports, reportsError, reportsAt, refreshReports: loadReports }}>
      {children}
    </AdminDataContext.Provider>
  )
}

function useAdminData() {
  const value = useContext(AdminDataContext)
  if (!value) throw new Error("Admin pages must be inside AdminDataProvider (app/admin/layout.tsx)")
  return value
}

/** The dashboard's shared connection. Subscribe with useSocketEvent; never disconnect it from a page. */
export function useAdminSocket() {
  const { socket, connected } = useAdminData()
  return { socket, connected }
}

/** Live sessions as the server last sent them (null until the first update). */
export function useLiveSessions() {
  return useAdminData().sessions
}

/**
 * The cached admin report. A page opened within REPORTS_FRESH_MS of the last load shows it as is;
 * otherwise it shows the cached copy (if any) and refreshes in the background.
 */
export function useAdminReports() {
  const { reports, reportsError, reportsAt, refreshReports } = useAdminData()
  useEffect(() => {
    const stale = !reports || Date.now() - reportsAt > REPORTS_FRESH_MS
    if (stale) void refreshReports()
    // Only on page open: background refreshes are the provider's job
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { data: reports, error: reportsError, refresh: refreshReports }
}

/** Listens to one event on the shared connection while the calling page is open. */
export function useSocketEvent<T = any>(event: string, handler: (payload: T) => void) {
  const { socket } = useAdminData()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!socket) return
    const listener = (payload: T) => handlerRef.current(payload)
    socket.on(event, listener)
    return () => { socket.off(event, listener) }
  }, [socket, event])
}

/** Runs now if connected, and again after every reconnect (to re-request data a page needs). */
export function useOnAdminConnect(run: (socket: Socket) => void) {
  const { socket, connected } = useAdminData()
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (socket && connected) runRef.current(socket)
  }, [socket, connected])
}

/**
 * The sidebar's status badge, from the server's /health check (polled while the tab is visible)
 * and the dashboard's live connection, instead of a fixed "System Online".
 */
export function SystemStatus() {
  const { connected } = useAdminData()
  const [health, setHealth] = useState<{ ok: boolean; dbConnected?: boolean; blockchainActive?: boolean } | null>(null)
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    let stopped = false
    const check = async () => {
      if (document.visibilityState !== "visible") return
      try {
        const res = await fetch(`${getBackendUrl()}/health`, { cache: "no-store" })
        const data = await res.json()
        if (stopped) return
        setHealth(data)
        setUnreachable(!res.ok || !data?.ok)
      } catch {
        if (!stopped) setUnreachable(true)
      }
    }
    void check()
    const timer = window.setInterval(check, 30000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [])

  if (unreachable) return <StatusBadge status="high-risk" label="Server unreachable" />
  if (!health || !connected) return <StatusBadge status="connecting" label="Connecting…" />
  if (!health.dbConnected) return <StatusBadge status="warning" label="Database offline" />
  return (
    <span title={health.blockchainActive ? "Server, database and audit chain are up" : "Audit chain is not reachable; logs are kept off-chain"}>
      <StatusBadge status="live" label={health.blockchainActive ? "System Online" : "Online · chain off"} />
    </span>
  )
}
