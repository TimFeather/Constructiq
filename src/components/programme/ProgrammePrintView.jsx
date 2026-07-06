/**
 * ProgrammePrintView — static, print-only render of the full task list + Gantt.
 * Pure renderer: no scrolling, no virtualisation, no interaction. Every row in
 * `tasks` (already expand-all + WBS ordered by the caller) is rendered, and the
 * whole project date range is squeezed into a fixed chart width so the timeline
 * fits the printed page instead of being clipped by a scroll viewport.
 *
 * Captures the same data the interactive Gantt shows: predecessors (MS
 * Project-style "12FS+2d" text, since bar-index math can't survive page
 * breaks), total float, a best-effort dependency arrow overlay, today line
 * and a legend — not just the task list.
 */
import React, { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { differenceInDays, format, eachMonthOfInterval, eachWeekOfInterval, addDays } from 'date-fns';
import { getVisibleTasks } from '@/lib/programme/visibleTasks';
import { predecessorLabel, wbsLabelMap } from '@/lib/scheduleExport';
import { DEP_COLORS } from './GanttChart';

const CHART_WIDTH = 600; // px — fits an A4 landscape page alongside the wider task columns

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

  const rowNumMap = useMemo(
    () => new Map(visibleTasks.map((t, i) => [t.id, i + 1])),
    [visibleTasks]
  );

  const wbsMap = useMemo(() => wbsLabelMap(visibleTasks), [visibleTasks]);

  const { minDate, totalDays, timeline } = useMemo(() => {
    const dates = [];
    scheduledMap?.forEach(r => {
      if (r.start) dates.push(r.start);
      if (r.finish) dates.push(r.finish);
    });
    if (dates.length === 0) {
      const today = new Date();
      return { minDate: today, totalDays: 1, timeline: { top: [], bottom: [] } };
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const padMin = addDays(min, -3);
    const padMax = addDays(max, 3);
    const total = Math.max(1, differenceInDays(padMax, padMin) + 1);
    const toPx = (days) => (days / total) * CHART_WIDTH;

    const monthStrip = () => eachMonthOfInterval({ start: padMin, end: padMax }).map(d => {
      const monthStart = d < padMin ? padMin : d;
      const monthEnd = addDays(d, 32 - d.getDate()) > padMax ? padMax : new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const left = Math.round(toPx(differenceInDays(monthStart, padMin)));
      const width = Math.max(1, Math.round(toPx(differenceInDays(monthEnd, monthStart) + 1)));
      return { label: format(d, 'MMM'), left, width };
    });

    const yearStrip = () => {
      const years = [...new Set(eachMonthOfInterval({ start: padMin, end: padMax }).map(d => d.getFullYear()))];
      return years.map(y => {
        const yStart = new Date(y, 0, 1) < padMin ? padMin : new Date(y, 0, 1);
        const yEnd = new Date(y, 11, 31) > padMax ? padMax : new Date(y, 11, 31);
        const left = Math.round(toPx(differenceInDays(yStart, padMin)));
        const width = Math.max(1, Math.round(toPx(differenceInDays(yEnd, yStart) + 1)));
        return { label: String(y), left, width };
      });
    };

    let top, bottom;
    if (total <= 45) {
      top = monthStrip().map(m => ({ ...m, label: `${m.label} ${format(padMin, 'yyyy')}` }));
      bottom = eachWeekOfInterval({ start: padMin, end: padMax }).map(d => {
        const left = Math.round(toPx(differenceInDays(d, padMin)));
        const width = Math.max(1, Math.round(toPx(7)));
        return { label: format(d, 'dd/MM'), left, width };
      });
    } else if (total <= 400) {
      const years = new Set(eachMonthOfInterval({ start: padMin, end: padMax }).map(d => d.getFullYear()));
      top = years.size > 1 ? yearStrip() : [];
      bottom = monthStrip();
    } else {
      top = yearStrip();
      bottom = monthStrip().map(m => (m.width < 18 ? { ...m, label: '' } : m));
    }

    return { minDate: padMin, totalDays: total, timeline: { top, bottom } };
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

  const todayX = dayToPx(differenceInDays(new Date(), minDate));
  const showTodayLine = todayX >= 0 && todayX <= CHART_WIDTH;

  // ─── Dependency arrow overlay — measured from real row/column DOM positions ──
  const wrapRef = useRef(null);
  const chartColRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [arrows, setArrows] = useState([]);

  const setRowRef = useCallback((taskId, el) => {
    if (el) rowRefs.current.set(taskId, el);
    else rowRefs.current.delete(taskId);
  }, []);

  useLayoutEffect(() => {
    const wrapEl = wrapRef.current;
    const chartColEl = chartColRef.current;
    if (!wrapEl || !chartColEl) return;

    const wrapRect = wrapEl.getBoundingClientRect();
    const chartColLeft = chartColEl.getBoundingClientRect().left - wrapRect.left;
    const ELBOW = 6;
    const result = [];

    for (const task of visibleTasks) {
      const taskBar = getBar(task);
      const taskRowEl = rowRefs.current.get(task.id);
      if (!taskBar || !taskRowEl) continue;
      const taskCy = taskRowEl.getBoundingClientRect().top - wrapRect.top + taskRowEl.getBoundingClientRect().height / 2;

      for (const dep of (task.predecessors || [])) {
        const pid = dep.predecessor_id || dep.task_id;
        const predRowEl = rowRefs.current.get(pid);
        const predTask = visibleTasks.find(t => t.id === pid);
        if (!predRowEl || !predTask) continue;
        const predBar = getBar(predTask);
        if (!predBar) continue;
        const predCy = predRowEl.getBoundingClientRect().top - wrapRect.top + predRowEl.getBoundingClientRect().height / 2;

        const type = dep.type || 'FS';
        const color = DEP_COLORS[type] || DEP_COLORS.FS;

        let ox, oy, tx, ty;
        switch (type) {
          case 'SS': ox = predBar.left; oy = predCy; tx = taskBar.left; ty = taskCy; break;
          case 'FF': ox = predBar.left + predBar.width; oy = predCy; tx = taskBar.left + taskBar.width; ty = taskCy; break;
          case 'SF': ox = predBar.left; oy = predCy; tx = taskBar.left + taskBar.width; ty = taskCy; break;
          default:   ox = predBar.left + predBar.width; oy = predCy; tx = taskBar.left; ty = taskCy;
        }
        ox += chartColLeft; tx += chartColLeft;

        const goRight = type === 'FS' || type === 'FF';
        const arriveRight = type === 'FF' || type === 'SF';
        const stubOx = goRight ? ox + ELBOW : ox - ELBOW;
        const stubTx = arriveRight ? tx + ELBOW : tx - ELBOW;
        const midY = (oy + ty) / 2;

        const pathD = oy === ty
          ? `M ${ox} ${oy} L ${tx} ${ty}`
          : `M ${ox} ${oy} L ${stubOx} ${oy} L ${stubOx} ${midY} L ${stubTx} ${midY} L ${stubTx} ${ty} L ${tx} ${ty}`;

        const bothCritical = (scheduledMap?.get(pid)?.isCritical || false)
          && (scheduledMap?.get(task.id)?.isCritical || false);

        result.push({ pathD, color: bothCritical ? '#dc2626' : color, key: `${pid}-${task.id}-${type}` });
      }
    }
    setArrows(result);
  }, [visibleTasks, scheduledMap, totalDays, minDate]);

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

      <div className="pp-legend">
        <span className="pp-legend-item"><span className="pp-swatch pp-swatch-bar" /> Task</span>
        <span className="pp-legend-item"><span className="pp-swatch pp-swatch-bar pp-swatch-critical" /> Critical</span>
        <span className="pp-legend-item"><span className="pp-swatch pp-swatch-bar pp-swatch-summary" /> Summary</span>
        <span className="pp-legend-item"><span className="pp-swatch pp-swatch-milestone" /> Milestone</span>
        <span className="pp-legend-item"><span className="pp-swatch pp-swatch-baseline" /> Baseline</span>
        <span className="pp-legend-item"><span className="pp-swatch pp-swatch-datadate" /> Data date</span>
        <span className="pp-legend-item"><span className="pp-swatch pp-swatch-today" /> Today</span>
        {Object.entries(DEP_COLORS).map(([type, color]) => (
          <span className="pp-legend-item" key={type}>
            <span className="pp-swatch pp-swatch-dep" style={{ background: color }} /> {type}
          </span>
        ))}
      </div>

      <div className="pp-chart-wrap" ref={wrapRef}>
        <table className="pp-table">
          <thead>
            <tr>
              <th className="pp-col-rownum">#</th>
              <th className="pp-col-wbs">WBS</th>
              <th className="pp-col-name">Task Name</th>
              <th className="pp-col-num">Dur</th>
              <th className="pp-col-num">Start</th>
              <th className="pp-col-num">Finish</th>
              <th className="pp-col-num">%</th>
              <th className="pp-col-preds">Predecessors</th>
              <th className="pp-col-float">Float</th>
              <th className="pp-col-chart" style={{ width: CHART_WIDTH }} ref={chartColRef}>
                <div className="pp-timeline-header" style={{ width: CHART_WIDTH }}>
                  <div className="pp-tl-top">
                    {timeline.top.map((m, i) => (
                      <div key={i} className="pp-tl-cell" style={{ left: m.left, width: m.width }}>{m.label}</div>
                    ))}
                  </div>
                  <div className="pp-tl-bottom">
                    {timeline.bottom.map((m, i) => (
                      <div key={i} className="pp-tl-cell" style={{ left: m.left, width: m.width }}>{m.label}</div>
                    ))}
                  </div>
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
              const totalFloatDays = resolved?.totalFloat != null ? Math.round(resolved.totalFloat / 8) : null;

              return (
                <tr key={task.id} className={isSummary ? 'pp-summary-row' : ''} ref={(el) => setRowRef(task.id, el)}>
                  <td className="pp-col-rownum">{rowNumMap.get(task.id)}</td>
                  <td className="pp-col-wbs">{task.wbs || ''}</td>
                  <td className="pp-col-name" style={{ fontWeight: isSummary ? 600 : 400 }}>{task.name}</td>
                  <td className="pp-col-num">{isMilestone ? '—' : `${task.duration || 0}d`}</td>
                  <td className="pp-col-num">{resolved?.startStr ? format(resolved.start, 'dd/MM/yy') : '—'}</td>
                  <td className="pp-col-num">{resolved?.finishStr ? format(resolved.finish, 'dd/MM/yy') : '—'}</td>
                  <td className="pp-col-num">{percentComplete}%</td>
                  <td className="pp-col-preds">{predecessorLabel(task.predecessors, wbsMap)}</td>
                  <td className="pp-col-float">{totalFloatDays === null ? '—' : `${totalFloatDays}d`}</td>
                  <td className="pp-col-chart" style={{ width: CHART_WIDTH }}>
                    <div className="pp-chart-row" style={{ width: CHART_WIDTH }}>
                      {dataDateX !== null && (
                        <div className="pp-datadate-line" style={{ left: dataDateX }} />
                      )}
                      {showTodayLine && (
                        <div className="pp-today-line" style={{ left: todayX }} />
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
        <svg className="pp-dep-svg">
          {arrows.map(a => (
            <path key={a.key} d={a.pathD} stroke={a.color} fill="none" strokeWidth="0.75" strokeDasharray="3,2" />
          ))}
        </svg>
      </div>
    </div>
  );
}
