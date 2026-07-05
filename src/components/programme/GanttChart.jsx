/**
 * GanttChart — pure renderer.
 * Receives pre-computed visibleTasks (same list as TaskList) for perfect row alignment.
 * Performs ZERO scheduling calculations.
 */
import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { differenceInDays, addDays, format, eachWeekOfInterval, eachDayOfInterval, isToday, isWeekend, eachMonthOfInterval } from 'date-fns';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Format a Date as 'yyyy-MM-dd' from LOCAL components (never toISOString — NZ tz shifts dates).
function formatLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];

export { ROW_HEIGHT } from './TaskList';
import { ROW_HEIGHT } from './TaskList';

const ROW_H = ROW_HEIGHT;

export const DEP_COLORS = {
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
  tasks,          // full task list (for bounds calculation)
  visibleTasks,   // pre-computed visible rows — MUST match TaskList exactly
  scheduledMap,
  zoom = 'week',
  scrollRef,
  onScroll,
  baselineMap,
  onTaskClick,
  // ─── Interactive authoring (all optional, gated by `editable`) ───────────────
  editable = false,
  dataDate = null,          // 'yyyy-MM-dd' — render a marker line like the Today line
  criticalOnly = false,     // dim non-critical work
  onMoveTask,               // (taskId, newStartDateStr) => void
  onResizeTask,             // (taskId, newDurationDays) => void
  onCreateDependency,       // ({ predecessorId, successorId, type, lagDays }) => void
  hoveredTaskId = null,     // shared row-hover highlight (synced with TaskList)
  onHoverTask,              // (taskId | null) => void
}) {
  const dayWidth = ZOOM_DAY_WIDTHS[zoom] || 18;
  const scrolledToday = useRef(false);
  const dateHeaderRef = useRef(null);
  const chartBodyRef = useRef(null);      // inner relative container (chart-relative coords)

  // Active bar move/resize drag. { taskId, mode:'move'|'resize', startClientX, dx, snappedDays }
  const [barDrag, setBarDrag] = useState(null);
  // Active dependency-link drag. { sourceTaskId, sourceEnd:'start'|'finish', x, y, targetRowIdx }
  const [linkDrag, setLinkDrag] = useState(null);
  // Pending dependency awaiting confirmation.
  // { predecessorId, successorId, type, lagDays, x, y }
  const [pendingDep, setPendingDep] = useState(null);
  const dragMovedRef = useRef(false);     // set when a bar drag moved > 3px; suppresses click

  // ─── Timeline bounds (based on full task set, not visible) ───────────────────
  const { minDate, totalDays, dateHeaders } = useMemo(() => {
    const dates = [];
    if (scheduledMap) {
      scheduledMap.forEach(r => {
        if (r.start) dates.push(r.start);
        if (r.finish) dates.push(r.finish);
      });
    }
    if (dates.length === 0) {
      tasks.forEach(t => {
        if (t.start_date) dates.push(new Date(t.start_date));
        if (t.end_date) dates.push(new Date(t.end_date));
      });
    }
    if (dates.length === 0) {
      const today = new Date();
      return { minDate: addDays(today, -7), totalDays: 67, dateHeaders: [] };
    }

    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const padMin = addDays(min, -7);
    const padMax = addDays(max, 21);
    const total = differenceInDays(padMax, padMin) + 1;

    let headers = [];
    if (zoom === 'day') {
      headers = eachDayOfInterval({ start: padMin, end: padMax }).map(d => ({
        date: d, label: format(d, 'd'), sublabel: format(d, 'EEE'),
        isWeekend: isWeekend(d), isToday: isToday(d), width: dayWidth,
      }));
    } else if (zoom === 'week') {
      headers = eachWeekOfInterval({ start: padMin, end: padMax }).map(d => ({
        date: d, label: format(d, 'MMM d'), sublabel: format(d, "'W'ww yyyy"), width: dayWidth * 7,
      }));
    } else if (zoom === 'month') {
      headers = eachMonthOfInterval({ start: padMin, end: padMax }).map(d => ({
        date: d, label: format(d, 'MMM yyyy'), sublabel: '', width: dayWidth * 30,
      }));
    } else if (zoom === 'quarter') {
      headers = eachMonthOfInterval({ start: padMin, end: padMax })
        .filter((_, i) => i % 3 === 0)
        .map(d => ({ date: d, label: `Q${Math.floor(d.getMonth() / 3) + 1} ${format(d, 'yyyy')}`, sublabel: '', width: dayWidth * 91 }));
    } else {
      const years = new Set(eachMonthOfInterval({ start: padMin, end: padMax }).map(d => d.getFullYear()));
      headers = [...years].map(y => ({ date: new Date(y, 0, 1), label: String(y), sublabel: '', width: dayWidth * 365 }));
    }

    return { minDate: padMin, totalDays: total, dateHeaders: headers };
  }, [tasks, scheduledMap, zoom, dayWidth]);

  // ─── Bar geometry ────────────────────────────────────────────────────────────
  const getBar = useCallback((task) => {
    const resolved = scheduledMap?.get(task.id);
    const startDate = resolved?.start ?? null;
    const endDate = resolved?.finish ?? null;
    if (!startDate || !endDate) return null;

    const left = Math.round(differenceInDays(startDate, minDate) * dayWidth);
    const isMilestone = task.is_milestone || task.duration === 0;
    if (isMilestone) return { left, width: 0, isMilestone: true };

    const duration = Math.max(1, differenceInDays(endDate, startDate) + 1);
    return { left, width: Math.max(duration * dayWidth, dayWidth), isMilestone: false };
  }, [scheduledMap, minDate, dayWidth]);

  // ─── Dependency arrows — uses visibleTasks index map for correct positions ───
  const arrows = useMemo(() => {
    const result = [];
    // Only visible rows participate — hidden rows are absent from this map
    const visibleIndexMap = new Map(visibleTasks.map((t, i) => [t.id, i]));
    const ELBOW = 8;

    for (const task of visibleTasks) {
      const taskIdx = visibleIndexMap.get(task.id);
      const taskBar = getBar(task);
      if (!taskBar) continue;

      for (const dep of (task.predecessors || [])) {
        const pid = dep.predecessor_id || dep.task_id;
        const predIdx = visibleIndexMap.get(pid);
        // Skip if predecessor is not visible (collapsed away)
        if (predIdx === undefined) continue;

        const predTask = visibleTasks[predIdx];
        const predBar = getBar(predTask);
        if (!predBar) continue;

        const type = dep.type || 'FS';
        const color = DEP_COLORS[type] || DEP_COLORS.FS;
        const predCy = predIdx * ROW_H + ROW_H / 2;
        const taskCy = taskIdx * ROW_H + ROW_H / 2;

        let ox, oy, tx, ty;
        switch (type) {
          case 'SS': ox = predBar.left; oy = predCy; tx = taskBar.left; ty = taskCy; break;
          case 'FF': ox = predBar.left + predBar.width; oy = predCy; tx = taskBar.left + taskBar.width; ty = taskCy; break;
          case 'SF': ox = predBar.left; oy = predCy; tx = taskBar.left + taskBar.width; ty = taskCy; break;
          default:   ox = predBar.left + predBar.width; oy = predCy; tx = taskBar.left; ty = taskCy;
        }

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
        result.push({ pathD, color, type, bothCritical, key: `${pid}-${task.id}-${type}` });
      }
    }
    return result;
  }, [visibleTasks, getBar, scheduledMap]);

  const chartWidth = Math.max(totalDays * dayWidth, 400);
  const chartHeight = visibleTasks.length * ROW_H + 50;
  const todayX = Math.round(differenceInDays(new Date(), minDate) * dayWidth);
  const dataDateX = dataDate
    ? Math.round(differenceInDays(new Date(dataDate + 'T00:00:00'), minDate) * dayWidth)
    : null;

  // ─── Interaction helpers ─────────────────────────────────────────────────────

  // Tasks that have children (summaries) — summaries are never draggable.
  const summaryIds = useMemo(
    () => new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id)),
    [tasks],
  );
  const isSummaryTask = useCallback(
    (task) => summaryIds.has(task.id),
    [summaryIds],
  );

  // Whether a leaf/milestone task may be edited (move/resize/link source & target).
  const canEditTask = useCallback((task) => {
    if (!editable) return false;
    if (isSummaryTask(task)) return false;
    return (task.percent_complete || 0) < 100;
  }, [editable, isSummaryTask]);

  // Chart-relative point from a pointer event (accounts for scroll offset).
  const chartPoint = useCallback((e) => {
    const el = chartBodyRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // ── Bar move / resize ──
  const beginBarDrag = useCallback((e, task, mode) => {
    if (!canEditTask(task)) return;
    if (mode === 'resize' && (task.is_milestone || task.duration === 0)) return;
    e.stopPropagation();
    e.preventDefault();
    dragMovedRef.current = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    setBarDrag({ taskId: task.id, mode, startClientX: e.clientX, dx: 0, snappedDays: 0 });
  }, [canEditTask]);

  const moveBarDrag = useCallback((e) => {
    setBarDrag(prev => {
      if (!prev) return prev;
      const dx = e.clientX - prev.startClientX;
      if (Math.abs(dx) > 3) dragMovedRef.current = true;
      const snappedDays = Math.round(dx / dayWidth);
      return { ...prev, dx, snappedDays };
    });
  }, [dayWidth]);

  const endBarDrag = useCallback((e) => {
    setBarDrag(prev => {
      if (!prev) return null;
      const days = Math.round((e.clientX - prev.startClientX) / dayWidth);
      const task = visibleTasks.find(t => t.id === prev.taskId);
      const resolved = scheduledMap?.get(prev.taskId);
      if (task && days !== 0) {
        if (prev.mode === 'move' && resolved?.start) {
          const newStart = addDays(resolved.start, days);
          onMoveTask?.(prev.taskId, formatLocal(newStart));
        } else if (prev.mode === 'resize') {
          const base = resolved?.durationDays || task.duration || 1;
          const newDuration = Math.max(1, base + days);
          if (newDuration !== base) onResizeTask?.(prev.taskId, newDuration);
        }
      }
      return null;
    });
  }, [dayWidth, visibleTasks, scheduledMap, onMoveTask, onResizeTask]);

  // ── Dependency link creation ──
  const beginLinkDrag = useCallback((e, task, sourceEnd) => {
    if (!canEditTask(task)) return;
    e.stopPropagation();
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    const p = chartPoint(e);
    setLinkDrag({ sourceTaskId: task.id, sourceEnd, x: p.x, y: p.y, targetRowIdx: null });
  }, [canEditTask, chartPoint]);

  const moveLinkDrag = useCallback((e) => {
    const p = chartPoint(e);
    setLinkDrag(prev => {
      if (!prev) return prev;
      let targetRowIdx = Math.floor(p.y / ROW_H);
      const target = visibleTasks[targetRowIdx];
      let valid = false;
      if (target && target.id !== prev.sourceTaskId && !isSummaryTask(target)) {
        const bar = getBar(target);
        if (bar) {
          const w = bar.isMilestone ? 14 : bar.width;
          const l = bar.isMilestone ? bar.left - 7 : bar.left;
          if (p.x >= l - 6 && p.x <= l + w + 6) valid = true;
        }
      }
      return { ...prev, x: p.x, y: p.y, targetRowIdx: valid ? targetRowIdx : null };
    });
  }, [chartPoint, visibleTasks, isSummaryTask, getBar]);

  const endLinkDrag = useCallback((e) => {
    const p = chartPoint(e);
    setLinkDrag(prev => {
      if (!prev) return null;
      const rowIdx = Math.floor(p.y / ROW_H);
      const target = visibleTasks[rowIdx];
      if (!target || target.id === prev.sourceTaskId || isSummaryTask(target)) return null;
      const bar = getBar(target);
      if (!bar) return null;
      const w = bar.isMilestone ? 14 : bar.width;
      const l = bar.isMilestone ? bar.left - 7 : bar.left;
      if (p.x < l - 6 || p.x > l + w + 6) return null;

      // Target end: which half of the target bar the pointer is in.
      const targetEnd = (p.x < l + w / 2) ? 'start' : 'finish';
      // Type from (source end → target end).
      const type =
        prev.sourceEnd === 'finish' && targetEnd === 'start' ? 'FS'
        : prev.sourceEnd === 'start' && targetEnd === 'start' ? 'SS'
        : prev.sourceEnd === 'finish' && targetEnd === 'finish' ? 'FF'
        : 'SF';
      setPendingDep({
        predecessorId: prev.sourceTaskId,
        successorId: target.id,
        type,
        lagDays: 0,
        x: p.x,
        y: rowIdx * ROW_H + ROW_H,
      });
      return null;
    });
  }, [chartPoint, visibleTasks, isSummaryTask, getBar]);

  // Escape closes the pending-dependency popover.
  useEffect(() => {
    if (!pendingDep) return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') setPendingDep(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDep]);

  useEffect(() => {
    if (scrolledToday.current || !scrollRef?.current || tasks.length === 0) return;
    if (todayX <= 0) return;
    const scrollTo = Math.max(0, todayX - (scrollRef.current.clientWidth || 800) / 2);
    scrollRef.current.scrollLeft = scrollTo;
    scrolledToday.current = true;
  }, [tasks.length, todayX]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      <div className="flex-shrink-0 h-10 border-b bg-muted/30 flex items-center px-3">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Timeline</span>
      </div>

      {/* Date header */}
      <div className="flex-shrink-0 h-9 border-b bg-muted/30 overflow-hidden" ref={dateHeaderRef}>
        <div className="flex h-full" style={{ minWidth: chartWidth }}>
          {dateHeaders.map((h, i) => (
            <div
              key={i}
              className={cn('flex-shrink-0 border-r border-border/40 flex flex-col items-center justify-center',
                h.isWeekend && 'bg-muted/50', h.isToday && 'bg-primary/10')}
              style={{ width: h.width }}
            >
              <span className={cn('text-[10px] font-semibold truncate px-1', h.isToday ? 'text-primary' : 'text-muted-foreground')}>
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
          if (dateHeaderRef.current) {
            dateHeaderRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }
          onScroll?.(e);
        }}
      >
        <div style={{ minWidth: chartWidth }} className="relative">
          <div className="relative" style={{ height: chartHeight }} ref={chartBodyRef}>

            {zoom === 'day' && dateHeaders.filter(h => h.isWeekend).map((h, i) => (
              <div key={i} className="absolute top-0 bottom-0 bg-muted/30 pointer-events-none"
                style={{ left: differenceInDays(h.date, minDate) * dayWidth, width: dayWidth }} />
            ))}

            {dateHeaders.map((h, i) => (
              <div key={i} className="absolute top-0 bottom-0 border-r border-border/15 pointer-events-none"
                style={{ left: Math.round(differenceInDays(h.date, minDate) * dayWidth) }} />
            ))}

            {todayX >= 0 && todayX <= chartWidth && (
              <div className="absolute top-0 bottom-0 border-r-2 border-primary/70 pointer-events-none z-10" style={{ left: todayX }}>
                <div className="absolute top-0 left-0 -translate-x-1/2 text-[9px] bg-primary text-primary-foreground px-1 rounded-b z-20">Today</div>
              </div>
            )}

            {/* Data date marker — dashed amber, distinct from Today */}
            {dataDateX !== null && dataDateX >= 0 && dataDateX <= chartWidth && (
              <div
                className="absolute top-0 bottom-0 border-r-2 border-dashed border-amber-500 pointer-events-none z-10"
                style={{ left: dataDateX }}
              >
                <div className="absolute top-0 left-0 -translate-x-1/2 text-[9px] bg-amber-500 text-white px-1 rounded-b whitespace-nowrap z-20">
                  Data date
                </div>
              </div>
            )}

            {/* Row backgrounds — keyed to visibleTasks */}
            {visibleTasks.map((t, i) => (
              <div key={t.id}
                className={cn('absolute w-full border-b border-border/10',
                  summaryIds.has(t.id) ? 'bg-muted/20' : i % 2 === 0 ? 'bg-muted/5' : '')}
                style={{ top: i * ROW_H, height: ROW_H }}
                onMouseEnter={() => onHoverTask?.(t.id)}
                onMouseLeave={() => onHoverTask?.(null)} />
            ))}

            {/* Shared hover highlight — mirrors TaskList row hover */}
            {hoveredTaskId && (() => {
              const idx = visibleTasks.findIndex(t => t.id === hoveredTaskId);
              if (idx === -1) return null;
              return (
                <div className="absolute pointer-events-none bg-primary/10"
                  style={{ left: 0, right: 0, top: idx * ROW_H, height: ROW_H, zIndex: 28 }} />
              );
            })()}

            {/* Dependency arrows */}
            <svg className="absolute inset-0 pointer-events-none overflow-visible" width={chartWidth} height={chartHeight} style={{ zIndex: 1 }}>
              <defs>
                {Object.entries(DEP_COLORS).map(([type, color]) => (
                  <marker key={type} id={`arrow-${type}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill={color} />
                  </marker>
                ))}
                <marker id="arrow-critical" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#dc2626" />
                </marker>
              </defs>
              {arrows.map(({ pathD, color, type, bothCritical, key }) => (
                <g key={key} opacity={criticalOnly && !bothCritical ? 0.15 : 1}>
                  <path d={pathD} fill="none" stroke="transparent" strokeWidth="6" />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={bothCritical ? '#dc2626' : color}
                    strokeWidth={bothCritical ? 2 : 1.5}
                    strokeDasharray="5 3"
                    opacity={bothCritical ? 1 : 0.8}
                    markerEnd={bothCritical ? 'url(#arrow-critical)' : `url(#arrow-${type})`}
                  />
                </g>
              ))}
            </svg>

            {/* Temporary dependency-link line while dragging a handle */}
            {linkDrag && (() => {
              const srcTask = visibleTasks.find(t => t.id === linkDrag.sourceTaskId);
              const srcIdx = visibleTasks.findIndex(t => t.id === linkDrag.sourceTaskId);
              const srcBar = srcTask ? getBar(srcTask) : null;
              if (!srcBar) return null;
              const sy = srcIdx * ROW_H + ROW_H / 2;
              const sx = linkDrag.sourceEnd === 'finish'
                ? (srcBar.isMilestone ? srcBar.left + 7 : srcBar.left + srcBar.width)
                : (srcBar.isMilestone ? srcBar.left - 7 : srcBar.left);
              return (
                <svg className="absolute inset-0 pointer-events-none overflow-visible" width={chartWidth} height={chartHeight} style={{ zIndex: 30 }}>
                  <path
                    d={`M ${sx} ${sy} L ${linkDrag.x} ${linkDrag.y}`}
                    fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="4 3"
                  />
                  <circle cx={linkDrag.x} cy={linkDrag.y} r="3" fill="#3b82f6" />
                </svg>
              );
            })()}

            {/* Task bars — indexed against visibleTasks */}
            {visibleTasks.map((task, i) => {
              const bar = getBar(task);
              if (!bar) return null;

              const resolved = scheduledMap?.get(task.id);
              const isCritical = resolved?.isCritical || false;
              const isMilestoneTask = bar.isMilestone;
              const isSummary = summaryIds.has(task.id);
              const percentComplete = isSummary
                ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
                : (task.percent_complete || 0);
              const totalFloat = resolved?.totalFloat ?? null;

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

              // Editing / criticalOnly flags for this task.
              const editThis = canEditTask(task);
              const activeDrag = barDrag?.taskId === task.id ? barDrag : null;
              // criticalOnly dimming: leaf/milestone dim when non-critical; summary dims unless critical.
              const dimNonCritical = criticalOnly && !isCritical;

              if (isMilestoneTask) {
                const cx = bar.left, cy = top + ROW_H / 2, size = 7;
                const ghostDx = activeDrag ? activeDrag.snappedDays * dayWidth : 0;
                const dimmed = dimNonCritical ? 'opacity-25' : '';
                return (
                  <React.Fragment key={task.id}>
                    <svg
                      className={cn('absolute cursor-pointer', dimmed, editThis && 'touch-none', activeDrag && 'opacity-40')}
                      style={{
                        left: cx - size - 2, top: cy - size - 2, overflow: 'visible', zIndex: 2,
                        cursor: editThis ? (activeDrag ? 'grabbing' : 'grab') : 'pointer',
                        userSelect: 'none',
                      }}
                      width={size * 2 + 4} height={size * 2 + 4}
                      onClick={() => { if (dragMovedRef.current) return; onTaskClick?.(task); }}
                      onMouseEnter={() => onHoverTask?.(task.id)}
                      onMouseLeave={() => onHoverTask?.(null)}
                      onPointerDown={editThis ? (e) => beginBarDrag(e, task, 'move') : undefined}
                      onPointerMove={editThis ? moveBarDrag : undefined}
                      onPointerUp={editThis ? endBarDrag : undefined}
                    >
                      <polygon
                        points={`${size + 2},2 ${size * 2 + 2},${size + 2} ${size + 2},${size * 2 + 2} 2,${size + 2}`}
                        fill={isCritical ? '#ef4444' : '#6366f1'} stroke={isCritical ? '#b91c1c' : '#4f46e5'} strokeWidth="1"
                      />
                    </svg>
                    {/* Milestone drag ghost + date chip */}
                    {activeDrag && activeDrag.mode === 'move' && (
                      <>
                        <svg className="absolute pointer-events-none" style={{ left: cx - size - 2 + ghostDx, top: cy - size - 2, overflow: 'visible', zIndex: 40 }}
                          width={size * 2 + 4} height={size * 2 + 4}>
                          <polygon points={`${size + 2},2 ${size * 2 + 2},${size + 2} ${size + 2},${size * 2 + 2} 2,${size + 2}`}
                            fill={isCritical ? '#ef4444' : '#6366f1'} opacity="0.85" stroke="#fff" strokeWidth="1" />
                        </svg>
                        {resolved?.start && (
                          <div className="absolute pointer-events-none text-[9px] bg-popover text-foreground border rounded px-1 shadow z-50 whitespace-nowrap"
                            style={{ left: cx + ghostDx, top: top - 2 }}>
                            {formatLocal(addDays(resolved.start, activeDrag.snappedDays))}
                          </div>
                        )}
                      </>
                    )}
                    {/* Link handles (milestone: start = left point, finish = right point) */}
                    {editThis && !activeDrag && (
                      <>
                        <LinkHandle x={cx - size - 5} y={cy} onPointerDown={(e) => beginLinkDrag(e, task, 'start')}
                          onPointerMove={moveLinkDrag} onPointerUp={endLinkDrag} />
                        <LinkHandle x={cx + size + 5} y={cy} onPointerDown={(e) => beginLinkDrag(e, task, 'finish')}
                          onPointerMove={moveLinkDrag} onPointerUp={endLinkDrag} />
                      </>
                    )}
                  </React.Fragment>
                );
              }

              if (isSummary) {
                const summaryDim = criticalOnly && !isCritical ? 'opacity-25' : '';
                return (
                  <React.Fragment key={task.id}>
                    {baselineBar && (
                      <div className="absolute pointer-events-none opacity-40 border border-muted-foreground/50"
                        style={{ left: baselineBar.left, width: baselineBar.width, top: top + ROW_H - 6, height: 4,
                          background: 'repeating-linear-gradient(90deg,#94a3b8 0px,#94a3b8 4px,transparent 4px,transparent 8px)' }} />
                    )}
                    <div
                      className={cn('absolute flex items-center cursor-pointer', isCritical ? 'bg-red-500' : 'bg-primary', summaryDim)}
                      style={{ left: bar.left, width: bar.width, top: top + 6, height: ROW_H - 12, borderRadius: 2 }}
                      title={`${task.name} (Summary)${isCritical ? ' — CRITICAL' : ''}`}
                      onClick={() => onTaskClick?.(task)}
                      onMouseEnter={() => onHoverTask?.(task.id)}
                      onMouseLeave={() => onHoverTask?.(null)}
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

              const barColor = isCritical ? 'bg-red-500 hover:bg-red-400' : 'bg-accent hover:bg-accent/80';
              const leafDim = dimNonCritical ? 'opacity-25' : '';
              const ghostDx = activeDrag && activeDrag.mode === 'move' ? activeDrag.snappedDays * dayWidth : 0;
              const ghostWidth = activeDrag && activeDrag.mode === 'resize'
                ? Math.max(dayWidth, bar.width + activeDrag.snappedDays * dayWidth)
                : bar.width;
              const ghostDurationDays = Math.max(1, (resolved?.durationDays || task.duration || 1) + (activeDrag?.snappedDays || 0));
              return (
                <React.Fragment key={task.id}>
                  {baselineBar && (
                    <div className="absolute pointer-events-none opacity-50"
                      style={{ left: baselineBar.left, width: baselineBar.width, top: top + ROW_H - 5, height: 3, background: '#94a3b8', borderRadius: 1 }} />
                  )}
                  <div
                    className={cn('absolute rounded transition-all hover:shadow-md cursor-pointer group', barColor, leafDim, activeDrag && 'opacity-40')}
                    style={{
                      left: bar.left, width: bar.width, top: top + 4, height: ROW_H - 8, zIndex: 2,
                      cursor: editThis ? (activeDrag?.mode === 'move' ? 'grabbing' : 'grab') : 'pointer',
                      userSelect: activeDrag ? 'none' : undefined,
                    }}
                    title={`${task.name}\n${task.start_date} → ${task.end_date}\n${task.duration || 0}d | ${percentComplete}%${isCritical ? '\n⚠ CRITICAL PATH' : ''}${totalFloat !== null ? `\nFloat: ${Math.round(totalFloat / 8)}d` : ''}`}
                    onClick={() => { if (dragMovedRef.current) return; onTaskClick?.(task); }}
                    onMouseEnter={() => onHoverTask?.(task.id)}
                    onMouseLeave={() => onHoverTask?.(null)}
                    onPointerDown={editThis ? (e) => beginBarDrag(e, task, 'move') : undefined}
                    onPointerMove={editThis ? moveBarDrag : undefined}
                    onPointerUp={editThis ? endBarDrag : undefined}
                  >
                    {isCritical && <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-700 rounded-l" />}
                    {percentComplete > 0 && (
                      <div className="absolute inset-0 bg-white/30 rounded" style={{ width: `${percentComplete}%` }} />
                    )}
                    {bar.width > 50 && (
                      <span className="absolute left-2 text-[10px] text-white font-medium truncate leading-tight pointer-events-none"
                        style={{ maxWidth: bar.width - 16, top: '50%', transform: 'translateY(-50%)' }}>
                        {task.name}
                      </span>
                    )}
                    <span className="absolute right-1 text-[9px] text-white/80 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                      style={{ top: '50%', transform: 'translateY(-50%)' }}>
                      {percentComplete}%
                    </span>
                    {/* Resize grab zone (right edge) */}
                    {editThis && (
                      <div
                        className="absolute top-0 bottom-0 right-0 bg-white/40 opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ width: 2, cursor: 'ew-resize' }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => beginBarDrag(e, task, 'resize')}
                        onPointerMove={moveBarDrag}
                        onPointerUp={endBarDrag}
                      >
                        <div className="absolute top-0 bottom-0 -right-1" style={{ width: 6 }} />
                      </div>
                    )}
                  </div>

                  {/* Move/resize ghost + floating chip */}
                  {activeDrag?.mode === 'move' && (
                    <>
                      <div className="absolute rounded pointer-events-none border-2 border-white/70"
                        style={{ left: bar.left + ghostDx, width: bar.width, top: top + 4, height: ROW_H - 8, zIndex: 41,
                          background: isCritical ? 'rgba(239,68,68,0.6)' : 'rgba(99,102,241,0.6)' }} />
                      {resolved?.start && (
                        <div className="absolute pointer-events-none text-[9px] bg-popover text-foreground border rounded px-1 shadow z-50 whitespace-nowrap"
                          style={{ left: bar.left + ghostDx, top: top - 2 }}>
                          {formatLocal(addDays(resolved.start, activeDrag.snappedDays))}
                        </div>
                      )}
                    </>
                  )}
                  {activeDrag?.mode === 'resize' && (
                    <>
                      <div className="absolute rounded pointer-events-none border-2 border-white/70"
                        style={{ left: bar.left, width: ghostWidth, top: top + 4, height: ROW_H - 8, zIndex: 41,
                          background: isCritical ? 'rgba(239,68,68,0.6)' : 'rgba(99,102,241,0.6)' }} />
                      <div className="absolute pointer-events-none text-[9px] bg-popover text-foreground border rounded px-1 shadow z-50 whitespace-nowrap"
                        style={{ left: bar.left + ghostWidth + 2, top: top + 4 }}>
                        {ghostDurationDays}d
                      </div>
                    </>
                  )}

                  {/* Link handles (leaf: start left edge, finish right edge) */}
                  {editThis && !activeDrag && (
                    <>
                      <LinkHandle x={bar.left} y={top + ROW_H / 2} onPointerDown={(e) => beginLinkDrag(e, task, 'start')}
                        onPointerMove={moveLinkDrag} onPointerUp={endLinkDrag} />
                      <LinkHandle x={bar.left + bar.width} y={top + ROW_H / 2} onPointerDown={(e) => beginLinkDrag(e, task, 'finish')}
                        onPointerMove={moveLinkDrag} onPointerUp={endLinkDrag} />
                    </>
                  )}
                </React.Fragment>
              );
            })}

            {/* Highlight the hovered target row during a link drag */}
            {linkDrag && linkDrag.targetRowIdx !== null && (
              <div className="absolute pointer-events-none bg-primary/10 border border-primary/40 rounded"
                style={{ left: 0, right: 0, top: linkDrag.targetRowIdx * ROW_H, height: ROW_H, zIndex: 29 }} />
            )}

            {/* Click-away layer for the dependency popover */}
            {pendingDep && (
              <div className="absolute inset-0 z-[55]" onClick={() => setPendingDep(null)} />
            )}

            {/* Dependency confirmation popover */}
            {pendingDep && (
              <DepPopover
                pending={pendingDep}
                onCancel={() => setPendingDep(null)}
                onConfirm={({ type, lagDays }) => {
                  onCreateDependency?.({
                    predecessorId: pendingDep.predecessorId,
                    successorId: pendingDep.successorId,
                    type,
                    lagDays,
                  });
                  setPendingDep(null);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Small circular link-creation handle. Positioned at (x, y) chart-relative coords.
function LinkHandle({ x, y, onPointerDown, onPointerMove, onPointerUp }) {
  return (
    <div
      className="absolute rounded-full border border-primary bg-background hover:bg-primary/30 transition-colors opacity-40 hover:opacity-100"
      style={{
        left: x - 5, top: y - 5, width: 10, height: 10, zIndex: 20,
        cursor: 'crosshair', touchAction: 'none',
      }}
      title="Drag to another task to create a dependency"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

// Confirmation popover shown after dropping a dependency link. Plain absolutely-positioned
// div (NOT Radix — it fights the scroll container).
function DepPopover({ pending, onConfirm, onCancel }) {
  const [type, setType] = useState(pending.type);
  const [lagDays, setLagDays] = useState(0);

  return (
    <div
      className="absolute z-[60] bg-popover text-foreground border rounded-md shadow-lg p-3 w-52 space-y-2"
      style={{ left: Math.max(4, pending.x - 100), top: pending.y + 4 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">New dependency</div>
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground block">Type</label>
        <select
          className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {DEP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground block">Lag (days)</label>
        <input
          type="number"
          className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={lagDays}
          onChange={(e) => setLagDays(e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onConfirm({ type, lagDays })}>Confirm</Button>
      </div>
    </div>
  );
}