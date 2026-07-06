import React, { useMemo, useState } from 'react';
import { format, addDays, differenceInDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock, CheckCircle2, Flag } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/lib/AuthContext';
import QuickProgressSheet from '@/components/programme/QuickProgressSheet';
import useQuickProgress from '@/components/programme/useQuickProgress';

const WINDOWS = [
  { label: '2 Week', days: 14 },
  { label: '4 Week', days: 28 },
  { label: '6 Week', days: 42 },
];

const ASSIGNEE_ALL = '__all__';
const ASSIGNEE_MINE = '__mine__';

export default function LookAhead({ tasks, scheduledMap, allTasks, programmesByProject, canUpdateProgress = false, projectsById = null, showProject = false }) {
  const { user } = useAuth();
  const [windowDays, setWindowDays] = useState(14);
  const [assigneeFilter, setAssigneeFilter] = useState(ASSIGNEE_ALL);
  const today = new Date();
  const windowEnd = addDays(today, windowDays);

  // Quick-progress mutation — shared with the old Field page. Falls back to
  // `tasks` if the parent hasn't wired allTasks/programmesByProject, so the
  // reschedule cascade still has something to work with.
  const { activeTask, setActiveTask, saving, handleSave } = useQuickProgress({
    allTasks: allTasks || tasks,
    programmesByProject,
  });

  const myEmail = (user?.email || '').toLowerCase();

  const assigneeOptions = useMemo(() => {
    const set = new Set();
    for (const t of tasks) {
      if (t.assignee_email) set.add(t.assignee_email);
    }
    return [...set].sort();
  }, [tasks]);

  const { activeTasks, milestones, critical, overdue } = useMemo(() => {
    const active = [], miles = [], crit = [], late = [];
    // Build set of parent IDs to exclude summary tasks
    const parentIds = new Set(tasks.filter(t => tasks.some(o => o.parent_id === t.id)).map(t => t.id));

    for (const t of tasks) {
      // Exclude parent/summary tasks — only leaf tasks and milestones
      const isMilestone = t.is_milestone || t.duration === 0;
      const isLeaf = !parentIds.has(t.id);
      if (parentIds.has(t.id) && !isMilestone) continue;

      if (assigneeFilter === ASSIGNEE_MINE && (t.assignee_email || '').toLowerCase() !== myEmail) continue;
      if (assigneeFilter !== ASSIGNEE_ALL && assigneeFilter !== ASSIGNEE_MINE && t.assignee_email !== assigneeFilter) continue;

      const resolved = scheduledMap?.get(t.id);
      const start = resolved?.startStr || t.start_date;
      const end = resolved?.finishStr || t.end_date;
      if (!start || !end) continue;
      const s = new Date(start), e = new Date(end);
      const overlaps = s <= windowEnd && e >= today;
      if (!overlaps) continue;

      const isCritical = resolved?.isCritical || false;
      const pct = t.percent_complete || 0;
      const isOverdue = pct < 100 && e < today;

      if (isMilestone) miles.push({ task: t, resolved, end: e });
      else if (isCritical && pct < 100) crit.push({ task: t, resolved, end: e });
      else if (isOverdue) late.push({ task: t, resolved, end: e });

      active.push({ task: t, resolved, end: e, start: s, isMilestone, isLeaf, isCritical, pct, isOverdue });
    }

    active.sort((a, b) => a.start - b.start);
    miles.sort((a, b) => a.end - b.end);
    crit.sort((a, b) => a.end - b.end);
    late.sort((a, b) => a.end - b.end);

    return { activeTasks: active, milestones: miles, critical: crit, overdue: late };
  }, [tasks, scheduledMap, windowDays, assigneeFilter, myEmail]);

  const getStatus = (task, isOverdue, pct) => {
    if (pct === 100) return { label: 'Complete', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    if (pct > 0) return { label: 'In Progress', cls: 'bg-blue-100 text-blue-700 border-blue-200' };
    if (isOverdue) return { label: 'Overdue', cls: 'bg-red-100 text-red-700 border-red-200' };
    return { label: 'Not Started', cls: 'bg-muted text-muted-foreground border-border' };
  };

  // Planned dates in the shape QuickProgressSheet expects.
  const plannedFor = (t) => {
    const r = scheduledMap?.get(t.id);
    return {
      startStr: r?.startStr || t.start_date || null,
      finishStr: r?.finishStr || t.end_date || null,
      isCritical: r?.isCritical || false,
    };
  };

  const TaskRow = ({ item }) => {
    const { task, end, start, isMilestone, isLeaf, isCritical, pct, isOverdue } = item;
    const status = getStatus(task, isOverdue, pct);
    const daysLeft = differenceInDays(end, today);
    const clickable = canUpdateProgress && isLeaf && !isMilestone;

    return (
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => setActiveTask(task) : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTask(task); } } : undefined}
        className={cn(
          'flex items-center gap-2 px-3 py-2 border-b border-border/20 transition-colors',
          isCritical && 'bg-red-50/40 dark:bg-red-950/10',
          clickable ? 'hover:bg-muted/50 active:bg-muted/70 cursor-pointer' : 'hover:bg-muted/30',
        )}
      >
        <span className="text-[10px] font-mono text-muted-foreground w-8 flex-shrink-0">{task.wbs || '—'}</span>
        <div className="flex-1 min-w-0">
          {showProject && (
            <span className="block text-[9px] text-muted-foreground uppercase tracking-wide truncate">
              {projectsById?.get(task.project_id) || '—'}
            </span>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <span className={cn('text-xs truncate', isCritical && 'text-red-700 dark:text-red-400 font-medium', isMilestone && 'text-indigo-600')}>{task.name}</span>
            {isMilestone && <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1 rounded">M</span>}
            {isCritical && <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded">CP</span>}
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            {format(start, 'dd MMM')} → {format(end, 'dd MMM')}
          </span>
        </div>
        {!isMilestone && (
          <div className="flex items-center gap-1 w-20 flex-shrink-0">
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground w-6 text-right">{pct}%</span>
          </div>
        )}
        <Badge className={cn('text-[9px] px-1.5 py-0 border flex-shrink-0', status.cls)}>{status.label}</Badge>
        <span className={cn('text-[10px] font-medium w-14 text-right flex-shrink-0',
          daysLeft < 0 ? 'text-red-500' : daysLeft <= 3 ? 'text-amber-500' : 'text-muted-foreground')}>
          {daysLeft < 0 ? `${Math.abs(daysLeft)}d late` : daysLeft === 0 ? 'Today' : `${daysLeft}d`}
        </span>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="flex flex-col gap-2 px-4 py-2.5 border-b bg-muted/30 flex-shrink-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <span className="text-sm font-semibold">Look Ahead</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {format(today, 'dd MMM')} → {format(windowEnd, 'dd MMM yyyy')} · {activeTasks.length} tasks
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {assigneeOptions.length > 0 && (
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="All assignees" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ASSIGNEE_ALL}>All assignees</SelectItem>
                <SelectItem value={ASSIGNEE_MINE}>My tasks</SelectItem>
                {assigneeOptions.map(email => (
                  <SelectItem key={email} value={email}>{email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-0.5 rounded-md border p-0.5 bg-background">
            {WINDOWS.map(w => (
              <button key={w.days} onClick={() => setWindowDays(w.days)}
                className={cn('px-2.5 py-1 text-xs font-medium rounded transition-colors',
                  windowDays === w.days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTasks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">No tasks scheduled in this window</div>
      ) : (
        <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-4 divide-x divide-border/50">
          {/* Summary panels */}
          <div className="hidden md:flex flex-col divide-y divide-border/30 bg-muted/10 overflow-hidden">
            <div className="p-3 flex-shrink-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Summary</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0"><Clock className="w-3.5 h-3.5 text-blue-600" /></div>
                  <div><p className="text-base font-bold leading-tight">{activeTasks.filter(t => t.pct > 0 && t.pct < 100).length}</p><p className="text-[10px] text-muted-foreground">In Progress</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0"><AlertTriangle className="w-3.5 h-3.5 text-red-600" /></div>
                  <div><p className="text-base font-bold leading-tight">{overdue.length}</p><p className="text-[10px] text-muted-foreground">Overdue</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0"><AlertTriangle className="w-3.5 h-3.5 text-amber-600" /></div>
                  <div><p className="text-base font-bold leading-tight">{critical.length}</p><p className="text-[10px] text-muted-foreground">Critical</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0"><Flag className="w-3.5 h-3.5 text-indigo-600" /></div>
                  <div><p className="text-base font-bold leading-tight">{milestones.length}</p><p className="text-[10px] text-muted-foreground">Milestones</p></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /></div>
                  <div><p className="text-base font-bold leading-tight">{activeTasks.filter(t => t.pct === 100).length}</p><p className="text-[10px] text-muted-foreground">Complete</p></div>
                </div>
              </div>
            </div>

            {milestones.length > 0 && (
              <div className="p-3 flex-1 overflow-auto min-h-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Milestones</p>
                <div className="space-y-1.5">
                  {milestones.map(({ task, end }) => {
                    const d = differenceInDays(end, today);
                    return (
                      <div key={task.id} className="flex items-center gap-2">
                        <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', d <= 7 ? 'bg-red-500' : d <= 14 ? 'bg-amber-500' : 'bg-indigo-500')} />
                        <div className="flex-1 min-w-0">
                          {showProject && (
                            <span className="block text-[9px] text-muted-foreground uppercase tracking-wide truncate">
                              {projectsById?.get(task.project_id) || '—'}
                            </span>
                          )}
                          <span className="text-xs truncate block">{task.name}</span>
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{format(end, 'dd MMM')}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Main task list — 3 columns wide on desktop, full width on mobile */}
          <div className="md:col-span-3 flex flex-col overflow-hidden">
            {/* Column headers */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex-shrink-0">
              <span className="w-8">WBS</span>
              <span className="flex-1">Task</span>
              <span className="w-20 text-right">Progress</span>
              <span className="w-16 text-center">Status</span>
              <span className="w-14 text-right">Due</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {activeTasks.map(item => <TaskRow key={item.task.id} item={item} />)}
            </div>
          </div>
        </div>
      )}

      {canUpdateProgress && (
        <QuickProgressSheet
          task={activeTask}
          planned={activeTask ? plannedFor(activeTask) : null}
          projectName={null}
          open={!!activeTask}
          onOpenChange={open => { if (!open && !saving) setActiveTask(null); }}
          saving={saving}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
