import React, { useMemo } from 'react';
import { differenceInDays, addDays, format, eachWeekOfInterval, eachDayOfInterval, isToday, isWeekend } from 'date-fns';
import { cn } from '@/lib/utils';
import { runScheduleEngine } from '@/lib/schedulingEngine';
import { flattenTasks } from '@/lib/flattenTasks';

const levelColors = [
  'bg-primary',
  'bg-accent',
  'bg-amber-500',
  'bg-purple-500',
];

const DEP_COLORS = {
  FS: 'hsl(210 85% 55%)',
  SS: 'hsl(168 60% 42%)',
  FF: 'hsl(35 92% 55%)',
  SF: 'hsl(280 55% 55%)',
};

import { ROW_HEIGHT } from './TaskList';
const ROW_H = ROW_HEIGHT;

export default function GanttChart({ tasks, zoom = 'week' }) {
  const dayWidth = zoom === 'day' ? 40 : zoom === 'week' ? 18 : 5;

  // Run scheduling engine to get resolved dates
  const scheduledDates = useMemo(() => {
    if (!tasks.length) return new Map();
    const projectStart = tasks.reduce((min, t) => {
      if (!t.start_date) return min;
      return t.start_date < min ? t.start_date : min;
    }, tasks.find(t => t.start_date)?.start_date || new Date().toISOString().split('T')[0]);
    return runScheduleEngine(tasks, projectStart);
  }, [tasks]);

  const { minDate, maxDate, totalDays, dateHeaders } = useMemo(() => {
    const dates = [];
    scheduledDates.forEach(r => { dates.push(r.start, r.finish); });
    tasks.forEach(t => {
      if (t.start_date) dates.push(new Date(t.start_date));
      if (t.end_date) dates.push(new Date(t.end_date));
    });

    if (dates.length === 0) {
      const today = new Date();
      const padMin = addDays(today, -7);
      const padMax = addDays(today, 60);
      return { minDate: padMin, maxDate: padMax, totalDays: 67, dateHeaders: [] };
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
      }));
    } else if (zoom === 'week') {
      headers = eachWeekOfInterval({ start: padMin, end: padMax }).map(d => ({
        date: d,
        label: format(d, 'MMM d'),
        sublabel: format(d, "'W'ww yyyy"),
      }));
    } else {
      // month zoom
      headers = eachWeekOfInterval({ start: padMin, end: padMax })
        .filter((_, i) => i % 4 === 0 || i === 0)
        .map(d => ({ date: d, label: format(d, 'MMM yyyy'), sublabel: '' }));
    }

    return { minDate: padMin, maxDate: padMax, totalDays: total, dateHeaders: headers };
  }, [tasks, scheduledDates, zoom]);

  // Flatten tasks in display order (WBS tree walk)
  const flatTasks = useMemo(() => flattenTasks(tasks), [tasks]);

  const getBar = (task) => {
    const resolved = scheduledDates.get(task.id);
    const startDate = resolved?.start || (task.start_date ? new Date(task.start_date) : null);
    const endDate = resolved?.finish || (task.end_date ? new Date(task.end_date) : null);
    if (!startDate || !endDate) return null;
    const left = differenceInDays(startDate, minDate) * dayWidth;
    const duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
    const width = Math.max(duration * dayWidth, dayWidth);
    return { left, width };
  };

  // Build dependency arrows with type-aware anchor points
  const arrows = useMemo(() => {
    const result = [];
    const taskIndexMap = new Map(flatTasks.map((t, i) => [t.id, i]));

    flatTasks.forEach((task) => {
      const taskIdx = taskIndexMap.get(task.id);
      const taskBar = getBar(task);
      if (!taskBar) return;

      (task.predecessors || []).forEach(dep => {
        const pid = dep.predecessor_id || dep.task_id;
        const predIdx = taskIndexMap.get(pid);
        if (predIdx === undefined) return;

        const predTask = flatTasks[predIdx];
        const predBar = getBar(predTask);
        if (!predBar) return;

        const type = dep.type || 'FS';
        const color = DEP_COLORS[type] || DEP_COLORS.FS;

        const predCy = predIdx * ROW_H + ROW_H / 2;
        const taskCy = taskIdx * ROW_H + ROW_H / 2;

        let startX, startY, endX, endY;

        switch (type) {
          case 'FS':
            startX = predBar.left + predBar.width; // pred finish
            startY = predCy;
            endX = taskBar.left;                    // succ start
            endY = taskCy;
            break;
          case 'SS':
            startX = predBar.left;                  // pred start
            startY = predCy;
            endX = taskBar.left;                    // succ start
            endY = taskCy;
            break;
          case 'FF':
            startX = predBar.left + predBar.width;  // pred finish
            startY = predCy;
            endX = taskBar.left + taskBar.width;    // succ finish
            endY = taskCy;
            break;
          case 'SF':
            startX = predBar.left;                  // pred start
            startY = predCy;
            endX = taskBar.left + taskBar.width;    // succ finish
            endY = taskCy;
            break;
          default:
            startX = predBar.left + predBar.width;
            startY = predCy;
            endX = taskBar.left;
            endY = taskCy;
        }

        result.push({ startX, startY, endX, endY, color, type, key: `${pid}-${task.id}-${type}` });
      });
    });

    return result;
  }, [flatTasks, scheduledDates, minDate, dayWidth]);

  const chartWidth = Math.max(totalDays * dayWidth, 400);
  const chartHeight = flatTasks.length * ROW_H + 50;
  const todayX = differenceInDays(new Date(), minDate) * dayWidth;

  return (
    <div className="flex-1 overflow-auto bg-card">
      <div style={{ minWidth: chartWidth }} className="relative">
        {/* Timeline header */}
        <div className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm border-b">
          <div className="flex h-10">
            {dateHeaders.map((h, i) => (
              <div
                key={i}
                className={cn(
                  "flex-shrink-0 border-r border-border/40 flex flex-col items-center justify-center",
                  h.isWeekend && "bg-muted/50",
                  h.isToday && "bg-primary/10",
                )}
                style={{ width: zoom === 'day' ? dayWidth : zoom === 'week' ? dayWidth * 7 : dayWidth * 28 }}
              >
                <span className={cn("text-[10px] font-semibold", h.isToday ? "text-primary" : "text-muted-foreground")}>
                  {h.label}
                </span>
                {h.sublabel && zoom !== 'month' && (
                  <span className="text-[9px] text-muted-foreground/60">{h.sublabel}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Chart body */}
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
              style={{ left: zoom === 'day' ? i * dayWidth : zoom === 'week' ? i * dayWidth * 7 : i * dayWidth * 28 }}
            />
          ))}

          {/* Today line */}
          {todayX >= 0 && todayX <= chartWidth && (
            <div
              className="absolute top-0 bottom-0 border-r-2 border-primary/60 pointer-events-none z-10"
              style={{ left: todayX }}
            >
              <div className="absolute -top-0 left-0 -translate-x-1/2 text-[9px] bg-primary text-primary-foreground px-1 rounded-b">
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
          <svg className="absolute inset-0 pointer-events-none overflow-visible" width={chartWidth} height={chartHeight}>
            <defs>
              {Object.entries(DEP_COLORS).map(([type, color]) => (
                <marker key={type} id={`arrow-${type}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill={color} opacity="0.7" />
                </marker>
              ))}
            </defs>
            {arrows.map(({ startX, startY, endX, endY, color, type, key }) => {
              // Route: elbow connector for cleaner look
              const midX = startX + (endX - startX) * 0.5;
              const dx = endX - startX;
              const pathD = Math.abs(dx) > 20
                ? `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`
                : `M ${startX} ${startY} L ${startX + 10} ${startY} L ${startX + 10} ${endY} L ${endX} ${endY}`;

              return (
                <g key={key}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeDasharray="5 2"
                    opacity="0.65"
                    markerEnd={`url(#arrow-${type})`}
                  />
                </g>
              );
            })}
          </svg>

          {/* Task bars */}
          {flatTasks.map((task, i) => {
            const bar = getBar(task);
            if (!bar) return null;

            const isSummary = task.is_summary || task.level === 0 || task.level === 1;
            const color = levelColors[task.level || 0] || 'bg-muted-foreground';
            const percentComplete = task.percent_complete || 0;

            if (isSummary) {
              // Diamond/chevron style for phase/summary
              return (
                <div
                  key={task.id}
                  className={cn("absolute flex items-center", color)}
                  style={{ left: bar.left, width: bar.width, top: i * ROW_H + 6, height: 28, borderRadius: 2 }}
                  title={`${task.name} (${task.duration || 0}d) — Summary`}
                >
                  <div className="absolute inset-0 bg-black/20 rounded" style={{ width: `${percentComplete}%` }} />
                  {bar.width > 50 && (
                    <span className="absolute left-2 text-[9px] text-white font-semibold truncate" style={{ maxWidth: bar.width - 16 }}>
                      {task.name}
                    </span>
                  )}
                </div>
              );
            }

            return (
              <div
                key={task.id}
                className={cn(
                  "absolute rounded transition-all hover:opacity-80 hover:shadow-md cursor-pointer group",
                  color,
                )}
                style={{ left: bar.left, width: bar.width, top: i * ROW_H + 3, height: 34 }}
                title={`${task.name}\n${task.start_date} → ${task.end_date}\n${task.duration || 0}d | ${percentComplete}%`}
              >
                {/* Progress overlay */}
                {percentComplete > 0 && (
                  <div
                    className="absolute inset-0 bg-white/30 rounded"
                    style={{ width: `${percentComplete}%` }}
                  />
                )}
                {/* Label */}
                {bar.width > 50 && (
                  <span className="absolute left-2 text-[10px] text-white font-medium truncate leading-tight pointer-events-none" style={{ maxWidth: bar.width - 16, top: '50%', transform: 'translateY(-50%)' }}>
                    {task.name}
                  </span>
                )}
                {/* Percent label on hover */}
                <span className="absolute right-1 text-[9px] text-white/80 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ top: '50%', transform: 'translateY(-50%)' }}>
                  {percentComplete}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}