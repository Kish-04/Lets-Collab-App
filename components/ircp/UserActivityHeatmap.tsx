"use client"

import { useState, useRef } from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Clock, Star } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { format, subDays, startOfDay, subWeeks } from "date-fns"

export function UserActivityHeatmap({ 
  userEmail,
  allSessions = [], 
  className 
}: { 
  userEmail: string
  allSessions?: any[]
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

  // Filter sessions where this user was a participant or host
  const userSessions = allSessions.filter(s => {
    const isHost = s.hostEmail === userEmail
    const isParticipant = s.participants?.some((p: any) => p.email === userEmail)
    return isHost || isParticipant
  })

  // Map user sessions to dates
  const sessionsByDate = userSessions.reduce((acc: any, session: any) => {
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
    
    // Calculate total time spent in minutes
    const totalMinutes = daySessions.reduce((sum: number, s: any) => {
      // Use durationSeconds if available, else fallback to 45 mins
      return sum + (s.durationSeconds ? Math.round(s.durationSeconds / 60) : 45)
    }, 0)

    return {
      date,
      count: daySessions.length,
      minutes: totalMinutes,
      sessions: daySessions
    }
  })

  // Group into columns (weeks)
  const weeks: typeof heatmapData[] = []
  for (let i = 0; i < heatmapData.length; i += 7) {
    weeks.push(heatmapData.slice(i, i + 7))
  }

  // GitHub style Blue color scale based on MINUTES spent
  const getColor = (minutes: number) => {
    if (minutes === 0) return 'bg-[var(--surface)] border-[var(--border)]/50'
    if (minutes < 30) return 'bg-[#0ea5e9]/30 border-[#0ea5e9]/40' // Sky 500
    if (minutes < 60) return 'bg-[#3b82f6]/60 border-[#3b82f6]/70' // Blue 500
    if (minutes < 120) return 'bg-[#2563eb]/90 border-[#2563eb]'   // Blue 600
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
    <div className={cn("flex flex-col w-full", className)} ref={containerRef}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--text-dim)] flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" /> Participation Heatmap
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={handlePrev} className="p-1 rounded bg-[var(--surface)] border hover:bg-[var(--elevated)] hover:text-[var(--text-primary)] text-[var(--text-dim)] transition-colors">
            <ChevronLeft className="w-3 h-3" />
          </button>
          <button onClick={handleNext} disabled={weekOffset === 0} className="p-1 rounded bg-[var(--surface)] border hover:bg-[var(--elevated)] hover:text-[var(--text-primary)] text-[var(--text-dim)] disabled:opacity-30 transition-colors">
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex gap-2 p-3 bg-[var(--surface)]/50 border border-[var(--border)]/60 rounded-xl overflow-x-auto relative custom-scrollbar">
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
                      getColor(day.minutes),
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
          className="fixed z-[100] bg-[var(--elevated)] border border-[var(--border-bright)] text-[var(--text-primary)] px-3 py-2 shadow-xl rounded-md pointer-events-none transform -translate-x-1/2 -translate-y-full flex flex-col gap-1"
          style={{ left: hoveredDay.x, top: hoveredDay.y }}
        >
          <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-dim)] uppercase">
            <span>{format(hoveredDay.day.date, 'EEEE')}</span>
            <span>•</span>
            <span className="text-[#3b82f6]">{format(hoveredDay.day.date, 'MMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-1.5 font-display text-sm font-bold">
            {hoveredDay.day.count > 0 && <Clock className="w-3 h-3 text-[#3b82f6]" />}
            {hoveredDay.day.count === 0 ? "No activity" : `${hoveredDay.day.minutes} mins in ${hoveredDay.day.count} session${hoveredDay.day.count === 1 ? '' : 's'}`}
          </div>
        </div>
      )}

      {/* Modal for Details */}
      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="bg-[var(--surface)] border-[var(--border)] text-[var(--text-primary)] max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Star className="w-5 h-5 text-[#3b82f6] fill-[#3b82f6]" />
              Sessions joined on {selectedDay && format(selectedDay.date, 'MMMM d, yyyy')}
            </DialogTitle>
          </DialogHeader>
          
          <div className="max-h-[60vh] overflow-y-auto space-y-3 pr-2 custom-scrollbar mt-4">
            {selectedDay?.sessions.map((session: any, idx: number) => (
              <SessionCard key={idx} session={session} userEmail={userEmail} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SessionCard({ session, userEmail }: { session: any, userEmail: string }) {
  const [expanded, setExpanded] = useState(false);
  const isHost = session.hostEmail === userEmail;
  const participants = session.participants || [];
  
  return (
    <div className="p-4 rounded-xl border border-[var(--border)]/60 bg-[var(--elevated)]/50 flex flex-col gap-2 transition-all">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-[#3b82f6] font-bold">
          Room: {session.roomCode || 'UNKNOWN'}
        </span>
        <span className="text-xs text-[var(--text-dim)] font-mono">
          {format(new Date(session.startedAt), 'h:mm a')} - {session.endedAt ? format(new Date(session.endedAt), 'h:mm a') : 'Active'}
        </span>
      </div>
      <div className="flex gap-2 items-center text-xs mt-1">
        <span className={cn("px-2 py-0.5 rounded border font-mono", isHost ? "bg-[#3b82f6]/20 border-[#3b82f6]/30 text-[#3b82f6]" : "bg-[var(--elevated)] border-[var(--border)] text-[var(--text-dim)]")}>
           {isHost ? 'HOSTED' : 'PARTICIPATED'}
        </span>
        
        <button onClick={() => setExpanded(!expanded)} className="text-[var(--text-dim)] hover:text-[#3b82f6] transition-colors flex items-center gap-1">
          Total participants: <span className="text-[var(--text-primary)]">{session.participantCount || participants.length || 0}</span>
          <span className="text-[8px] ml-1">{expanded ? '▲' : '▼'}</span>
        </button>
      </div>

      {expanded && participants.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]/40 flex flex-col gap-2">
          <p className="text-[10px] font-mono text-[var(--text-dim)] uppercase tracking-wider">Participant Roster</p>
          {participants.map((p: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-xs font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-dim)]" />
              <span className="text-[var(--text-primary)]">{p.name || p.email || 'Unknown User'}</span>
              {(p.name && p.email) && <span className="text-[var(--text-dim)] ml-auto">{p.email}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}
