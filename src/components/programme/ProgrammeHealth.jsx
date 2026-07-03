import React, { useMemo } from 'react';
import { format, differenceInDays, addDays } from 'date-fns';
import { CheckCircle2, Clock, AlertTriangle, TrendingUp, Circle, GitCompareArrows } from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateVariance } from '@/lib/scheduling/baselineEngine';

export default function ProgrammeHealth({ tasks, scheduledMap, baselineMap, baselineName }) {
  const today = new Date();

  const baselineStats = useMemo(() => {
    if (!baselineMap || !baselineMap.size) return null;
    let onTrack = 0, ahead = 0, slipped = 0, totalSlipDays = 0, worst = null;
    for (const t of tasks) {
      if (tasks.some(o => o.parent_id === t.id)) continue; // leaf only
      const record = baselineMap.get(t.id);
      if (!record) continue;
      const resolved = scheduledMap?.get(t.id);
      const v = calculateVariance(record, resolved);
      if (!v) continue;
      if (v.finishVariance > 0) {
        slipped++;
        totalSlipDays += v.finishVariance;
        if (!worst || v.finishVariance > worst.variance) worst = { task: t, variance: v.finishVariance };
      } else if (v.finishVariance < 0) ahead++;
      else onTrack++;
    }
    return { onTrack, ahead, slipped, totalSlipDays, worst };
  }, [tasks, scheduledMap, baselineMap]);

  const stats = useMemo(() => {
    const leafTasks = tasks.filter(t => !tasks.some(o => o.parent_id === t.id));
    const total = leafTasks.length;
    if (total === 0) return null;

    let complete = 0, inProgress = 0, notStarted = 0, delayed = 0, critical = 0;
    const upcomingMilestones = [], delayedTasks = [];
    let totalPct = 0;

    for (const t of leafTasks) {
      const pct = t.percent_complete || 0;
      totalPct += pct;
      const resolved = scheduledMap?.get(t.id);
      const isCritical = resolved?.isCritical || false;
      if (isCritical) critical++;

      const plannedEnd = resolved?.finishStr || t.end_date;
      const isDelayed = pct < 100 && plannedEnd && new Date(plannedEnd) < today;

      if (pct === 100) complete++;
      else if (pct > 0) inProgress++;
      else notStarted++;

      if (isDelayed) {
        delayed++;
        delayedTasks.push({ task: t, end: new Date(plannedEnd), variance: differenceInDays(today, new Date(plannedEnd)) });
      }
    }

    const window30End = addDays(today, 30);
    for (const t of tasks) {
      if (!t.is_milestone && t.duration !== 0) continue;
      const resolved = scheduledMap?.get(t.id);
      const mDate = resolved?.finishStr || t.end_date;
      if (!mDate) continue;
      const d = new Date(mDate);
      if (d >= today && d <= window30End) upcomingMilestones.push({ name: t.name, date: d });
    }

    upcomingMilestones.sort((a, b) => a.date - b.date);
    delayedTasks.sort((a, b) => b.variance - a.variance);

    return {
      total, complete, inProgress, notStarted, delayed, critical,
      overallPct: Math.round(totalPct / total),
      upcomingMilestones: upcomingMilestones.slice(0, 8),
      delayedTasks: delayedTasks.slice(0, 8),
    };
  }, [tasks, scheduledMap]);

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <TrendingUp className="w-10 h-10 opacity-30" />
        <p className="text-sm">Import a schedule to view programme health</p>
      </div>
    );
  }

  const { total, complete, inProgress, notStarted, delayed, critical, overallPct, upcomingMilestones, delayedTasks } = stats;

  const statusSlices = [
    { label: 'Complete', value: complete, pct: Math.round((complete / total) * 100), color: 'bg-emerald-500', text: 'text-emerald-600' },
    { label: 'In Progress', value: inProgress, pct: Math.round((inProgress / total) * 100), color: 'bg-blue-500', text: 'text-blue-600' },
    { label: 'Not Started', value: notStarted, pct: Math.round((notStarted / total) * 100), color: 'bg-muted-foreground/30', text: 'text-muted-foreground' },
  ];

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Overall completion */}
        <div className="md:col-span-1 rounded-xl border bg-card p-4 flex flex-col justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Overall</p>
          <div className="mt-2">
            <p className="text-4xl font-bold text-primary">{overallPct}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">Programme Complete</p>
          </div>
          <div className="mt-3 w-full h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${overallPct}%` }} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{complete} of {total} tasks</p>
        </div>

        {/* KPI tiles */}
        <div className="rounded-xl border bg-card p-4 border-l-4 border-l-emerald-500">
          <p className="text-xs text-muted-foreground">Complete</p>
          <p className="text-3xl font-bold mt-1">{complete}</p>
          <p className="text-[10px] text-muted-foreground">{Math.round((complete/total)*100)}% of tasks</p>
        </div>
        <div className="rounded-xl border bg-card p-4 border-l-4 border-l-red-500">
          <p className="text-xs text-muted-foreground">Delayed</p>
          <p className="text-3xl font-bold mt-1 text-red-600">{delayed}</p>
          <p className="text-[10px] text-muted-foreground">past planned end date</p>
        </div>
        <div className="rounded-xl border bg-card p-4 border-l-4 border-l-amber-500">
          <p className="text-xs text-muted-foreground">Critical Tasks</p>
          <p className="text-3xl font-bold mt-1 text-amber-600">{critical}</p>
          <p className="text-[10px] text-muted-foreground">on critical path</p>
        </div>
      </div>

      {/* Baseline comparison */}
      {baselineStats && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <GitCompareArrows className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-semibold">vs Baseline{baselineName ? `: ${baselineName}` : ''}</p>
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold text-emerald-600">{baselineStats.ahead}</p>
              <p className="text-[10px] text-muted-foreground">ahead</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{baselineStats.onTrack}</p>
              <p className="text-[10px] text-muted-foreground">on track</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{baselineStats.slipped}</p>
              <p className="text-[10px] text-muted-foreground">slipped</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{baselineStats.totalSlipDays}d</p>
              <p className="text-[10px] text-muted-foreground">total days lost</p>
            </div>
          </div>
          {baselineStats.worst && (
            <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t">
              Worst slip: <span className="font-medium text-foreground">{baselineStats.worst.task.name}</span>
              {' '}(+{baselineStats.worst.variance}d)
            </p>
          )}
        </div>
      )}

      {/* Second row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Status breakdown */}
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-semibold mb-3">Task Status Breakdown</p>
          <div className="space-y-2.5">
            {statusSlices.map(s => (
              <div key={s.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className={cn('font-semibold', s.text)}>{s.value} <span className="font-normal text-muted-foreground">({s.pct}%)</span></span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', s.color)} style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /><span>{inProgress} in progress</span></div>
            <div className="flex items-center gap-1.5"><Circle className="w-3.5 h-3.5" /><span>{notStarted} not started</span></div>
          </div>
        </div>

        {/* Upcoming milestones */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold">Upcoming Milestones</p>
            <span className="text-[10px] text-muted-foreground">Next 30 days</span>
          </div>
          {upcomingMilestones.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No milestones in this period</p>
          ) : (
            <div className="space-y-1.5">
              {upcomingMilestones.map((m, i) => {
                const d = differenceInDays(m.date, today);
                return (
                  <div key={i} className="flex items-center gap-2 py-1 border-b border-border/20 last:border-0">
                    <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', d <= 7 ? 'bg-red-500' : d <= 14 ? 'bg-amber-500' : 'bg-indigo-500')} />
                    <span className="text-xs flex-1 truncate">{m.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">{format(m.date, 'dd MMM')}</span>
                    <span className={cn('text-[10px] font-medium w-8 text-right', d <= 7 ? 'text-red-500' : d <= 14 ? 'text-amber-500' : 'text-muted-foreground')}>
                      {d === 0 ? 'Today' : `${d}d`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Delay register */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold">Delay Register</p>
            <span className="text-[10px] text-red-500 font-medium">{delayed} delayed</span>
          </div>
          {delayedTasks.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-4">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <p className="text-xs text-muted-foreground">No delayed tasks</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {delayedTasks.map(({ task, end, variance }) => (
                <div key={task.id} className="flex items-center gap-2 py-1 border-b border-border/20 last:border-0">
                  <AlertTriangle className="w-3 h-3 text-red-500 flex-shrink-0" />
                  <span className="text-xs flex-1 truncate">{task.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{format(end, 'dd MMM')}</span>
                  <span className="text-[10px] font-medium text-red-500 w-10 text-right">{variance}d late</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}