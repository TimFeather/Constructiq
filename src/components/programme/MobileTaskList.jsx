import React, { useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { assigneeNames } from '@/lib/programme/assignees';

const levelColors = [
  'border-l-primary',
  'border-l-accent',
  'border-l-amber-500',
  'border-l-purple-500',
];

const fmt = (d) => (d ? format(new Date(d), 'dd MMM') : '—');

/**
 * MobileTaskList — the Gantt tab on phones. The desktop TaskList is a
 * spreadsheet grid far wider than a phone, so here each task is a two-line
 * row (name, then WBS · dates · duration · assignee) and tapping a row opens
 * the task panel, where it can be updated or edited.
 */
export default function MobileTaskList({
  tasks,
  visibleTasks,   // pre-computed by parent via getVisibleTasks()
  scheduledMap,
  expandedIds,
  onToggleExpand,
  onTaskClick,
  totalWorkingDays = null,
  showCritical = false,
}) {
  const summaryIds = useMemo(
    () => new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id)),
    [tasks],
  );

  return (
    <div className="bg-card h-full flex flex-col">
      <div className="flex items-center px-3 border-b bg-muted/30 h-10 flex-shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task List</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {tasks.length} tasks{totalWorkingDays != null ? ` · ${totalWorkingDays} working days` : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleTasks.map(task => {
          const isSummary = summaryIds.has(task.id);
          const isExpanded = expandedIds.has(task.id);
          const isMilestone = task.is_milestone || task.duration === 0;
          const resolved = scheduledMap?.get(task.id);
          const isCritical = showCritical && (resolved?.isCritical || false);
          const plannedStart = resolved?.startStr || task.start_date;
          const plannedEnd = resolved?.finishStr || task.end_date;
          const pct = isSummary
            ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
            : (task.percent_complete || 0);
          const duration = resolved?.durationDays ?? task.duration ?? 1;
          const depth = task.level || 0;
          const assigned = assigneeNames(task);

          return (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={() => onTaskClick?.(task)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick?.(task); } }}
              // Indent less than desktop (10px a level, capped) so deep WBS still leaves room for the name.
              style={{ paddingLeft: `${4 + Math.min(depth, 5) * 10}px` }}
              className={cn(
                'flex items-start gap-1.5 pr-3 py-2 border-b border-border/20 border-l-2 cursor-pointer active:bg-muted/60',
                isCritical ? 'border-l-red-500 bg-red-50/30 dark:bg-red-950/10' : (levelColors[depth] || 'border-l-muted'),
                isSummary && !isCritical && 'bg-primary/15 dark:bg-primary/20',
              )}
            >
              {isSummary ? (
                <button
                  className="w-7 h-7 -my-0.5 flex items-center justify-center rounded hover:bg-muted flex-shrink-0"
                  onClick={e => { e.stopPropagation(); onToggleExpand(task.id); }}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              ) : <div className="w-7 flex-shrink-0" />}

              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm leading-snug line-clamp-2',
                  isSummary && 'font-semibold',
                  isMilestone && 'text-indigo-600 dark:text-indigo-400',
                  isCritical && 'text-red-700 dark:text-red-400',
                )}>
                  {task.name}
                </p>
                <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5 text-[11px] text-muted-foreground">
                  {task.wbs && <span className="font-mono">{task.wbs}</span>}
                  <span className="font-mono">
                    {isMilestone ? fmt(plannedEnd) : `${fmt(plannedStart)} → ${fmt(plannedEnd)}`}
                  </span>
                  <span>{isMilestone ? 'Milestone' : `${duration}d`}</span>
                  {assigned && <span className="truncate max-w-full">{assigned}</span>}
                </div>
              </div>

              <div className="w-12 flex-shrink-0 pt-1.5 flex flex-col items-end gap-1">
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-muted-foreground">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
