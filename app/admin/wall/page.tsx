"use client"

import { useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"
import { LayoutGrid } from "lucide-react"
import { cn, getBackendUrl, getStoredAuthToken } from "@/lib/utils"
import { createViewer, isSfuDisabled, type RemoteProducer } from "@/lib/sfuClient"

type LiveSession = { id: string; host: string; mode: string; controllerCount: number }
type Tile = { producerId: string; name: string; stream: MediaStream }

function VideoTile({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== tile.stream) {
      ref.current.srcObject = tile.stream
      void ref.current.play().catch(() => {})
    }
  }, [tile.stream])
  return (
    <figure className="overflow-hidden rounded-lg border border-[var(--border)] bg-black">
      <video ref={ref} muted playsInline autoPlay aria-label={`Camera of ${tile.name}`} className="aspect-video w-full object-cover" />
      <figcaption className="truncate px-2 py-1 text-xs text-[var(--text-secondary)] bg-[var(--surface)]">{tile.name}</figcaption>
    </figure>
  )
}

// Every candidate camera of one supervised exam in a grid, received from the exam media server
// (server/sfu.js): each candidate sends its camera once, however many proctors watch.
export default function ExamWallPage() {
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [roomId, setRoomId] = useState("")
  const [tiles, setTiles] = useState<Tile[]>([])
  const [status, setStatus] = useState("")
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const token = getStoredAuthToken()
    if (!token) return
    const socket = io(getBackendUrl(), { auth: { token }, withCredentials: true })
    socketRef.current = socket
    socket.on("connect", () => socket.emit("get-sessions"))
    socket.on("sessions-update", (list: any[]) => {
      setSessions(list.filter(session => session.mode === "supervised").map(session => ({
        id: session.id, host: session.host, mode: session.mode, controllerCount: session.controllerCount,
      })))
    })
    return () => { socket.disconnect(); socketRef.current = null }
  }, [])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || !roomId) return
    let cancelled = false
    let viewer: Awaited<ReturnType<typeof createViewer>> | null = null
    const watching = new Set<string>()
    setTiles([])
    setStatus("Connecting to the exam media server…")

    const add = async (producer: RemoteProducer) => {
      if (!viewer || cancelled || producer.kind !== "video" || watching.has(producer.producerId)) return
      watching.add(producer.producerId)
      try {
        const consumer = await viewer.watch(producer.producerId)
        if (cancelled) return consumer.close()
        setTiles(prev => [...prev, { producerId: producer.producerId, name: producer.name, stream: new MediaStream([consumer.track]) }])
      } catch (err: any) {
        watching.delete(producer.producerId)
        setStatus(`Could not show ${producer.name}: ${err?.message || err}`)
      }
    }
    const onNew = (producer: RemoteProducer & { roomCode: string }) => { if (producer.roomCode === roomId) void add(producer) }
    const onClosed = ({ producerId }: { producerId: string }) => {
      watching.delete(producerId)
      setTiles(prev => prev.filter(tile => tile.producerId !== producerId))
    }
    socket.on("sfu-new-producer", onNew)
    socket.on("sfu-producer-closed", onClosed)

    ;(async () => {
      try {
        viewer = await createViewer(socket, roomId)
        if (cancelled) return viewer.close()
        const producers = await viewer.list()
        setStatus(producers.length ? "" : "No candidate cameras yet; they appear here as candidates connect.")
        await Promise.all(producers.map(add))
      } catch (err: any) {
        setStatus(isSfuDisabled(err)
          ? "The exam media server is not enabled on this server (SFU_ENABLED). Use Live Sessions to view candidates one at a time."
          : `Could not open the exam wall: ${err?.message || err}`)
      }
    })()

    return () => {
      cancelled = true
      socket.off("sfu-new-producer", onNew)
      socket.off("sfu-producer-closed", onClosed)
      viewer?.close()
    }
  }, [roomId])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-[var(--text-primary)]">
          <LayoutGrid className="h-6 w-6 text-[var(--accent)]" /> Exam wall
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">Every candidate camera of a supervised exam at once, through the exam media server.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Live supervised exams">
        {sessions.length === 0 && <p className="text-sm text-[var(--text-dim)]">No supervised exam is live.</p>}
        {sessions.map(session => (
          <button
            key={session.id}
            onClick={() => setRoomId(session.id)}
            aria-pressed={roomId === session.id}
            className={cn("rounded-lg border px-3 py-2 text-left text-xs",
              roomId === session.id ? "border-transparent bg-[var(--accent)] text-black" : "border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]")}
          >
            <span className="block font-mono font-bold">{session.id}</span>
            {session.host} · {session.controllerCount} candidate(s)
          </button>
        ))}
      </div>

      {status && <p role="status" className="text-sm text-[var(--text-secondary)]">{status}</p>}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {tiles.map(tile => <VideoTile key={tile.producerId} tile={tile} />)}
      </div>
    </div>
  )
}
