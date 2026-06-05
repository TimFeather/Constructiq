import React, { useMemo } from 'react';
import { format, differenceInDays, isWithinInterval, addDays } from 'date-fns';
import { CheckCircle2, Clock, AlertTriangle, Target, Flag, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

function StatCard({ icon: IconComponent, label, value, sub, color }) {
  const Icon = IconComponent;
  return (
    <div className={cn("rounded-xl border bg-card p-4 flex items-start gap-3", color && `border-l-4 ${color}`)}>
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted")}>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-tight">{value}</p>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function ProgrammeHealth({ tasks, scheduledMap }) {
  const today = new Date();

  const stats = useMemo(() => {
    const leafTasks = tasks.filter(t => !tasks.some(o => o.parent_id === t.id));
    const total = leafTasks.length;
    if (total === 0) return null;

    let complete = 0, inProgress = 0, notStarted = 0, delayed = 0, critical = 0;
    const upcomingMilestones = [];
    let totalPct = 0;

    for (const t of leafTasks) {
      const pct = t.percent_complete || 0;
      totalPct += pct;
      const resolved = scheduledMap?.get(t.id);
      const isCritical = resolved?.isCritical || false;
      if (isCritical) critical++;

      if (pct === 100) { complete++; continue; }
      if (pct > 0) inProgress++;
      else notStarted++;

      // Delayed: planned end is in the past and not complete
      const plannedEnd = resolved?.finishStr || t.end_date;
      if (plannedEnd && new Date(plannedEnd) < today) delayed++;
    }

    // Milestones in next 30 days
    const window30End = addDays(today, 30);
    for (const t of tasks) {
      if (!t.is_milestone && t.duration !== 0) continue;
      const resolved = scheduledMap?.get(t.id);
      const mDate = resolved?.finishStr || t.end_date;
      if (!mDate) continue;
      const d = new Date(mDate);
      if (d >= today && d <= window30End) {
        upcomingMilestones.push({ name: t.name, date: d, isPast: d < today });
      }
    }

    upcomingMilestones.sort((a, b) => a.date - b.date);

    return {
      total,
      complete,
      inProgress,
      notStarted,
      delayed,
      critical,
      overallPct: Math.round(totalPct / total),
      upcomingMilestones: upcomingMilestones.slice(0, 6),
    };
  }, [tasks, scheduledMap, today]);

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
        <TrendingUp className="w-10 h-10 opacity-30" />
        <p className="text-sm">Import a schedule to view programme health</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <div>
        <h2 className="text-base font-semibold mb-1">Programme Health</h2>
        <p className="text-sm text-muted-foreground">{stats.total} tasks tracked · {stats.overallPct}% overall complete</p>
      </div>

      {/* Overall progress bar */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex justify-between mb-2 text-sm">
          <span className="font-medium">Programme Completion</span>
          <span className="font-bold text-primary">{stats.overallPct}%</span>
        </div>
        <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${stats.overallPct}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>{stats.complete} complete</span>
          <span>{stats.total - stats.complete} remaining</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={CheckCircle2} label="Tasks Complete" value={stats.complete} color="border-l-emerald-500" />
        <StatCard icon={Clock} label="In Progress" value={stats.inProgress} color="border-l-blue-500" />
        <StatCard icon={AlertTriangle} label="Delayed" value={stats.delayed} sub="past planned end" color="border-l-amber-500" />
        <StatCard icon={Target} label="Critical Tasks" value={stats.critical} color="border-l-red-500" />
        <StatCard icon={Flag} label="Milestones (30d)" value={stats.upcomingMilestones.length} color="border-l-indigo-500" />
      </div>

      {/* Upcoming milestones */}
      {stats.upcomingMilestones.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Upcoming Milestones (Next 30 Days)</h3>
          <div className="space-y-2">
            {stats.upcomingMilestones.map((m, i) => {
              const daysAway = differenceInDays(m.date, today);
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                  <div className={cn("w-2 h-2 rounded-full flex-shrink-0", daysAway <= 7 ? "bg-red-500" : daysAway <= 14 ? "bg-amber-500" : "bg-indigo-500")} />
                  <span className="text-sm flex-1 truncate">{m.name}</span>
                  <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">{format(m.date, 'dd MMM')}</span>
                  <span className={cn("text-xs font-medium whitespace-nowrap", daysAway <= 7 ? "text-red-500" : daysAway <= 14 ? "text-amber-500" : "text-muted-foreground")}>
                    {daysAway === 0 ? 'Today' : `${daysAway}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}