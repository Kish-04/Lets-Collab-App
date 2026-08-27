"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Star } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { format, subDays, startOfDay, addWeeks, subWeeks, isAfter } from "date-fns"

export function ActivityHeatmap({ 
  sessions = [], 
  className 
}: { 
  sessions?: any[]
  className?: string 
}) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState<any>(null)
  
  // Custom tooltip state
  const [hoveredDay, setHoveredDay] = useState<{ day: any, x: number, y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 12 weeks = 84 days
  const today = startOfDay(new Date())
  const viewEndDate = subWeeks(today, weekOffset)
  const daysToShow = 84
  const startDate = subDays(viewEndDate, daysToShow - 1)

  // Map sessions to dates
  const sessionsByDate = sessions.reduce((acc: any, session: any) => {
    if (!session.startedAt) return acc
    const d = startOfDay(new Date(session.startedAt)).getTime()
    if (!acc[d]) acc[d] = []
    acc[d].push(session)
    return acc
  }, {})

  // Build grid data
  const heatmapData = Array.from({ length: daysToShow }).map((_, i) => {
    const date = addDays(startDate, i)
    const time = date.getTime()
    const daySessions = sessionsByDate[time] || []
    return {
      date,
      count: daySessions.length,
      sessions: daySessions
    }
  })

  // Group into columns (weeks)
  const weeks: typeof heatmapData[] = []
  for (let i = 0; i < heatmapData.length; i += 7) {
    weeks.push(heatmapData.slice(i, i + 7))
  }

  const getColor = (count: number) => {
    if (count === 0) return 'bg-[var(--surface)] border-[var(--border)]/50'
    if (count < 3) return 'bg-[#0ea5e9]/30 border-[#0ea5e9]/40' // Sky 500
    if (count < 8) return 'bg-[#3b82f6]/60 border-[#3b82f6]/70' // Blue 500
    if (count < 12) return 'bg-[#2563eb]/90 border-[#2563eb]'   // Blue 600
    return 'bg-[#1d4ed8] border-[#1e3a8a] shadow-[0_0_8px_rgba(37,99,235,0.6)]' // Blue 700
  }

  // Generate month labels
  const monthLabels: { label: string, offset: number }[] = []
  let currentMonth = -1
  weeks.forEach((week, idx) => {
    const month = week[0].date.getMonth()
    if (month !== currentMonth) {
      monthLabels.push({ label: format(week[0].date, 'MMM'), offset: idx })
      currentMonth = month
    }
  })

  const handleNext = () => { if (weekOffset > 0) setWeekOffset(weekOffset - 1) }
  const handlePrev = () => setWeekOffset(weekOffset + 1)

  return (
    <div className={cn("flex flex-col items-center", className)} ref={containerRef}>
      <div className="flex items-center gap-4 mb-3">
        <button 
          onClick={handlePrev} 
          className="p-1 rounded bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)] text-[var(--text-dim)] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="font-mono text-xs text-[var(--text-dim)] uppercase tracking-widest">
          {format(startDate, 'MMM d, yyyy')} - {format(viewEndDate, 'MMM d, yyyy')}
        </span>
        <button 
          onClick={handleNext} 
          disabled={weekOffset === 0}
          className="p-1 rounded bg-[var(--surface)] border border-[var(--border)] hover:bg-[var(--elevated)] hover:text-[var(--text-primary)] text-[var(--text-dim)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-2 p-4 bg-[var(--surface)]/50 border border-[var(--border)]/60 rounded-xl overflow-x-auto relative">
        {/* Days Y-axis */}
        <div className="flex flex-col gap-1 mt-[22px] text-[10px] text-[var(--text-dim)] font-mono leading-none justify-between h-[100px] pb-1 pr-1">
          <span>Mon</span>
          <span>Wed</span>
          <span>Fri</span>
        </div>

        <div className="flex flex-col">
          {/* Months X-axis */}
          <div className="flex text-[10px] text-[var(--text-dim)] font-mono mb-1.5 relative h-4">
            {monthLabels.map((m, idx) => (
              <span key={idx} className="absolute" style={{ left: `${m.offset * 16}px` }}>
                {m.label}
              </span>
            ))}
          </div>

          {/* Grid */}
          <div className="flex gap-1">
            {weeks.map((week, wIdx) => (
              <div key={wIdx} className="flex flex-col gap-1">
                {week.map((day, dIdx) => (
                  <div 
                    key={dIdx}
                    onClick={() => { if (day.count > 0) setSelectedDay(day) }}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setHoveredDay({ day, x: rect.left + window.scrollX + rect.width / 2, y: rect.top + window.scrollY - 10 })
                    }}
                    onMouseLeave={() => setHoveredDay(null)}
                    className={cn(
                      "w-[12px] h-[12px] rounded-[3px] border transition-all duration-200 cursor-pointer", 
                      getColor(day.count),
                      day.count === 0 ? "cursor-default hover:border-[var(--text-dim)]" : "hover:border-white hover:scale-125 hover:z-10 relative"
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Custom Portal Tooltip */}
      {hoveredDay && (
        <div 
          className="fixed z-[100] bg-[var(--elevated)] border border-[var(--border-bright)] text-[var(--text-primary)] px-3 py-2 shadow-xl rounded-md pointer-events-none transform -translate-x-1/2 -translate-y-full"
          style={{ left: hoveredDay.x, top: hoveredDay.y }}
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-dim)] uppercase">
              <span>{format(hoveredDay.day.date, 'EEEE')}</span>
              <span>•</span>
              <span className="text-[#3b82f6]">{format(hoveredDay.day.date, 'MMM d, yyyy')}</span>
            </div>
            <div className="flex items-center gap-1.5 font-display text-sm font-bold">
              {hoveredDay.day.count > 0 && <Star className="w-3 h-3 text-[#3b82f6] fill-[#3b82f6]" />}
              {hoveredDay.day.count === 0 ? "No activity" : `${hoveredDay.day.count} session${hoveredDay.day.count === 1 ? '' : 's'}`}
            </div>
          </div>
        </div>
      )}

      {/* Modal for Details */}
      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="bg-[var(--surface)] border-[var(--border)] text-[var(--text-primary)] max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Star className="w-5 h-5 text-[#3b82f6] fill-[#3b82f6]" />
              Activity on {selectedDay && format(selectedDay.date, 'MMMM d, yyyy')}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-[var(--text-dim)]">
              {selectedDay?.count} session{selectedDay?.count === 1 ? '' : 's'} recorded on this day.
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2 custom-scrollbar mt-4">
            {selectedDay?.sessions.map((session: any, idx: number) => (
              <div key={idx} className="p-4 rounded-xl border border-[var(--border)]/60 bg-[var(--elevated)]/50 hover:bg-[var(--elevated)] transition-colors flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-[var(--accent)] font-bold">
                    Room: {session.roomCode || 'UNKNOWN'}
                  </span>
                  <span className="text-xs text-[var(--text-dim)] font-mono">
                    {format(new Date(session.startedAt), 'h:mm a')} - {session.endedAt ? format(new Date(session.endedAt), 'h:mm a') : 'Active'}
                  </span>
                </div>
                <div className="text-sm">
                  <span className="text-[var(--text-dim)]">Host: </span>
                  <span className="text-[var(--text-secondary)]">{session.hostName || session.hostEmail || 'Unknown'}</span>
                </div>
                <div className="flex gap-4 text-xs font-mono mt-1">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[var(--violet)]" /> 
                    {session.participantCount || session.participants?.length || 0} participants
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={cn("w-2 h-2 rounded-full", (session.riskScore || 0) > 30 ? "bg-[var(--red)]" : "bg-[#3b82f6]")} />
                    Risk: {session.riskScore || 0}
                  </span>
                </div>
                
                {session.participants && session.participants.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]/30">
                    <span className="text-[10px] font-mono text-[var(--text-dim)] uppercase tracking-wider mb-2 block">Attendance Roster</span>
                    <div className="flex flex-col gap-2">
                      {session.participants.map((p: any, pIdx: number) => (
                        <div key={pIdx} className="flex justify-between items-center text-xs bg-[var(--surface)]/50 p-2 rounded-lg border border-[var(--border)]/40">
                          <span className="text-[var(--text-primary)] font-medium">{p.name || 'Anonymous User'}</span>
                          <span className="text-[var(--text-dim)] font-mono">{p.email || p.role || 'Guest'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}
