"use client"

// Silent exam monitor for administrators (supervised rooms only). One dedicated Socket.IO
// connection and one RTCPeerConnection per candidate: each candidate sends its camera and, when it
// is sharing, its screen. Nothing is shown to the host or the candidates; the server records every
// start and stop in the audit trail and in an admin-only log. Sending a message to the room is the
// one visible action and reveals the administrator's presence.
//
// Socket protocol (server/index.js):
//   emit  monitor-exam {roomId} + ack({ok, roomId, candidates:[{id,name,email}]} | {ok:false, error})
//   on    monitor-roster {roomId, candidates, ended?}
//   emit  request-controller-observation {roomId, targetId, silent:true}
//   on    observer-offer {offer, hostId, targetType:'controller', streams?:{camera?, screen?}}
//   emit  observer-answer {hostId, answer}; observer-ice-candidate {targetId, candidate}
//   on    observer-ice-candidate {candidate, fromId}; monitor-feed-unavailable {candidateId, reason}
//   emit  end-controller-observation {targetId}; stop-monitor-exam {roomId}
//   emit  admin-room-chat {roomId, text} + ack({ok, id} | {ok:false, error})
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { io, type Socket } from "socket.io-client"
import { AlertTriangle, EyeOff, Maximize2, Minimize2, RefreshCw, Send, Volume2, VolumeX, X } from "lucide-react"
import { RiskGauge } from "@/components/ircp/shared"
import { cn, fetchIceServers, getBackendUrl, getStoredAuthToken } from "@/lib/utils"
import { signOutAdmin } from "@/components/admin/AdminData"

export type MonitorCandidate = { id: string; name: string; email?: string | null }

export type MonitoredSession = {
  id: string
  host: string
  riskScore: number
  events?: Array<{ time: string; type: string; message: string }>
}

type Feed = {
  camera?: MediaStream
  screen?: MediaStream
  status: string
}

type StreamHint = { camera?: string; screen?: string }

const CHAT_LIMIT = 1000

function StreamVideo({ stream, muted = true, className, label }: { stream: MediaStream; muted?: boolean; className?: string; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (video.srcObject !== stream) video.srcObject = stream
    void video.play().catch(() => {})
  }, [stream])
  useEffect(() => {
    if (ref.current) ref.current.muted = muted
  }, [muted])
  return <video ref={ref} muted={muted} autoPlay playsInline aria-label={label} className={className} />
}

// Anti-cheat flags the server logged for this candidate ("Name: ..." or "[AI PROCTORING ALERT] Name: ...")
function flagCount(session: MonitoredSession, name: string) {
  return (session.events || []).filter(event =>
    event.type === "anticheat" && (event.message.startsWith(`${name}:`) || event.message.includes(`] ${name}:`)),
  ).length
}

function FeedView({ feed, name, large, muted }: { feed?: Feed; name: string; large?: boolean; muted: boolean }) {
  if (!feed?.camera && !feed?.screen) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-[var(--text-dim)]">
        {feed?.status || "Connecting…"}
      </div>
    )
  }
  if (feed.screen) {
    return (
      <div className="relative h-full w-full">
        <StreamVideo stream={feed.screen} label={`Screen of ${name}`} className="h-full w-full object-contain" />
        {feed.camera && (
          <StreamVideo
            stream={feed.camera}
            muted={muted}
            label={`Camera of ${name}`}
            className={cn(
              "absolute bottom-2 right-2 rounded-md border border-[var(--border)] bg-black object-cover shadow-lg",
              large ? "w-1/4 min-w-[160px]" : "w-1/3 min-w-[96px]",
            )}
          />
        )}
      </div>
    )
  }
  return <StreamVideo stream={feed.camera!} muted={muted} label={`Camera of ${name}`} className="h-full w-full object-contain" />
}

export function ExamMonitor({ session, onClose }: { session: MonitoredSession; onClose: () => void }) {
  const roomId = session.id
  const [candidates, setCandidates] = useState<MonitorCandidate[]>([])
  const [feeds, setFeeds] = useState<Record<string, Feed>>({})
  const [status, setStatus] = useState("Connecting to the monitor…")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [audible, setAudible] = useState(false)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [sent, setSent] = useState<Array<{ id: string; text: string; time: string }>>([])
  const [chatError, setChatError] = useState("")

  const socketRef = useRef<Socket | null>(null)
  const pcsRef = useRef(new Map<string, RTCPeerConnection>())
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>())
  const hintsRef = useRef(new Map<string, StreamHint>())
  const iceServersRef = useRef<RTCIceServer[]>([])
  const knownRef = useRef(new Set<string>())

  const updateFeed = useCallback((id: string, patch: Partial<Feed>) => {
    setFeeds(prev => ({ ...prev, [id]: { ...prev[id], status: prev[id]?.status ?? "", ...patch } }))
  }, [])

  const closeFeed = useCallback((id: string) => {
    pcsRef.current.get(id)?.close()
    pcsRef.current.delete(id)
    pendingIceRef.current.delete(id)
    hintsRef.current.delete(id)
  }, [])

  const requestFeed = useCallback((id: string) => {
    closeFeed(id)
    setFeeds(prev => ({ ...prev, [id]: { status: "Requesting camera and screen…" } }))
    socketRef.current?.emit("request-controller-observation", { roomId, targetId: id, silent: true })
  }, [closeFeed, roomId])

  const applyRoster = useCallback((list: MonitorCandidate[]) => {
    const next = new Set(list.map(c => c.id))
    knownRef.current.forEach((id) => {
      if (next.has(id)) return
      closeFeed(id)
      setFeeds(prev => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
    })
    list.forEach((c) => { if (!knownRef.current.has(c.id)) requestFeed(c.id) })
    knownRef.current = next
    setCandidates(list)
    setExpanded(current => (current && next.has(current) ? current : null))
  }, [closeFeed, requestFeed])

  useEffect(() => {
    const token = getStoredAuthToken()
    if (!token) {
      signOutAdmin()
      return
    }
    let disposed = false
    const pcs = pcsRef.current
    const connection = io(getBackendUrl(), { auth: { token }, withCredentials: true })
    socketRef.current = connection

    connection.on("connect", async () => {
      iceServersRef.current = await fetchIceServers().catch(() => [])
      if (disposed) return
      // A reconnect starts over: every feed is negotiated again on the new connection
      pcs.forEach(pc => pc.close())
      pcs.clear()
      knownRef.current = new Set()
      connection.emit("monitor-exam", { roomId }, (reply: { ok: boolean; error?: string; candidates?: MonitorCandidate[] }) => {
        if (disposed) return
        if (!reply?.ok) {
          setStatus(reply?.error || "Monitoring is not available for this session.")
          return
        }
        setStatus("")
        applyRoster(reply.candidates || [])
      })
    })
    connection.on("disconnect", () => { if (!disposed) setStatus("Connection lost; reconnecting…") })
    connection.on("monitor-roster", ({ roomId: rosterRoom, candidates: list, ended }: { roomId: string; candidates: MonitorCandidate[]; ended?: boolean }) => {
      if (rosterRoom !== roomId) return
      if (ended) setStatus("This session has ended.")
      applyRoster(list || [])
    })
    connection.on("monitor-feed-unavailable", ({ candidateId, reason }: { candidateId: string; reason?: string }) => {
      updateFeed(candidateId, { status: reason || "No camera or screen to show." })
    })
    connection.on("admin-error", (message: string) => setStatus(String(message || "")))
    connection.on("observer-offer", async ({ offer, hostId, targetType, streams }: {
      offer: RTCSessionDescriptionInit; hostId: string; targetType?: string; streams?: StreamHint
    }) => {
      if (targetType !== "controller" || !knownRef.current.has(hostId)) return
      pcs.get(hostId)?.close()
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })
      pcs.set(hostId, pc)
      hintsRef.current.set(hostId, streams || {})
      setFeeds(prev => ({ ...prev, [hostId]: { status: "Connecting…" } }))
      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track])
        const hint = hintsRef.current.get(hostId) || {}
        setFeeds((prev) => {
          const feed: Feed = { ...prev[hostId], status: "" }
          if (feed.camera?.id === stream.id || feed.screen?.id === stream.id) return prev
          const isScreen = hint.screen === stream.id
            || (hint.camera !== stream.id && !hint.screen && event.track.kind === "video" && !!feed.camera && feed.camera.id !== stream.id)
          if (isScreen) feed.screen = stream
          else if (!feed.camera) feed.camera = stream
          else feed.screen = stream
          feed.status = ""
          return { ...prev, [hostId]: feed }
        })
      }
      pc.onicecandidate = (event) => {
        if (event.candidate) connection.emit("observer-ice-candidate", { targetId: hostId, candidate: event.candidate })
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") updateFeed(hostId, { status: "Feed lost; use Reconnect.", camera: undefined, screen: undefined })
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const queued = pendingIceRef.current.get(hostId) || []
        pendingIceRef.current.delete(hostId)
        for (const candidate of queued) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        connection.emit("observer-answer", { hostId, answer })
      } catch {
        updateFeed(hostId, { status: "Could not connect to this candidate." })
      }
    })
    connection.on("observer-ice-candidate", async ({ candidate, fromId }: { candidate: RTCIceCandidateInit; fromId: string }) => {
      const pc = pcs.get(fromId)
      if (!pc || !pc.remoteDescription) {
        const queue = pendingIceRef.current.get(fromId) || []
        queue.push(candidate)
        pendingIceRef.current.set(fromId, queue)
        return
      }
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
    })

    return () => {
      disposed = true
      connection.emit("stop-monitor-exam", { roomId })
      pcs.forEach(pc => pc.close())
      pcs.clear()
      connection.disconnect()
      socketRef.current = null
    }
  }, [roomId, applyRoster, updateFeed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (expanded) setExpanded(null)
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expanded, onClose])

  const sendMessage = (event: FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    if (!revealed && !window.confirm("Sending this message shows \"Administrator\" to the examiner and every candidate, revealing that you are watching. Send it?")) return
    setRevealed(true)
    setSending(true)
    setChatError("")
    socketRef.current?.timeout(8000).emit("admin-room-chat", { roomId, text: body }, (err: Error | null, reply?: { ok: boolean; id?: string; error?: string }) => {
      setSending(false)
      if (err || !reply?.ok) {
        setChatError(reply?.error || "The message could not be sent.")
        return
      }
      setSent(prev => [...prev, { id: reply.id || String(Date.now()), text: body, time: new Date().toISOString() }].slice(-20))
      setText("")
    })
  }

  const expandedCandidate = candidates.find(c => c.id === expanded) || null

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[var(--bg)]" role="dialog" aria-modal="true" aria-label={`Silent monitor of room ${roomId}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-display font-bold text-[var(--text-primary)]">
            <EyeOff className="h-4 w-4 text-[var(--accent)]" /> Silent exam monitor
          </p>
          <p className="truncate text-xs text-[var(--text-secondary)]">
            Room {roomId} | Examiner {session.host} | {candidates.length} candidate{candidates.length === 1 ? "" : "s"} | Not shown to the examiner or candidates; recorded in the audit trail
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            Room risk <RiskGauge value={session.riskScore} size="small" />
          </div>
          <button onClick={onClose} aria-label="Close the monitor" className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--elevated)]">
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {status && <p className="border-b border-[var(--border)] bg-[var(--elevated)] px-6 py-2 text-xs text-[var(--text-secondary)]">{status}</p>}

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {candidates.length === 0 ? (
          <p className="p-16 text-center font-mono text-sm text-[var(--text-dim)]">No candidates in this exam yet. Tiles appear as candidates join.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {candidates.map((candidate) => {
              const feed = feeds[candidate.id]
              const flags = flagCount(session, candidate.name)
              return (
                <figure key={candidate.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  <div className="relative aspect-video bg-black">
                    <FeedView feed={feed} name={candidate.name} muted />
                  </div>
                  <figcaption className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{candidate.name}</p>
                      <p className="truncate text-[10px] text-[var(--text-dim)]">
                        {candidate.email || "No email"} | {feed?.screen ? "camera + screen" : feed?.camera ? "camera" : "no video"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        title="Room risk score; flags are this candidate's anti-cheat alerts"
                        className={cn(
                          "rounded px-2 py-0.5 font-mono text-[10px]",
                          session.riskScore >= 70 ? "bg-[var(--red)]/15 text-[var(--red)]" : session.riskScore >= 30 ? "bg-[var(--amber)]/15 text-[var(--amber)]" : "bg-[var(--elevated)] text-[var(--text-secondary)]",
                        )}
                      >
                        risk {session.riskScore}{flags ? ` | ${flags} flag${flags === 1 ? "" : "s"}` : ""}
                      </span>
                      <button onClick={() => requestFeed(candidate.id)} aria-label={`Reconnect feed of ${candidate.name}`} title="Reconnect (picks up a screen shared since)" className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--elevated)]">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setExpanded(candidate.id)} aria-label={`Expand ${candidate.name}`} title="Expand" className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--elevated)]">
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </figcaption>
                </figure>
              )
            })}
          </div>
        )}
      </main>

      <form onSubmit={sendMessage} className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:px-6">
        <p className="mb-2 flex items-center gap-2 text-xs text-[var(--amber)]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Sending a message reveals your presence: the examiner and every candidate see it from &quot;Administrator&quot;.
        </p>
        {sent.length > 0 && (
          <div className="mb-2 max-h-20 space-y-1 overflow-y-auto text-xs text-[var(--text-secondary)]">
            {sent.map(message => <p key={message.id} className="truncate"><span className="font-semibold text-[var(--text-primary)]">Administrator:</span> {message.text}</p>)}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={text}
            onChange={event => setText(event.target.value.slice(0, CHAT_LIMIT))}
            maxLength={CHAT_LIMIT}
            placeholder="Message the room as Administrator"
            aria-label="Message the room as Administrator"
            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button type="submit" disabled={!text.trim() || sending} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] disabled:opacity-40">
            <Send className="h-4 w-4" /> Send
          </button>
        </div>
        {chatError && <p className="mt-1 text-xs text-[var(--red)]">{chatError}</p>}
      </form>

      {expandedCandidate && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={`${expandedCandidate.name}, expanded`}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-[var(--text-primary)]">
            <p className="truncate font-semibold">{expandedCandidate.name} <span className="text-xs font-normal text-[var(--text-secondary)]">| risk {session.riskScore}</span></p>
            <div className="flex items-center gap-1">
              <button onClick={() => setAudible(value => !value)} aria-label={audible ? "Mute candidate audio" : "Listen to candidate audio"} className="rounded p-2 hover:bg-white/10">
                {audible ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </button>
              <button onClick={() => setExpanded(null)} aria-label="Back to the grid" className="rounded p-2 hover:bg-white/10">
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <FeedView feed={feeds[expandedCandidate.id]} name={expandedCandidate.name} large muted={!audible} />
          </div>
        </div>
      )}
    </div>
  )
}
