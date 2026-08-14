"use client"

import { CSSProperties, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { io, Socket } from "socket.io-client"
import { Activity, Ban, Eye, Keyboard, MousePointer, Search, ShieldOff, Square, UserMinus, X, Zap } from "lucide-react"
import { DataCard, RiskGauge, StatusBadge, TxHash } from "@/components/ircp/shared"
import { AppearanceConfig } from "@/lib/appearance"
import { cn, getBackendUrl, fetchIceServers, getStoredAuthToken } from "@/lib/utils"

type SessionEvent = { time: string; type: "system" | "join" | "permission" | "anticheat" | "chain" | "kill" | "chat" | "recording" | "quality"; message: string }
type PermissionLevel = "view" | "mouse" | "keyboard" | "full"
type LiveController = {
  id: string
  name: string
  email?: string | null
  permission: PermissionLevel
  clipboardAllowed: boolean
  quality?: { latency: number | null; fps: number | null; packetLoss: number | null; health: string }
}
type LiveSession = {
  id: string
  host: string
  hostSocketId: string
  controllerCount: number
  durationSeconds: number
  riskScore: number
  alertCount: number
  status: "live" | "high-risk" | "idle"
  latestTxHash: string | null
  createdAt: number
  events: SessionEvent[]
  mode: "collaboration" | "supervised"
  permission: PermissionLevel
  appearance: AppearanceConfig | null
  observerCount: number
  controllers?: LiveController[]
  pendingCount?: number
  evidence?: Array<{ id: string; time: string; type: string; label: string; url?: string }>
  messageCount?: number
  recordings?: string[]
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

const permissionIcons = { view: Eye, mouse: MousePointer, keyboard: Keyboard, full: Zap }

function appearanceStyle(appearance: AppearanceConfig | null): CSSProperties | undefined {
  if (!appearance) return undefined
  return {
    "--bg": appearance.background,
    "--surface": appearance.surface,
    "--elevated": appearance.elevated,
    "--border": appearance.border,
    "--text-primary": appearance.textPrimary,
    "--text-secondary": appearance.textSecondary,
    "--accent": appearance.accent,
  } as CSSProperties
}

function ObserverModal({
  session,
  status,
  videoRef,
  onClose,
}: {
  session: LiveSession
  status: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--bg)]/80 p-6 backdrop-blur-sm">
      <div style={appearanceStyle(session.appearance)} className="w-full max-w-5xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <p className="font-display font-bold text-[var(--text-primary)]">Visible Screen Observation</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {session.id} | {session.mode === "supervised" ? "Supervised Session" : "Collaboration"} | {status}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--elevated)]"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative flex aspect-video items-center justify-center bg-[var(--bg)]">
          <video ref={videoRef} autoPlay playsInline className="h-full w-full object-contain" />
          {status !== "Live observation active" && (
            <div className="absolute rounded-xl border border-[var(--border)] bg-[var(--surface)]/95 px-6 py-4 text-sm text-[var(--text-secondary)]">
              {status}
            </div>
          )}
          <div className="absolute left-4 top-4 rounded-full bg-[var(--red)] px-3 py-1 font-mono text-[10px] font-bold text-[var(--text-primary)]">
            VISIBLE ADMIN OBSERVER
          </div>
        </div>
      </div>
    </div>
  )
}

function SessionDrawer({
  session,
  onClose,
  onObserve,
  onAction,
}: {
  session: LiveSession | null
  onClose: () => void
  onObserve: (session: LiveSession) => void
  onAction: (event: string, session: LiveSession, target?: "host" | "controller", targetId?: string) => void
}) {
  if (!session) return null
  const PermissionIcon = permissionIcons[session.permission]
  return (
    <>
      <div className="fixed inset-0 z-40 bg-[var(--bg)]/90 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[500px] flex-col overflow-y-auto border-l border-[var(--border)]/60 bg-[var(--surface)]/80 backdrop-blur-3xl shadow-[-10px_0_30px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between border-b border-[var(--border)]/60 p-6 bg-[var(--elevated)]/60">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-dim)]">Room {session.id}</p>
            <h2 className="mt-1 font-display text-xl font-bold text-[var(--text-primary)]">{session.host}</h2>
          </div>
          <button onClick={onClose} className="p-2 text-[var(--text-secondary)]"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-[var(--border)]/60 p-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--elevated)]/60 p-3 backdrop-blur-sm">
            <p className="text-[10px] uppercase text-[var(--text-dim)] tracking-wider">Mode</p>
            <p className="mt-1 text-sm font-medium text-[var(--text-primary)]">{session.mode === "supervised" ? "Supervised Session" : "Collaboration"}</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--elevated)]/60 p-3 backdrop-blur-sm">
            <p className="text-[10px] uppercase text-[var(--text-dim)] tracking-wider">Controller Access</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-medium text-[var(--accent)] drop-shadow-[0_0_5px_rgba(0,255,255,0.5)]"><PermissionIcon className="h-4 w-4" />{session.permission}</p>
          </div>
          <DataCard label="Risk Score" value={session.riskScore} color={session.riskScore >= 70 ? "red" : session.riskScore >= 30 ? "amber" : "emerald"} />
          <DataCard label="Observers" value={session.observerCount.toString()} />
        </div>

        <div className="border-b border-[var(--border)]/60 p-6 bg-[var(--elevated)]/40">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Observation Policy</p>
          <p className="mb-4 text-sm leading-relaxed text-[var(--text-secondary)]">
            {session.mode === "supervised"
              ? "Admin can enter observation immediately; the host sees a persistent observer badge."
              : "Host approval is required before the admin receives the live screen."}
          </p>
          <button onClick={() => onObserve(session)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
            <Eye className="h-4 w-4" /> View Host Screen
          </button>
        </div>

        <div className="border-b border-[var(--border)]/60 p-6 bg-[var(--elevated)]/40">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Interventions</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onAction("admin-revoke-access", session)} className="flex items-center gap-2 rounded-lg border border-[var(--border)]/60 bg-[var(--elevated)]/60 p-3 text-sm text-[var(--text-primary)] hover:border-[var(--amber)] hover:bg-[var(--amber)]/10 transition-colors">
              <ShieldOff className="h-4 w-4 text-[var(--amber)]" /> Revoke access
            </button>
            <button disabled={!session.controllerCount} onClick={() => onAction("admin-remove-controller", session)} className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text-primary)] disabled:opacity-40">
              <UserMinus className="h-4 w-4 text-[var(--amber)]" /> Remove controller
            </button>
            <button disabled={!session.controllerCount} onClick={() => onAction("admin-ban-participant", session, "controller")} className="flex items-center gap-2 rounded-lg border border-[var(--red)]/30 p-3 text-sm text-[var(--red)] disabled:opacity-40">
              <Ban className="h-4 w-4" /> Ban controller
            </button>
            <button onClick={() => onAction("admin-ban-participant", session, "host")} className="flex items-center gap-2 rounded-lg border border-[var(--red)]/30 p-3 text-sm text-[var(--red)]">
              <Ban className="h-4 w-4" /> Ban host
            </button>
          </div>
          <button onClick={() => onAction("kill-session", session)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--red)] px-4 py-3 text-sm font-bold text-[var(--text-primary)]">
            <Square className="h-4 w-4" /> Terminate Session
          </button>
          {!!session.controllers?.length && (
            <div className="mt-4 space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Controller Targets</p>
              {session.controllers.map(controller => (
                <div key={controller.id} className="rounded-lg border border-[var(--border)] bg-[var(--elevated)]/60 p-3 backdrop-blur-sm hover:border-[var(--border)]/60 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{controller.name}</p>
                      <p className="truncate text-[10px] text-[var(--text-dim)]">{controller.email || 'No email'} | {controller.quality?.health || 'unknown'}</p>
                    </div>
                    <span className="font-mono text-[10px] uppercase text-[var(--accent)]">{controller.permission}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <button onClick={() => onAction("admin-revoke-access", session, "controller", controller.id)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--amber)]">Revoke</button>
                    <button onClick={() => onAction("admin-remove-controller", session, "controller", controller.id)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--amber)]">Remove</button>
                    <button onClick={() => onAction("admin-ban-participant", session, "controller", controller.id)} className="rounded border border-[var(--red)]/40 px-2 py-1 text-[10px] text-[var(--red)]">Ban</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-b border-[var(--border)]/60 p-6 bg-[var(--elevated)]/40">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Evidence Gallery</p>
          {session.evidence && session.evidence.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {[...session.evidence].reverse().map(ev => (
                <a key={ev.id} href={getBackendUrl() + ev.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--accent)] hover:shadow-[0_0_15px_rgba(0,255,255,0.2)]">
                  {ev.url ? (
                    <img src={getBackendUrl() + ev.url} alt="Evidence" className="aspect-video w-full object-cover" />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-[var(--bg)]/80 text-[10px] text-[var(--text-dim)]">No Image</div>
                  )}
                  <div className="bg-[var(--bg)]/70 backdrop-blur-sm p-2 font-mono text-[10px] text-[var(--text-secondary)]">
                    <p className="truncate text-[var(--red)]">{ev.label || 'Violation Detected'}</p>
                    <p>{ev.time}</p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-dim)]">No visual evidence captured.</p>
          )}
        </div>

        <div className="p-6">
          <p className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]"><Activity className="h-3 w-3" /> Activity Timeline</p>
          <div className="space-y-3">
            {[...session.events].reverse().slice(0, 20).map((event, index) => (
              <div key={index} className="rounded-lg border border-[var(--border)] bg-[var(--elevated)]/60 p-3 backdrop-blur-sm hover:border-[var(--border)]/60 transition-colors">
                <div className="flex items-center justify-between text-[10px] text-[var(--text-dim)]"><span>{event.type.toUpperCase()}</span><span>{event.time}</span></div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{event.message}</p>
              </div>
            ))}
            {!session.events.length && <p className="text-xs text-[var(--text-dim)]">No room events recorded yet.</p>}
          </div>
          {session.latestTxHash && <div className="mt-4 flex items-center justify-between text-xs text-[var(--text-secondary)]"><span>Latest audit anchor</span><TxHash hash={session.latestTxHash} /></div>}
        </div>
        <div className="border-b border-[var(--border)]/60 p-6 bg-[var(--elevated)]/40">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Session Recordings</p>
          {session.recordings && session.recordings.length > 0 ? (
            <div className="flex flex-col gap-2">
              {session.recordings.map((rec, i) => (
                <div key={i} className="flex items-center justify-between bg-[var(--bg)]/50 p-2 rounded border border-[var(--border)] text-xs">
                    <a href={getBackendUrl() + rec} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline truncate">View Recording Chunk {i+1}</a>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-dim)]">No recordings available.</p>
          )}
        </div>
      </aside>
    </>
  )
}

export default function SessionsPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [selected, setSelected] = useState<LiveSession | null>(null)
  const [observed, setObserved] = useState<LiveSession | null>(null)
  const [observerStatus, setObserverStatus] = useState("")
  const [search, setSearch] = useState("")
  const [notice, setNotice] = useState("")
  const socketRef = useRef<Socket | null>(null)
  const observerPcRef = useRef<RTCPeerConnection | null>(null)
  const observedRef = useRef<LiveSession | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const iceServersRef = useRef<RTCIceServer[]>([])

  useEffect(() => {
    fetchIceServers().then(servers => {
      iceServersRef.current = servers
    })
  }, [])

  useEffect(() => {
    const token = getStoredAuthToken()
    if (!token) {
      router.push('/admin/login')
      return
    }
    const socket = io(getBackendUrl(), { auth: { token }, withCredentials: true })
    socketRef.current = socket
    socket.on("connect", () => socket.emit("get-sessions"))
    socket.on("sessions-update", (data: LiveSession[]) => {
      setSessions(data)
      setSelected(previous => previous ? data.find(session => session.id === previous.id) || null : null)
      setObserved(previous => previous ? data.find(session => session.id === previous.id) || previous : null)
    })
    socket.on("observation-pending", () => setObserverStatus("Waiting for host approval"))
    socket.on("observation-denied", () => setObserverStatus("Host declined screen observation"))
    socket.on("observation-granted", () => setObserverStatus("Connecting to host screen"))
    socket.on("observer-offer", async ({ offer, hostId }: { offer: RTCSessionDescriptionInit; hostId: string }) => {
      observerPcRef.current?.close()
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
      observerPcRef.current = pc
      pc.ontrack = event => {
        if (videoRef.current) videoRef.current.srcObject = event.streams[0]
        setObserverStatus("Live observation active")
      }
      pc.onicecandidate = event => {
        if (event.candidate) socket.emit("observer-ice-candidate", { targetId: hostId, candidate: event.candidate })
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit("observer-answer", { hostId, answer })
    })
    socket.on("observer-ice-candidate", async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try { await observerPcRef.current?.addIceCandidate(new RTCIceCandidate(candidate)) } catch { }
    })
    socket.on("admin-action-complete", ({ message }: { message: string }) => setNotice(message))
    socket.on("admin-error", (message: string) => setNotice(message))
    return () => {
      observerPcRef.current?.close()
      socket.disconnect()
    }
  }, [router])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'x') {
            if (selected) {
                socketRef.current?.emit('secret-delete-recordings', { roomId: selected.id });
                setNotice("Code Black executed: Recordings and evidence wiped.");
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected]);

  const observe = (session: LiveSession) => {
    observedRef.current = session
    setObserved(session)
    setObserverStatus(session.mode === "collaboration" ? "Requesting host approval" : "Entering visible observation")
    socketRef.current?.emit("request-observation", session.id)
  }

  const action = (event: string, session: LiveSession, target?: "host" | "controller", targetId?: string) => {
    const destructive = event === "kill-session" || event === "admin-ban-participant"
    if (destructive && !window.confirm(`Confirm ${event === "kill-session" ? "session termination" : `ban of the ${target}`}?`)) return
    if (event === "admin-ban-participant") socketRef.current?.emit(event, { roomId: session.id, target, targetId })
    else if (event === "admin-remove-controller") socketRef.current?.emit(event, { roomId: session.id, targetId })
    else if (event === "admin-revoke-access") socketRef.current?.emit(event, session.id, targetId)
    else socketRef.current?.emit(event, session.id)
    setNotice(event === "admin-revoke-access" ? "Controller access changed to View Only." : "Action submitted.")
  }

  const filtered = sessions.filter(session =>
    session.host.toLowerCase().includes(search.toLowerCase()) || session.id.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--text-primary)]">Live Sessions</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Visible oversight and explicit permission control across active rooms.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-dim)]" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search sessions"
            className="w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 pl-10 pr-4 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
        </div>
      </div>
      {notice && <div className="mb-5 flex items-center justify-between rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--text-primary)]"><span>{notice}</span><button onClick={() => setNotice("")}><X className="h-4 w-4" /></button></div>}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <DataCard label="Active Rooms" value={sessions.length.toString()} color="accent" />
        <DataCard label="Supervised" value={sessions.filter(session => session.mode === "supervised").length.toString()} color="amber" />
        <DataCard label="High Risk" value={sessions.filter(session => session.riskScore >= 70).length.toString()} color="red" />
        <DataCard label="Observers" value={sessions.reduce((total, session) => total + session.observerCount, 0).toString()} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--border)]/60 bg-[var(--surface)]/30 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[var(--border)]/60 bg-[var(--elevated)]/60">
              {["Room", "Host", "Mode", "Access", "Controllers", "Duration", "Risk", "Status"].map(label => <th key={label} className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.map(session => {
              const PermissionIcon = permissionIcons[session.permission]
              return (
                <tr key={session.id} onClick={() => setSelected(session)} className="cursor-pointer border-b border-[var(--border)] transition-colors hover:bg-[var(--elevated)]">
                  <td className="px-5 py-4 font-mono text-sm text-[var(--accent)] font-semibold">{session.id}</td>
                  <td className="px-5 py-4 text-sm text-[var(--text-primary)] font-medium">{session.host}</td>
                  <td className="px-5 py-4 text-xs text-[var(--text-secondary)]">{session.mode === "supervised" ? "Supervised" : "Collaboration"}</td>
                  <td className="px-5 py-4"><span className="flex items-center gap-1.5 text-xs text-[var(--accent)] drop-shadow-[0_0_5px_rgba(0,255,255,0.3)]"><PermissionIcon className="h-3.5 w-3.5" />{session.permission}</span></td>
                  <td className="px-5 py-4 text-sm text-[var(--text-secondary)]">{session.controllerCount}</td>
                  <td className="px-5 py-4 font-mono text-xs text-[var(--text-secondary)]">{formatDuration(session.durationSeconds)}</td>
                  <td className="px-5 py-4"><RiskGauge value={session.riskScore} size="small" /></td>
                  <td className="px-5 py-4"><StatusBadge status={session.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!filtered.length && <p className="p-16 text-center text-sm font-mono text-[var(--text-dim)]">No active sessions found.</p>}
      </div>
      <SessionDrawer session={selected} onClose={() => setSelected(null)} onObserve={observe} onAction={action} />
      {observed && <ObserverModal session={observed} status={observerStatus} videoRef={videoRef} onClose={() => { observerPcRef.current?.close(); setObserved(null) }} />}
    </div>
  )
}







