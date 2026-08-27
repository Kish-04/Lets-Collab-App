"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Star } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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

  // Determine the end date of the view based on weekOffset
  const today = startOfDay(new Date())
  const viewEndDate = subWeeks(today, weekOffset)
  
  // We want to show 12 weeks (84 days)
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

  // Build the grid data
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
    if (count < 3) return 'bg-[var(--emerald)]/20 border-[var(--emerald)]/30'
    if (count < 8) return 'bg-[var(--emerald)]/50 border-[var(--emerald)]/60'
    if (count < 12) return 'bg-[var(--emerald)]/80 border-[var(--emerald)]/90'
    return 'bg-[var(--emerald)] border-[var(--emerald)] shadow-[0_0_8px_rgba(16,185,129,0.5)]'
  }

  const handleNext = () => {
    if (weekOffset > 0) setWeekOffset(weekOffset - 1)
  }

  const handlePrev = () => {
    setWeekOffset(weekOffset + 1)
  }

  return (
    <div className={cn("flex flex-col items-center", className)}>
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

      <TooltipProvider delayDuration={0}>
        <div className="inline-flex gap-1.5 p-4 bg-[var(--surface)]/50 border border-[var(--border)]/60 rounded-xl overflow-x-auto items-end">
          {weeks.map((week, wIdx) => (
            <div key={wIdx} className="flex flex-col gap-1.5">
              {week.map((day, dIdx) => (
                <Tooltip key={dIdx}>
                  <TooltipTrigger asChild>
                    <div 
                      onClick={() => { if (day.count > 0) setSelectedDay(day) }}
                      className={cn(
                        "w-3.5 h-3.5 rounded-sm border transition-all duration-300 hover:scale-150 cursor-pointer", 
                        getColor(day.count),
                        day.count === 0 && "cursor-default"
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent className="bg-[var(--elevated)] border-[var(--border-bright)] text-[var(--text-primary)] px-3 py-2 shadow-xl">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2 font-mono text-[10px] text-[var(--text-dim)] uppercase">
                        <span>{format(day.date, 'EEEE')}</span>
                        <span>•</span>
                        <span className="text-[var(--accent)]">{format(day.date, 'MMM d, yyyy')}</span>
                      </div>
                      <div className="flex items-center gap-1.5 font-display text-sm font-bold">
                        {day.count > 0 && <Star className="w-3 h-3 text-[var(--emerald)] fill-[var(--emerald)]" />}
                        {day.count === 0 ? "No activity" : `${day.count} session${day.count === 1 ? '' : 's'}`}
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ))}
        </div>
      </TooltipProvider>

      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="bg-[var(--surface)] border-[var(--border)] text-[var(--text-primary)] max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Star className="w-5 h-5 text-[var(--emerald)] fill-[var(--emerald)]" />
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
                    <span className={cn("w-2 h-2 rounded-full", (session.riskScore || 0) > 30 ? "bg-[var(--red)]" : "bg-[var(--emerald)]")} />
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
