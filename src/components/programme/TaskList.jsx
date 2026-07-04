import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, differenceInDays } from 'date-fns';
import { calculateVariance } from '@/lib/scheduling/baselineEngine';
import { Task } from '@/api/entities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';

export const ROW_HEIGHT = 32;

const levelColors = [
  'border-l-primary',
  'border-l-accent',
  'border-l-amber-500',
  'border-l-purple-500',
];

/**
 * TaskList — read-only view.
 * expandedIds and onToggleExpand are controlled by parent (Programme page)
 * so GanttChart stays perfectly aligned.
 */
export default function TaskList({
  tasks,
  visibleTasks,   // pre-computed by parent via getVisibleTasks()
  scheduledMap,
  expandedIds,
  onToggleExpand,
  onTaskClick,
  onEditTask,
  canDeleteTasks = false,
  scrollRef,
  onScroll,
  baselineMap,    // optional Map<task_id, { baseline_start, baseline_finish, baseline_duration }>
}) {
  const COLS = baselineMap ? '44px 20px 1fr 52px 64px 64px 72px 72px' : '44px 20px 1fr 52px 64px 64px 72px';
  const today = new Date();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const deleteMutation = useMutation({
    mutationFn: (taskId) => Task.delete(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({ title: 'Task deleted', duration: 2500 });
      setConfirmDeleteId(null);
    },
    onError: (e) => {
      toast({
        title: 'Delete failed',
        description: e.message?.includes('foreign key') ? 'Move or delete its subtasks first.' : e.message,
        variant: 'destructive',
      });
      setConfirmDeleteId(null);
    },
  });

  const getVariance = (task) => {
    const resolved = scheduledMap?.get(task.id);
    const plannedEnd = resolved?.finishStr || task.end_date;
    if (!plannedEnd) return null;
    if (task.actual_finish) return differenceInDays(new Date(plannedEnd), new Date(task.actual_finish));
    if (task.percent_complete === 100) return null;
    return differenceInDays(new Date(plannedEnd), today);
  };

  return (
    <div className="border-r bg-card h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center px-3 border-b bg-muted/30 h-10 flex-shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task List</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{tasks.length} tasks</span>
      </div>

      {/* Column headers */}
      <div
        className="grid items-center border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/30 px-2 h-9 flex-shrink-0"
        style={{ gridTemplateColumns: COLS }}
      >
        <span className="text-center">WBS</span>
        <div />
        <span className="px-1">Name</span>
        <span className="text-center">%</span>
        <span className="text-center">Pln Start</span>
        <span className="text-center">Pln End</span>
        <span className="text-center">Variance</span>
        {baselineMap && <span className="text-center">Baseline</span>}
      </div>

      {/* Rows — flat list from pre-computed visibleTasks */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={onScroll}>
        {visibleTasks.map(task => {
          const hasChildren = tasks.some(t => t.parent_id === task.id);
          const isSummary = hasChildren;
          const isExpanded = expandedIds.has(task.id);
          const isMilestone = task.is_milestone || task.duration === 0;
          const resolved = scheduledMap?.get(task.id);
          const isCritical = resolved?.isCritical || false;
          const depth = task.level || 0;

          const plannedStart = resolved?.startStr || task.start_date;
          const plannedEnd = resolved?.finishStr || task.end_date;
          const percentComplete = isSummary
            ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
            : (task.percent_complete || 0);

          const variance = getVariance(task);
          const varianceEl = variance === null ? '—'
            : variance > 0 ? <span className="text-emerald-600 font-mono text-[10px]">+{variance}d</span>
            : variance < 0 ? <span className="text-red-500 font-mono text-[10px]">{variance}d</span>
            : <span className="text-muted-foreground font-mono text-[10px]">0d</span>;

          const baselineRecord = baselineMap?.get(task.id);
          const baselineVariance = baselineRecord ? calculateVariance(baselineRecord, resolved) : null;
          const baselineEl = !baselineMap ? null
            : !baselineVariance ? <span className="text-muted-foreground font-mono text-[10px]">—</span>
            : baselineVariance.finishVariance > 0
              ? <span className="text-red-500 font-mono text-[10px]" title="Slipped vs baseline">+{baselineVariance.finishVariance}d</span>
              : baselineVariance.finishVariance < 0
                ? <span className="text-emerald-600 font-mono text-[10px]" title="Ahead of baseline">{baselineVariance.finishVariance}d</span>
                : <span className="text-muted-foreground font-mono text-[10px]">0d</span>;

          return (
            <div
              key={task.id}
              style={{
                height: ROW_HEIGHT,
                paddingLeft: `${8 + depth * 16}px`,
                gridTemplateColumns: COLS,
              }}
              className={cn(
                'relative group grid items-center w-full border-b border-border/20 hover:bg-muted/40 transition-colors cursor-pointer px-2 border-l-2',
                isCritical ? 'border-l-red-500 bg-red-50/30 dark:bg-red-950/10' : (levelColors[depth] || 'border-l-muted'),
              )}
              onClick={() => onTaskClick?.(task)}
            >
              <span className="text-[10px] font-mono text-muted-foreground text-center">{task.wbs || '—'}</span>

              <div className="flex items-center justify-center">
                {hasChildren ? (
                  <button
                    className="w-5 h-5 flex items-center justify-center hover:bg-muted rounded"
                    onClick={e => { e.stopPropagation(); onToggleExpand(task.id); }}
                  >
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                ) : <div className="w-5" />}
              </div>

              <span className={cn(
                'text-xs truncate px-1',
                isSummary && 'font-semibold',
                isMilestone && 'text-indigo-600 dark:text-indigo-400',
                isCritical && 'text-red-700 dark:text-red-400',
              )}>
                {task.name}
              </span>

              <div className="flex items-center gap-0.5 px-1">
                <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${percentComplete}%` }} />
                </div>
                <span className="text-[9px] text-muted-foreground w-5 text-right">{percentComplete}%</span>
              </div>

              <span className="text-[10px] font-mono text-muted-foreground text-center">
                {plannedStart ? format(new Date(plannedStart), 'dd/MM/yy') : '—'}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground text-center">
                {plannedEnd ? format(new Date(plannedEnd), 'dd/MM/yy') : '—'}
              </span>
              <div className="text-center">{varianceEl}</div>
              {baselineMap && <div className="text-center">{baselineEl}</div>}

              {(onEditTask || canDeleteTasks) && (
                <div className="absolute right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onEditTask && (
                    <button
                      className="w-5 h-5 flex items-center justify-center hover:bg-primary/10 rounded"
                      onClick={e => { e.stopPropagation(); onEditTask(task); }}
                      title="Edit task"
                    >
                      <Pencil className="w-3 h-3 text-primary" />
                    </button>
                  )}
                  {canDeleteTasks && !isSummary && (
                    <button
                      className={cn(
                        'w-5 h-5 flex items-center justify-center rounded',
                        confirmDeleteId === task.id ? 'bg-destructive/10' : 'hover:bg-destructive/10'
                      )}
                      onClick={e => {
                        e.stopPropagation();
                        if (confirmDeleteId === task.id) deleteMutation.mutate(task.id);
                        else setConfirmDeleteId(task.id);
                      }}
                      title={confirmDeleteId === task.id ? 'Click again to confirm delete' : 'Delete task'}
                      disabled={deleteMutation.isPending && confirmDeleteId === task.id}
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {tasks.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">Import a schedule to get started</div>
        )}
      </div>
    </div>
  );
}