/**
 * GanttChart — pure renderer.
 * This component performs ZERO scheduling calculations.
 * All schedule data is passed in via props (scheduledMap from the engine).
 */
import React, { useMemo, useRef, useCallback } from 'react';
import { differenceInDays, addDays, format, eachWeekOfInterval, eachDayOfInterval, isToday, isWeekend, eachMonthOfInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import { flattenTasks } from '@/lib/flattenTasks';

import { ROW_HEIGHT } from './TaskList';

const ROW_H = ROW_HEIGHT;

const DEP_COLORS = {
  FS: '#3b82f6',
  SS: '#10b981',
  FF: '#f59e0b',
  SF: '#a855f7',
};

const ZOOM_DAY_WIDTHS = {
  day: 40,
  week: 18,
  month: 5,
  quarter: 3,
  year: 1.2,
};

export default function GanttChart({
  tasks,
  scheduledMap,   // Map<id, ScheduleResult> — from scheduleEngine, computed in parent
  zoom = 'week',
  scrollRef,
  onScroll,
  baselineMap,    // Map<task_id, { baseline_start, baseline_finish }> — optional
  onTaskClick,
}) {
  const dayWidth = ZOOM_DAY_WIDTHS[zoom] || 18;

  // ─── Timeline bounds ────────────────────────────────────────────────────────
  const { minDate, maxDate, totalDays, dateHeaders } = useMemo(() => {
    const dates = [];
    if (scheduledMap) {
      scheduledMap.forEach(r => {
        if (r.start) dates.push(r.start);
        if (r.finish) dates.push(r.finish);
      });
    }
    tasks.forEach(t => {
      if (t.start_date) dates.push(new Date(t.start_date));
      if (t.end_date) dates.push(new Date(t.end_date));
    });

    if (dates.length === 0) {
      const today = new Date();
      return {
        minDate: addDays(today, -7),
        maxDate: addDays(today, 60),
        totalDays: 67,
        dateHeaders: [],
      };
    }

    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const padMin = addDays(min, -7);
    const padMax = addDays(max, 21);
    const total = differenceInDays(padMax, padMin) + 1;

    let headers = [];

    if (zoom === 'day') {
      headers = eachDayOfInterval({ start: padMin, end: padMax }).map(d => ({
        date: d,
        label: format(d, 'd'),
        sublabel: format(d, 'EEE'),
        isWeekend: isWeekend(d),
        isToday: isToday(d),
        width: dayWidth,
      }));
    } else if (zoom === 'week') {
      headers = eachWeekOfInterval({ start: padMin, end: padMax }).map(d => ({
        date: d,
        label: format(d, 'MMM d'),
        sublabel: format(d, "'W'ww yyyy"),
        width: dayWidth * 7,
      }));
    } else if (zoom === 'month') {
      headers = eachMonthOfInterval({ start: padMin, end: padMax }).map(d => ({
        date: d,
        label: format(d, 'MMM yyyy'),
        sublabel: '',
        width: dayWidth * 30,
      }));
    } else if (zoom === 'quarter') {
      headers = eachMonthOfInterval({ start: padMin, end: padMax })
        .filter((_, i) => i % 3 === 0)
        .map(d => ({
          date: d,
          label: `Q${Math.floor(d.getMonth() / 3) + 1} ${format(d, 'yyyy')}`,
          sublabel: '',
          width: dayWidth * 91,
        }));
    } else {
      // year
      const years = new Set(eachMonthOfInterval({ start: padMin, end: padMax }).map(d => d.getFullYear()));
      headers = [...years].map(y => ({
        date: new Date(y, 0, 1),
        label: String(y),
        sublabel: '',
        width: dayWidth * 365,
      }));
    }

    return { minDate: padMin, maxDate: padMax, totalDays: total, dateHeaders: headers };
  }, [tasks, scheduledMap, zoom, dayWidth]);

  // ─── Flatten task tree ───────────────────────────────────────────────────────
  const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);

  // ─── Bar geometry helper ─────────────────────────────────────────────────────
  const getBar = useCallback((task) => {
    const resolved = scheduledMap?.get(task.id);
    const startDate = resolved?.start || (task.start_date ? new Date(task.start_date) : null);
    const endDate = resolved?.finish || (task.end_date ? new Date(task.end_date) : null);
    if (!startDate || !endDate) return null;

    const left = Math.round(differenceInDays(startDate, minDate) * dayWidth);
    const isMilestone = task.is_milestone || task.duration === 0;
    if (isMilestone) return { left, width: 0, isMilestone: true };

    const duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
    const width = Math.max(duration * dayWidth, dayWidth);
    return { left, width, isMilestone: false };
  }, [scheduledMap, minDate, dayWidth]);

  // ─── Dependency arrows ───────────────────────────────────────────────────────
  const arrows = useMemo(() => {
    const result = [];
    const taskIndexMap = new Map(flatTasks.map((t, i) => [t.id, i]));
    const ELBOW = 8;

    for (const task of flatTasks) {
      const taskIdx = taskIndexMap.get(task.id);
      const taskBar = getBar(task);
      if (!taskBar) continue;

      for (const dep of (task.predecessors || [])) {
        const pid = dep.predecessor_id || dep.task_id;
        const predIdx = taskIndexMap.get(pid);
        if (predIdx === undefined) continue;

        const predTask = flatTasks[predIdx];
        const predBar = getBar(predTask);
        if (!predBar) continue;

        const type = dep.type || 'FS';
        const color = DEP_COLORS[type] || DEP_COLORS.FS;
        const predCy = predIdx * ROW_H + ROW_H / 2;
        const taskCy = taskIdx * ROW_H + ROW_H / 2;

        let ox, oy, tx, ty;
        switch (type) {
          case 'SS':
            ox = predBar.left; oy = predCy; tx = taskBar.left; ty = taskCy; break;
          case 'FF':
            ox = predBar.left + predBar.width; oy = predCy; tx = taskBar.left + taskBar.width; ty = taskCy; break;
          case 'SF':
            ox = predBar.left; oy = predCy; tx = taskBar.left + taskBar.width; ty = taskCy; break;
          default: // FS
            ox = predBar.left + predBar.width; oy = predCy; tx = taskBar.left; ty = taskCy;
        }

        const goRight = type === 'FS' || type === 'FF';
        const arriveRight = type === 'FF' || type === 'SF';
        const stubOx = goRight ? ox + ELBOW : ox - ELBOW;
        const stubTx = arriveRight ? tx + ELBOW : tx - ELBOW;
        const midY = (oy + ty) / 2;

        let pathD;
        if (oy === ty) {
          pathD = `M ${ox} ${oy} L ${tx} ${ty}`;
        } else {
          pathD = `M ${ox} ${oy} L ${stubOx} ${oy} L ${stubOx} ${midY} L ${stubTx} ${midY} L ${stubTx} ${ty} L ${tx} ${ty}`;
        }

        result.push({ pathD, color, type, key: `${pid}-${task.id}-${type}` });
      }
    }

    return result;
  }, [flatTasks, getBar]);

  const chartWidth = Math.max(totalDays * dayWidth, 400);
  const chartHeight = flatTasks.length * ROW_H + 50;
  const todayX = Math.round(differenceInDays(new Date(), minDate) * dayWidth);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      {/* Fixed header row 1 */}
      <div className="flex-shrink-0 h-10 border-b bg-muted/30 flex items-center px-3">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Timeline</span>
      </div>

      {/* Date header row — synced horizontally */}
      <div className="flex-shrink-0 h-10 border-b bg-muted/30 overflow-hidden" id="gantt-date-header">
        <div className="flex h-full" style={{ minWidth: chartWidth }}>
          {dateHeaders.map((h, i) => (
            <div
              key={i}
              className={cn(
                "flex-shrink-0 border-r border-border/40 flex flex-col items-center justify-center",
                h.isWeekend && "bg-muted/50",
                h.isToday && "bg-primary/10",
              )}
              style={{ width: h.width }}
            >
              <span className={cn("text-[10px] font-semibold truncate px-1", h.isToday ? "text-primary" : "text-muted-foreground")}>
                {h.label}
              </span>
              {h.sublabel && (zoom === 'day' || zoom === 'week') && (
                <span className="text-[9px] text-muted-foreground/60">{h.sublabel}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable body */}
      <div
        className="flex-1 overflow-auto"
        ref={scrollRef}
        onScroll={(e) => {
          const header = document.getElementById('gantt-date-header');
          if (header) header.scrollLeft = e.currentTarget.scrollLeft;
          onScroll?.(e);
        }}
      >
        <div style={{ minWidth: chartWidth }} className="relative">
          <div className="relative" style={{ height: chartHeight }}>

            {/* Weekend shading (day view) */}
            {zoom === 'day' && dateHeaders.filter(h => h.isWeekend).map((h, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 bg-muted/30 pointer-events-none"
                style={{ left: differenceInDays(h.date, minDate) * dayWidth, width: dayWidth }}
              />
            ))}

            {/* Vertical grid lines */}
            {dateHeaders.map((h, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-r border-border/15 pointer-events-none"
                style={{ left: Math.round(differenceInDays(h.date, minDate) * dayWidth) }}
              />
            ))}

            {/* Today line */}
            {todayX >= 0 && todayX <= chartWidth && (
              <div
                className="absolute top-0 bottom-0 border-r-2 border-primary/70 pointer-events-none z-10"
                style={{ left: todayX }}
              >
                <div className="absolute top-0 left-0 -translate-x-1/2 text-[9px] bg-primary text-primary-foreground px-1 rounded-b z-20">
                  Today
                </div>
              </div>
            )}

            {/* Row backgrounds */}
            {flatTasks.map((_, i) => (
              <div
                key={i}
                className={cn("absolute w-full border-b border-border/10", i % 2 === 0 ? "bg-muted/5" : "")}
                style={{ top: i * ROW_H, height: ROW_H }}
              />
            ))}

            {/* Dependency arrows (SVG) */}
            <svg
              className="absolute inset-0 pointer-events-none overflow-visible"
              width={chartWidth}
              height={chartHeight}
              style={{ zIndex: 1 }}
            >
              <defs>
                {Object.entries(DEP_COLORS).map(([type, color]) => (
                  <marker key={type} id={`arrow-${type}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill={color} />
                  </marker>
                ))}
              </defs>
              {arrows.map(({ pathD, color, type, key }) => (
                <g key={key}>
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth="6" />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeDasharray="5 3"
                    opacity="0.8"
                    markerEnd={`url(#arrow-${type})`}
                  />
                </g>
              ))}
            </svg>

            {/* Task bars */}
            {flatTasks.map((task, i) => {
              const bar = getBar(task);
              if (!bar) return null;

              const resolved = scheduledMap?.get(task.id);
              const isCritical = resolved?.isCritical || false;
              const isMilestoneTask = bar.isMilestone;
              const hasChildren = tasks.some(t => t.parent_id === task.id);
              const isSummary = hasChildren;
              const percentComplete = task.percent_complete || 0;
              const totalFloat = resolved?.totalFloat ?? null;

              // Baseline bar
              const baseline = baselineMap?.get(task.id);
              const baselineBar = baseline ? (() => {
                const bs = baseline.baseline_start ? new Date(baseline.baseline_start) : null;
                const bf = baseline.baseline_finish ? new Date(baseline.baseline_finish) : null;
                if (!bs || !bf) return null;
                const bleft = Math.round(differenceInDays(bs, minDate) * dayWidth);
                const bduration = Math.max(1, differenceInDays(bf, bs) + 1);
                return { left: bleft, width: Math.max(bduration * dayWidth, dayWidth) };
              })() : null;

              const top = i * ROW_H;

              if (isMilestoneTask) {
                // Diamond milestone symbol
                const cx = bar.left;
                const cy = top + ROW_H / 2;
                const size = 7;
                return (
                  <svg
                    key={task.id}
                    className="absolute pointer-events-auto cursor-pointer"
                    style={{ left: cx - size - 2, top: cy - size - 2, overflow: 'visible', zIndex: 2 }}
                    width={size * 2 + 4}
                    height={size * 2 + 4}
                    onClick={() => onTaskClick?.(task)}
                  >
                    <polygon
                      points={`${size + 2},2 ${size * 2 + 2},${size + 2} ${size + 2},${size * 2 + 2} 2,${size + 2}`}
                      fill={isCritical ? '#ef4444' : '#6366f1'}
                      stroke={isCritical ? '#b91c1c' : '#4f46e5'}
                      strokeWidth="1"
                    />
                  </svg>
                );
              }

              if (isSummary) {
                return (
                  <React.Fragment key={task.id}>
                    {baselineBar && (
                      <div
                        className="absolute pointer-events-none opacity-40 border border-muted-foreground/50"
                        style={{
                          left: baselineBar.left,
                          width: baselineBar.width,
                          top: top + ROW_H - 6,
                          height: 4,
                          background: 'repeating-linear-gradient(90deg, #94a3b8 0px, #94a3b8 4px, transparent 4px, transparent 8px)',
                        }}
                      />
                    )}
                    <div
                      className={cn(
                        "absolute flex items-center cursor-pointer",
                        isCritical ? "bg-red-500" : "bg-primary",
                      )}
                      style={{ left: bar.left, width: bar.width, top: top + 6, height: ROW_H - 12, borderRadius: 2 }}
                      title={`${task.name} (Summary)${isCritical ? ' — CRITICAL' : ''}`}
                      onClick={() => onTaskClick?.(task)}
                    >
                      <div className="absolute inset-0 bg-black/20 rounded" style={{ width: `${percentComplete}%` }} />
                      {bar.width > 50 && (
                        <span className="absolute left-2 text-[9px] text-white font-semibold truncate" style={{ maxWidth: bar.width - 16 }}>
                          {task.name}
                        </span>
                      )}
                    </div>
                  </React.Fragment>
                );
              }

              // Normal task bar
              const barColor = isCritical ? 'bg-red-500 hover:bg-red-400' : 'bg-accent hover:bg-accent/80';
              return (
                <React.Fragment key={task.id}>
                  {baselineBar && (
                    <div
                      className="absolute pointer-events-none opacity-50"
                      style={{
                        left: baselineBar.left,
                        width: baselineBar.width,
                        top: top + ROW_H - 5,
                        height: 3,
                        background: '#94a3b8',
                        borderRadius: 1,
                      }}
                    />
                  )}
                  <div
                    className={cn("absolute rounded transition-all hover:shadow-md cursor-pointer group", barColor)}
                    style={{ left: bar.left, width: bar.width, top: top + 4, height: ROW_H - 8, zIndex: 2 }}
                    title={`${task.name}\n${task.start_date} → ${task.end_date}\n${task.duration || 0}d | ${percentComplete}%${isCritical ? '\n⚠ CRITICAL PATH' : ''}${totalFloat !== null ? `\nFloat: ${Math.round(totalFloat / 8)}d` : ''}`}
                    onClick={() => onTaskClick?.(task)}
                  >
                    {/* Critical path left edge indicator */}
                    {isCritical && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-700 rounded-l" />
                    )}
                    {percentComplete > 0 && (
                      <div className="absolute inset-0 bg-white/30 rounded" style={{ width: `${percentComplete}%` }} />
                    )}
                    {bar.width > 50 && (
                      <span className="absolute left-2 text-[10px] text-white font-medium truncate leading-tight pointer-events-none" style={{ maxWidth: bar.width - 16, top: '50%', transform: 'translateY(-50%)' }}>
                        {task.name}
                      </span>
                    )}
                    <span className="absolute right-1 text-[9px] text-white/80 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ top: '50%', transform: 'translateY(-50%)' }}>
                      {percentComplete}%
                    </span>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}