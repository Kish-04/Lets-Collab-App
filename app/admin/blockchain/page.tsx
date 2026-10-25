"use client"

import { useState, Fragment } from "react"
import { useAdminSocket, useOnAdminConnect, useSocketEvent } from "@/components/admin/AdminData"
import { Link2, ChevronDown, RefreshCw, Wifi, WifiOff } from "lucide-react"
import { DataCard, TxHash } from "@/components/ircp/shared"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────
type ChainLog = {
  txHash: string
  blockNumber: number
  sessionId: string
  hostId: string
  controllerId: string
  eventType: string
  timestamp: number   // unix seconds
  dataHash: string
}

type ChainData = {
  active: boolean
  logs: ChainLog[]
  totalCount: number
  contractAddress: string | null
  currentBlock?: number
  error?: string
  chain?: { chainId: number; name: string; explorer: string | null; explorerTxBaseUrl: string | null }
}

// ── Event type styling ────────────────────────────────────────────────────────
const eventStyles: Record<string, { bg: string; text: string; shadow: string }> = {
  ROOM_CREATED: { bg: "bg-[var(--emerald)]/20", text: "text-[var(--emerald)]", shadow: "drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]" },
  SESSION_START: { bg: "bg-[var(--emerald)]/20", text: "text-[var(--emerald)]", shadow: "drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]" },
  USER_JOINED: { bg: "bg-[var(--violet)]/20", text: "text-[var(--violet)]", shadow: "drop-shadow-[0_0_5px_rgba(139,92,246,0.5)]" },
  JOIN: { bg: "bg-[var(--violet)]/20", text: "text-[var(--violet)]", shadow: "drop-shadow-[0_0_5px_rgba(139,92,246,0.5)]" },
  PERMISSION_CHANGE: { bg: "bg-[var(--accent)]/20", text: "text-[var(--accent)]", shadow: "drop-shadow-[0_0_5px_rgba(0,255,255,0.5)]" },
  KILL_SWITCH: { bg: "bg-[var(--red)]/20", text: "text-[var(--red)]", shadow: "drop-shadow-[0_0_5px_rgba(244,63,94,0.5)]" },
  SESSION_END: { bg: "bg-[var(--elevated)]/80", text: "text-[var(--text-primary)]/", shadow: "" },
  ANTICHEAT_ALERT: { bg: "bg-[var(--amber)]/20", text: "text-[var(--amber)]", shadow: "drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]" },
}
// Names the server writes (server/index.js anchorEvent) share the styles above
Object.assign(eventStyles, {
  USER_LEFT: eventStyles.SESSION_END,
  ACCESS_REVOKED: eventStyles.PERMISSION_CHANGE,
  ADMIN_WARNING: eventStyles.ANTICHEAT_ALERT,
  SESSION_TERMINATED: eventStyles.KILL_SWITCH,
  SESSION_ARCHIVED: eventStyles.SESSION_END,
  AI_ANTI_CHEAT_ALERT: eventStyles.ANTICHEAT_ALERT,
  IDENTITY_MISMATCH: eventStyles.KILL_SWITCH,
  EVIDENCE_PURGED: eventStyles.KILL_SWITCH,
  FEDERATED_AGGREGATE: eventStyles.PERMISSION_CHANGE,
})
function getEventStyle(type: string) {
  return eventStyles[type] || { bg: "bg-[var(--elevated)]/80", text: "text-[var(--text-primary)]/", shadow: "" }
}

function formatTs(unix: number): string {
  if (!unix) return "—"
  return new Date(unix * 1000).toLocaleTimeString('en-US', { hour12: false })
}

function formatDate(unix: number): string {
  if (!unix) return "—"
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BlockchainPage() {
  const { socket } = useAdminSocket()
  const [chainData, setChainData] = useState<ChainData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [filterType, setFilterType] = useState<string>("all")
  const [lastSynced, setLastSynced] = useState<string>("")

  // Ask for the chain on the dashboard's shared connection (again after a reconnect)
  useOnAdminConnect(next => next.emit('query-chain'))

  // Not allowed or chain query failed: say so instead of "Querying blockchain…" forever
  useSocketEvent('admin-error', (message: string) => {
    setChainData(prev => ({ ...(prev || { active: false, logs: [], totalCount: 0, contractAddress: null }), error: String(message) }))
    setLoading(false)
    setSyncing(false)
  })

  useSocketEvent('chain-data', (data: ChainData) => {
    setChainData(data)
    setLoading(false)
    setSyncing(false)
    setLastSynced(new Date().toLocaleTimeString('en-US', { hour12: false }))
  })

  // A new audit transaction from host activity: fetch the chain again
  useSocketEvent('chain-log', () => socket?.emit('query-chain'))

  const handleSync = () => {
    if (syncing) return
    setSyncing(true)
    socket?.emit('query-chain')
  }

  // ── Derived data ────────────────────────────────────────────────────────
  const logs = chainData?.logs || []

  const allEventTypes = Array.from(new Set(logs.map(l => l.eventType)))

  const filtered = filterType === "all"
    ? logs
    : logs.filter(l => l.eventType === filterType)

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="font-display font-bold text-2xl text-[var(--text-primary)] flex items-center gap-3">
            <Link2 className="w-6 h-6 text-[var(--violet)] drop-shadow-[0_0_10px_rgba(139,92,246,0.8)]" />
            Blockchain Audit Trail
          </h1>
          <span className="px-2 py-1 rounded-md bg-[var(--violet)]/20 border border-[var(--violet)]/40 font-mono text-xs text-[var(--violet)] drop-shadow-[0_0_5px_rgba(139,92,246,0.3)] shadow-[0_0_15px_rgba(139,92,246,0.2)_inset]">
            {chainData?.chain?.name ? chainData.chain.name.toUpperCase() : loading ? "…" : "NO CHAIN"}
          </span>
          {/* Live / offline indicator */}
          {chainData && (
            chainData.active ? (
              <span className="flex items-center gap-1.5 text-xs text-[var(--emerald)] font-mono drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]">
                <Wifi className="w-3.5 h-3.5" /> CONNECTED
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-[var(--amber)] font-mono drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]">
                <WifiOff className="w-3.5 h-3.5" /> MOCK MODE
              </span>
            )
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || loading}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)]/60 bg-[var(--elevated)]/60 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)]/80 transition-all",
            (syncing || loading) && "opacity-50 cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync"}
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <DataCard
          label="Total Logged"
          value={loading ? "…" : (chainData?.totalCount ?? 0).toString()}
          color="violet"
        />
        <DataCard
          label="Current Block"
          value={loading ? "…" : chainData?.currentBlock ? `#${chainData.currentBlock.toLocaleString()}` : "—"}
        />
        <div className="p-5 bg-[var(--surface)]/70 border border-[var(--border)]/60 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.1)] hover:bg-[var(--surface)]/70 hover:border-[var(--border-bright)] transition-all duration-300">
          <span className="block font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-2">
            Contract Address
          </span>
          {loading ? (
            <span className="text-xs text-[var(--text-dim)] font-mono animate-pulse">Loading…</span>
          ) : chainData?.contractAddress ? (
            <TxHash hash={chainData.contractAddress} explorerUrl={chainData.chain?.explorer ? `${chainData.chain.explorer}/address/${chainData.contractAddress}` : null} />
          ) : (
            <span className="text-xs text-[var(--amber)] font-mono">Not deployed</span>
          )}
        </div>
        <DataCard
          label="Status"
          value={loading ? "…" : chainData?.active ? "LIVE" : "MOCK"}
          color={chainData?.active ? "emerald" : "amber"}
          trend={lastSynced ? `Last sync: ${lastSynced}` : "Connecting…"}
        />
      </div>

      {/* Mock mode warning */}
      {!loading && chainData && !chainData.active && (
        <div className="mb-6 px-4 py-3 rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/10 text-sm text-[var(--amber)] font-mono shadow-[0_0_15px_rgba(251,191,36,0.15)]">
          ⚠ The audit chain is not reachable from the server. New events are kept off-chain until it is, and no on-chain history can be shown.
        </div>
      )}

      {/* Error banner */}
      {chainData?.error && (
        <div className="mb-6 px-4 py-3 rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/10 text-sm text-[var(--red)] font-mono shadow-[0_0_15px_rgba(244,63,94,0.15)]">
          Error: {chainData.error}
        </div>
      )}

      {/* Event type filter pills */}
      {logs.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <button
            onClick={() => setFilterType("all")}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-mono uppercase transition-all duration-300 shadow-md",
              filterType === "all"
                ? "bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/50 drop-shadow-[0_0_5px_rgba(0,255,255,0.5)]"
                : "bg-[var(--elevated)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)]/80"
            )}
          >
            All ({logs.length})
          </button>
          {allEventTypes.map(type => {
            const style = getEventStyle(type)
            const count = logs.filter(l => l.eventType === type).length
            return (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-xs font-mono uppercase transition-all duration-300 border shadow-md",
                  filterType === type
                    ? `${style.bg} ${style.text} ${style.shadow} border-current ring-1 ring-current`
                    : "bg-[var(--elevated)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--elevated)]/80"
                )}
              >
                {type} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Logs Table */}
      <div className="bg-[var(--surface)]/70 border border-[var(--border)]/60 rounded-2xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        {loading ? (
          <div className="p-16 text-center">
            <RefreshCw className="w-8 h-8 text-[var(--accent)] animate-spin mx-auto mb-4 drop-shadow-[0_0_10px_rgba(0,255,255,0.5)]" />
            <p className="text-sm text-[var(--text-dim)] font-mono">Querying blockchain…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-[var(--text-dim)] font-mono text-sm">
            {logs.length === 0
              ? "No transactions yet — events will appear as sessions are created"
              : "No transactions match this filter"}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]/60 bg-[var(--elevated)]/60">
                {["Block #", "TX Hash", "Session", "Event Type", "Time", "Data"].map(h => (
                  <th key={h} className="px-5 py-4 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, i) => {
                const style = getEventStyle(log.eventType)
                const isExpanded = expandedRow === i

                return (
                  <Fragment key={`${log.txHash}-${i}`}>
                    <tr
                      onClick={() => setExpandedRow(isExpanded ? null : i)}
                      className="border-b border-[var(--border)] cursor-pointer transition-colors hover:bg-[var(--elevated)]"
                    >
                      <td className="px-5 py-4 font-mono text-sm text-[var(--text-secondary)] font-semibold">
                        {log.blockNumber ? log.blockNumber.toLocaleString() : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <TxHash hash={log.txHash} explorerUrl={/^0x[0-9a-fA-F]{64}$/.test(log.txHash) && chainData?.chain?.explorerTxBaseUrl ? `${chainData.chain.explorerTxBaseUrl}${log.txHash}` : null} />
                      </td>
                      <td className="px-5 py-4 font-mono text-sm text-[var(--text-primary)] font-medium">
                        {log.sessionId
                          ? `${log.sessionId.slice(0, 4)}·${log.sessionId.slice(4)}`
                          : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("px-2.5 py-1 rounded-md text-xs font-mono border border-current/20", style.bg, style.text, style.shadow)}>
                          {log.eventType}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-sm text-[var(--text-dim)]">
                        <div className="text-[var(--text-primary)]/">{formatTs(log.timestamp)}</div>
                        <div className="text-[10px] mt-1">{formatDate(log.timestamp)}</div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <ChevronDown className={cn(
                          "w-4 h-4 text-[var(--text-primary)]/ mx-auto transition-transform",
                          isExpanded && "rotate-180"
                        )} />
                      </td>
                    </tr>

                    {/* Expanded row — full log details */}
                    {isExpanded && (
                      <tr className="border-b border-[var(--border)]/60 bg-[var(--bg)]/70 shadow-inner">
                        <td colSpan={6} className="p-6">
                          <div className="grid grid-cols-2 gap-6">
                            {/* Left: structured fields */}
                            <div className="space-y-3">
                              {[
                                ["Session ID", log.sessionId || "—"],
                                ["Host ID", log.hostId || "—"],
                                ["Controller ID", log.controllerId || "—"],
                                ["Block", log.blockNumber?.toLocaleString() || "—"],
                                ["Unix Timestamp", log.timestamp?.toString() || "—"],
                              ].map(([label, val]) => (
                                <div key={label} className="flex gap-2 text-xs font-mono items-center bg-[var(--elevated)]/60 p-2 rounded-lg border border-[var(--border)]">
                                  <span className="text-[var(--text-dim)] w-32 shrink-0">{label}</span>
                                  <span className="text-[var(--text-primary)] truncate font-medium">{val}</span>
                                </div>
                              ))}
                            </div>

                            {/* Right: data hash */}
                            <div className="p-4 bg-[var(--surface)]/70 rounded-xl border border-[var(--border)]/60 shadow-[0_4px_16px_rgba(0,0,0,0.2)]">
                              <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-3 flex items-center gap-2">
                                <Link2 className="w-3 h-3 text-[var(--violet)]" /> Data Hash (keccak256)
                              </p>
                              <p className="font-mono text-sm text-[var(--violet)] break-all leading-relaxed drop-shadow-[0_0_8px_rgba(139,92,246,0.4)]">
                                {log.dataHash || "—"}
                              </p>
                              <p className="font-mono text-[10px] text-[var(--text-primary)]/ mt-4 border-t border-[var(--border)]/60 pt-3">
                                Hash of the original event payload — immutable proof of data integrity.
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <p className="text-center font-mono text-[10px] text-[var(--text-dim)] mt-6 bg-[var(--elevated)]/60 inline-block px-4 py-2 rounded-full border border-[var(--border)] shadow-inner">
        {chainData?.active
          ? "Session events are hashed with keccak256 and written to the audit contract; a written entry cannot be changed."
          : "Not connected to the audit chain: events are not being written on-chain right now."}
      </p>
    </div>
  )
}
