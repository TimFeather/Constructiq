/**
 * ProgrammePrintView — static, print-only render of the full task list + Gantt.
 * Pure renderer: no scrolling, no virtualisation, no interaction. Every row in
 * `tasks` (already expand-all + WBS ordered by the caller) is rendered, and the
 * whole project date range is squeezed into a fixed chart width so the timeline
 * fits the printed page instead of being clipped by a scroll viewport.
 */
import React, { useMemo } from 'react';
import { differenceInDays, format, eachMonthOfInterval, addDays } from 'date-fns';
import { getVisibleTasks } from '@/lib/programme/visibleTasks';

const CHART_WIDTH = 720; // px — fits an A4 landscape page alongside the task columns

export default function ProgrammePrintView({
  tasks = [],
  scheduledMap,
  programme,
  projectName,
  baselineMap,
  criticalOnly = false,
}) {
  const printTasks = useMemo(
    () => getVisibleTasks(tasks, new Set(tasks.map(t => t.id))),
    [tasks]
  );

  const visibleTasks = criticalOnly
    ? printTasks.filter(t => scheduledMap?.get(t.id)?.isCritical)
    : printTasks;

  const { minDate, totalDays, months } = useMemo(() => {
    const dates = [];
    scheduledMap?.forEach(r => {
      if (r.start) dates.push(r.start);
      if (r.finish) dates.push(r.finish);
    });
    if (dates.length === 0) {
      const today = new Date();
      return { minDate: today, totalDays: 1, months: [] };
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const padMin = addDays(min, -3);
    const padMax = addDays(max, 3);
    const total = Math.max(1, differenceInDays(padMax, padMin) + 1);
    const monthList = eachMonthOfInterval({ start: padMin, end: padMax }).map(d => {
      const monthStart = d < padMin ? padMin : d;
      const monthEnd = addDays(d, 32 - d.getDate()) > padMax ? padMax : new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const left = Math.round((differenceInDays(monthStart, padMin) / total) * CHART_WIDTH);
      const width = Math.max(1, Math.round((differenceInDays(monthEnd, monthStart) + 1) / total * CHART_WIDTH));
      return { label: format(d, 'MMM yyyy'), left, width };
    });
    return { minDate: padMin, totalDays: total, months: monthList };
  }, [scheduledMap]);

  const dayToPx = (days) => (days / totalDays) * CHART_WIDTH;

  const getBar = (task) => {
    const resolved = scheduledMap?.get(task.id);
    if (!resolved?.start || !resolved?.finish) return null;
    const isMilestone = task.is_milestone || task.duration === 0;
    const left = dayToPx(differenceInDays(resolved.start, minDate));
    if (isMilestone) return { left, width: 0, isMilestone: true };
    const width = Math.max(2, dayToPx(differenceInDays(resolved.finish, resolved.start) + 1));
    return { left, width, isMilestone: false };
  };

  const dataDateX = programme?.data_date
    ? dayToPx(differenceInDays(new Date(programme.data_date + 'T00:00:00'), minDate))
    : null;

  return (
    <div className="programme-print-view">
      <div className="pp-header">
        <h1>{projectName || 'Programme'}</h1>
        <div className="pp-meta">
          <span>Data date: {programme?.data_date ? format(new Date(programme.data_date + 'T00:00:00'), 'dd MMM yyyy') : '—'}</span>
          <span>Printed: {format(new Date(), 'dd MMM yyyy HH:mm')}</span>
          {criticalOnly && <span>Filter: Critical path only</span>}
        </div>
      </div>

      <table className="pp-table">
        <thead>
          <tr>
            <th className="pp-col-wbs">WBS</th>
            <th className="pp-col-name">Task Name</th>
            <th className="pp-col-num">Dur</th>
            <th className="pp-col-num">Start</th>
            <th className="pp-col-num">Finish</th>
            <th className="pp-col-num">%</th>
            <th className="pp-col-chart" style={{ width: CHART_WIDTH }}>
              <div className="pp-month-header" style={{ width: CHART_WIDTH }}>
                {months.map((m, i) => (
                  <div key={i} className="pp-month" style={{ left: m.left, width: m.width }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map(task => {
            const resolved = scheduledMap?.get(task.id);
            const isSummary = tasks.some(t => t.parent_id === task.id);
            const isMilestone = task.is_milestone || task.duration === 0;
            const isCritical = resolved?.isCritical || false;
            const bar = getBar(task);
            const percentComplete = isSummary
              ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
              : (task.percent_complete || 0);
            const baseline = baselineMap?.get(task.id);
            const baselineBar = (baseline?.baseline_start && baseline?.baseline_finish)
              ? {
                  left: dayToPx(differenceInDays(new Date(baseline.baseline_start), minDate)),
                  width: Math.max(2, dayToPx(differenceInDays(new Date(baseline.baseline_finish), new Date(baseline.baseline_start)) + 1)),
                }
              : null;

            return (
              <tr key={task.id} className={isSummary ? 'pp-summary-row' : ''}>
                <td className="pp-col-wbs">{task.wbs || ''}</td>
                <td className="pp-col-name" style={{ fontWeight: isSummary ? 600 : 400 }}>{task.name}</td>
                <td className="pp-col-num">{isMilestone ? '—' : `${task.duration || 0}d`}</td>
                <td className="pp-col-num">{resolved?.startStr ? format(resolved.start, 'dd/MM/yy') : '—'}</td>
                <td className="pp-col-num">{resolved?.finishStr ? format(resolved.finish, 'dd/MM/yy') : '—'}</td>
                <td className="pp-col-num">{percentComplete}%</td>
                <td className="pp-col-chart" style={{ width: CHART_WIDTH }}>
                  <div className="pp-chart-row" style={{ width: CHART_WIDTH }}>
                    {dataDateX !== null && (
                      <div className="pp-datadate-line" style={{ left: dataDateX }} />
                    )}
                    {baselineBar && (
                      <div className="pp-baseline-bar" style={{ left: baselineBar.left, width: baselineBar.width }} />
                    )}
                    {bar && bar.isMilestone && (
                      <div
                        className={`pp-milestone ${isCritical ? 'pp-critical' : ''}`}
                        style={{ left: bar.left - 4 }}
                      />
                    )}
                    {bar && !bar.isMilestone && (
                      <div
                        className={`pp-bar ${isSummary ? 'pp-summary-bar' : ''} ${isCritical ? 'pp-critical' : ''}`}
                        style={{ left: bar.left, width: bar.width }}
                      >
                        <div className="pp-bar-fill" style={{ width: `${percentComplete}%` }} />
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
