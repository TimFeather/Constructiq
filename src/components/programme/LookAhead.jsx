import React, { useMemo, useState } from 'react';
import { format, addDays, isWithinInterval, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const WINDOWS = [
  { label: '2 Week', days: 14 },
  { label: '4 Week', days: 28 },
  { label: '6 Week', days: 42 },
];

export default function LookAhead({ tasks, scheduledMap }) {
  const [windowDays, setWindowDays] = useState(14);
  const today = new Date();
  const windowEnd = addDays(today, windowDays);

  const activeTasks = useMemo(() => {
    return tasks
      .filter(t => {
        const resolved = scheduledMap?.get(t.id);
        const start = resolved?.startStr || t.start_date;
        const end = resolved?.finishStr || t.end_date;
        if (!start || !end) return false;
        const s = new Date(start);
        const e = new Date(end);
        // Include tasks that overlap with the look-ahead window
        return s <= windowEnd && e >= today;
      })
      .sort((a, b) => {
        const ra = scheduledMap?.get(a.id);
        const rb = scheduledMap?.get(b.id);
        const sa = new Date(ra?.startStr || a.start_date || '9999');
        const sb = new Date(rb?.startStr || b.start_date || '9999');
        return sa - sb;
      });
  }, [tasks, scheduledMap, today, windowEnd]);

  const getStatus = (task) => {
    const pct = task.percent_complete || 0;
    if (pct === 100) return { label: 'Complete', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    if (pct > 0) return { label: 'In Progress', color: 'bg-blue-100 text-blue-700 border-blue-200' };
    const resolved = scheduledMap?.get(task.id);
    const end = resolved?.finishStr || task.end_date;
    if (end && new Date(end) < today) return { label: 'Overdue', color: 'bg-red-100 text-red-700 border-red-200' };
    return { label: 'Not Started', color: 'bg-muted text-muted-foreground border-border' };
  };

  return (
    <div className="p-6 space-y-4 overflow-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Look Ahead</h2>
          <p className="text-sm text-muted-foreground">
            {format(today, 'dd MMM yyyy')} → {format(windowEnd, 'dd MMM yyyy')} · {activeTasks.length} tasks
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/30">
          {WINDOWS.map(w => (
            <button
              key={w.days}
              onClick={() => setWindowDays(w.days)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                windowDays === w.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {activeTasks.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          No tasks scheduled in this window
        </div>
      ) : (
        <div className="space-y-2">
          {activeTasks.map(task => {
            const resolved = scheduledMap?.get(task.id);
            const plannedStart = resolved?.startStr || task.start_date;
            const plannedEnd = resolved?.finishStr || task.end_date;
            const isCritical = resolved?.isCritical || false;
            const isMilestone = task.is_milestone || task.duration === 0;
            const pct = task.percent_complete || 0;
            const status = getStatus(task);

            const daysToEnd = plannedEnd ? differenceInDays(new Date(plannedEnd), today) : null;

            return (
              <div
                key={task.id}
                className={cn(
                  "rounded-lg border bg-card p-3 flex items-center gap-3",
                  isCritical && "border-l-4 border-l-red-500",
                  isMilestone && "border-l-4 border-l-indigo-500",
                )}
              >
                {/* WBS */}
                <span className="text-[10px] font-mono text-muted-foreground w-10 flex-shrink-0">{task.wbs || '—'}</span>

                {/* Name + badges */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn("text-sm truncate", isCritical && "text-red-700 dark:text-red-400 font-medium")}>
                      {task.name}
                    </span>
                    {isMilestone && <Badge className="text-[10px] px-1.5 py-0 bg-indigo-100 text-indigo-700 border-indigo-200">Milestone</Badge>}
                    {isCritical && <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 border-red-200">Critical</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {plannedStart ? format(new Date(plannedStart), 'dd MMM') : '—'} → {plannedEnd ? format(new Date(plannedEnd), 'dd MMM') : '—'}
                    </span>
                    {task.actual_start && (
                      <span className="text-[10px] text-blue-600">Started {format(new Date(task.actual_start), 'dd MMM')}</span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {!isMilestone && (
                  <div className="flex items-center gap-2 w-28 flex-shrink-0">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
                  </div>
                )}

                {/* Status */}
                <Badge className={cn("text-[10px] px-2 py-0.5 border flex-shrink-0", status.color)}>
                  {status.label}
                </Badge>

                {/* Days remaining */}
                {daysToEnd !== null && (
                  <span className={cn(
                    "text-[10px] font-medium w-14 text-right flex-shrink-0",
                    daysToEnd < 0 ? "text-red-500" : daysToEnd <= 3 ? "text-amber-500" : "text-muted-foreground"
                  )}>
                    {daysToEnd < 0 ? `${Math.abs(daysToEnd)}d late` : daysToEnd === 0 ? 'Due today' : `${daysToEnd}d left`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}