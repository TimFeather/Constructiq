import React, { useMemo } from 'react';
import { differenceInDays, addDays, format, startOfWeek, eachWeekOfInterval, eachDayOfInterval } from 'date-fns';
import { cn } from '@/lib/utils';

const levelColors = [
  'bg-primary',
  'bg-accent',
  'bg-amber-500',
  'bg-purple-500',
];

export default function GanttChart({ tasks, zoom = 'week' }) {
  const { minDate, maxDate, dayWidth, totalDays, dateHeaders } = useMemo(() => {
    const dates = tasks
      .filter(t => t.start_date && t.end_date)
      .flatMap(t => [new Date(t.start_date), new Date(t.end_date)]);

    if (dates.length === 0) {
      const today = new Date();
      return {
        minDate: today,
        maxDate: addDays(today, 60),
        dayWidth: zoom === 'day' ? 40 : zoom === 'week' ? 20 : 6,
        totalDays: 60,
        dateHeaders: [],
      };
    }

    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    const padded_min = addDays(min, -7);
    const padded_max = addDays(max, 14);
    const total = differenceInDays(padded_max, padded_min) + 1;
    const dw = zoom === 'day' ? 40 : zoom === 'week' ? 20 : 6;

    let headers = [];
    if (zoom === 'day') {
      headers = eachDayOfInterval({ start: padded_min, end: padded_max }).map(d => ({
        date: d, label: format(d, 'd'), sublabel: format(d, 'EEE'),
      }));
    } else {
      headers = eachWeekOfInterval({ start: padded_min, end: padded_max }).map(d => ({
        date: d, label: format(d, 'MMM d'), sublabel: format(d, 'yyyy'),
      }));
    }

    return { minDate: padded_min, maxDate: padded_max, dayWidth: dw, totalDays: total, dateHeaders: headers };
  }, [tasks, zoom]);

  const getTaskBar = (task) => {
    if (!task.start_date || !task.end_date) return null;
    const start = differenceInDays(new Date(task.start_date), minDate);
    const duration = differenceInDays(new Date(task.end_date), new Date(task.start_date)) + 1;
    return { left: start * dayWidth, width: Math.max(duration * dayWidth, dayWidth) };
  };

  // Flatten tasks in display order
  const flatTasks = useMemo(() => {
    const result = [];
    const rootTasks = tasks.filter(t => !t.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const addTask = (task) => {
      result.push(task);
      const children = tasks.filter(t => t.parent_id === task.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      children.forEach(addTask);
    };

    rootTasks.forEach(addTask);
    return result;
  }, [tasks]);

  // Build dependency arrows
  const getArrows = () => {
    const arrows = [];
    flatTasks.forEach((task, taskIndex) => {
      if (!task.predecessors) return;
      task.predecessors.forEach(pred => {
        const predIndex = flatTasks.findIndex(t => t.id === pred.task_id);
        if (predIndex === -1) return;
        const predTask = flatTasks[predIndex];
        const predBar = getTaskBar(predTask);
        const taskBar = getTaskBar(task);
        if (!predBar || !taskBar) return;

        const startX = predBar.left + predBar.width;
        const startY = predIndex * 36 + 18;
        const endX = taskBar.left;
        const endY = taskIndex * 36 + 18;

        arrows.push({ startX, startY, endX, endY, lag: pred.lag_days || 0, key: `${predTask.id}-${task.id}` });
      });
    });
    return arrows;
  };

  const arrows = getArrows();
  const chartWidth = totalDays * dayWidth;
  const chartHeight = flatTasks.length * 36 + 50;

  return (
    <div className="flex-1 overflow-auto bg-card">
      <div style={{ minWidth: chartWidth }} className="relative">
        {/* Timeline header */}
        <div className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm border-b flex h-10">
          {dateHeaders.map((h, i) => (
            <div
              key={i}
              className="flex-shrink-0 border-r border-border/50 flex flex-col items-center justify-center"
              style={{ width: zoom === 'day' ? dayWidth : dayWidth * 7 }}
            >
              <span className="text-[10px] font-medium text-muted-foreground">{h.label}</span>
            </div>
          ))}
        </div>

        {/* Rows and bars */}
        <div className="relative" style={{ height: chartHeight }}>
          {/* Grid lines */}
          {dateHeaders.map((h, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 border-r border-border/20"
              style={{ left: (zoom === 'day' ? i * dayWidth : i * dayWidth * 7) }}
            />
          ))}

          {/* Row backgrounds */}
          {flatTasks.map((_, i) => (
            <div
              key={i}
              className={cn("absolute w-full h-9 border-b border-border/10", i % 2 === 0 && "bg-muted/10")}
              style={{ top: i * 36 }}
            />
          ))}

          {/* Task bars */}
          {flatTasks.map((task, i) => {
            const bar = getTaskBar(task);
            if (!bar) return null;
            const color = levelColors[task.level || 0] || 'bg-muted-foreground';
            const isPhase = task.level === 0;

            return (
              <div
                key={task.id}
                className={cn(
                  "absolute rounded-sm transition-all hover:opacity-80 group",
                  color,
                  isPhase ? "h-3 mt-3" : "h-6 mt-1.5"
                )}
                style={{ left: bar.left, width: bar.width, top: i * 36 }}
                title={`${task.name} (${task.duration || 0}d)`}
              >
                {/* Progress overlay */}
                {(task.percent_complete || 0) > 0 && !isPhase && (
                  <div
                    className="absolute inset-0 bg-white/30 rounded-sm"
                    style={{ width: `${task.percent_complete}%` }}
                  />
                )}
                {/* Label */}
                {bar.width > 60 && !isPhase && (
                  <span className="absolute left-2 text-[10px] text-white font-medium truncate leading-6" style={{ maxWidth: bar.width - 16 }}>
                    {task.name}
                  </span>
                )}
              </div>
            );
          })}

          {/* Dependency arrows */}
          <svg className="absolute inset-0 pointer-events-none" width={chartWidth} height={chartHeight}>
            {arrows.map(({ startX, startY, endX, endY, key }) => {
              const midX = startX + (endX - startX) / 2;
              return (
                <g key={key}>
                  <path
                    d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth="1.5"
                    strokeDasharray="4 2"
                    opacity="0.5"
                  />
                  <polygon
                    points={`${endX},${endY} ${endX - 6},${endY - 3} ${endX - 6},${endY + 3}`}
                    fill="hsl(var(--muted-foreground))"
                    opacity="0.5"
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}