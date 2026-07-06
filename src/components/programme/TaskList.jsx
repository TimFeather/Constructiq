import React, { useState, useMemo, useEffect } from 'react';
import { ChevronRight, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { calculateVariance } from '@/lib/scheduling/baselineEngine';
import { predecessorLabel, wbsLabelMap } from '@/lib/scheduleExport';
import { parsePredecessorInput } from '@/lib/programme/predecessorParse';
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

// Cell-cursor navigation order (Excel-style grid). "start"/"end" here refer
// to the Pln Start / Pln End columns — only Pln Start is editable.
const EDIT_COLS = ['name', 'duration', 'start', 'preds', 'pct'];

function canEditCol(colKey, task, isSummary) {
  if (colKey === 'name') return true;
  if (isSummary) return false;
  if (colKey === 'duration') return !(task.is_milestone || task.duration === 0);
  return true; // start, preds, pct — leaf + milestone
}

function initialEditValue(colKey, task, ctx) {
  switch (colKey) {
    case 'name': return task.name || '';
    case 'duration': return String(ctx.duration);
    case 'start': return ctx.plannedStart || '';
    case 'preds': return ctx.depsLabel || '';
    case 'pct': return String(ctx.percentComplete);
    default: return '';
  }
}

/**
 * TaskList — the Programme task table.
 * expandedIds and onToggleExpand are controlled by parent (Programme page)
 * so GanttChart stays perfectly aligned.
 *
 * When `editable`, the table behaves like a spreadsheet grid: a keyboard
 * cursor (Arrow/Tab/Enter) moves across Name / Days / Pln Start /
 * Predecessors / % , clicking a cell only moves the cursor, and
 * Enter/F2/double-click/typing a character starts editing.
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
  hoveredTaskId = null,  // shared row-hover highlight (synced with GanttChart)
  onHoverTask,           // (taskId | null) => void
  onNameCommit,          // (taskId, newName) => void — Name column edit
  onDurationCommit,      // (taskId, newDuration) => void — Days column edit
  onStartCommit,         // (taskId, newStartDateStr) => void — Pln Start column edit
  onPredecessorsCommit,  // (taskId, preds) => void — Predecessors column edit
  onProgressCommit,      // (taskId, newPercent) => void — % column edit
  onCreateTask,          // (name) => void — commit from the "Add task…" ghost row
  editable = false,      // whether the grid is editable
  totalWorkingDays = null, // overall project span in working days (title bar)
}) {
  const COLS = baselineMap
    ? '44px 20px 1fr 48px 44px 64px 64px 90px 72px'
    : '44px 20px 1fr 48px 44px 64px 64px 90px';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ─── Grid cursor state (local — does not need to survive tab switches) ───
  // cursor is either a real row: { rowIdx: number, colKey, isGhost: false }
  // or the trailing "Add task…" row: { rowIdx: null, colKey: 'name', isGhost: true }
  const [cursor, setCursor] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  // Tasks that have children (summary rows) — shaded for readability.
  const summaryIds = useMemo(
    () => new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id)),
    [tasks],
  );

  // WBS labels for dependency references (falls back to outline row number
  // for any task missing a WBS value).
  const wbsMap = useMemo(() => wbsLabelMap(tasks), [tasks]);
  // Inverse map for parsing typed predecessor input back to task ids.
  const wbsToId = useMemo(() => new Map([...wbsMap].map(([id, wbs]) => [wbs, id])), [wbsMap]);

  function getRowCtx(task) {
    const isSummary = summaryIds.has(task.id);
    const resolved = scheduledMap?.get(task.id);
    const isCritical = resolved?.isCritical || false;
    const plannedStart = resolved?.startStr || task.start_date;
    const plannedEnd = resolved?.finishStr || task.end_date;
    const percentComplete = isSummary
      ? (resolved?.rolledProgress ?? task.percent_complete ?? 0)
      : (task.percent_complete || 0);
    const duration = resolved?.durationDays ?? task.duration ?? 1;
    const depsLabel = predecessorLabel(task.predecessors, wbsMap);
    return { isSummary, resolved, isCritical, plannedStart, plannedEnd, percentComplete, duration, depsLabel };
  }

  // Clamp the cursor row when visibleTasks shrinks (collapse) — losing the
  // precise task under the cursor after collapse is acceptable. Ghost-row
  // cursor is independent of visibleTasks.length, so it's left alone.
  useEffect(() => {
    if (!cursor || cursor.isGhost) return;
    if (cursor.rowIdx >= visibleTasks.length) {
      if (visibleTasks.length) {
        setCursor({ rowIdx: visibleTasks.length - 1, colKey: cursor.colKey, isGhost: false });
      } else if (editable) {
        setCursor({ rowIdx: null, colKey: 'name', isGhost: true });
      } else {
        setCursor(null);
      }
      setEditing(false);
    }
  }, [visibleTasks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the cursor cell scrolled into view.
  useEffect(() => {
    if (!cursor || !scrollRef?.current) return;
    const key = cursor.isGhost ? 'ghost' : cursor.rowIdx;
    const el = scrollRef.current.querySelector(`[data-row-idx="${key}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor, scrollRef]);

  function startEdit(rowIdx, colKey, initial, isGhost = false) {
    setCursor({ rowIdx, colKey, isGhost });
    setEditValue(initial);
    setEditing(true);
  }

  function commitCell(colKey, task, rawValue, ctx) {
    switch (colKey) {
      case 'name': {
        const name = rawValue.trim();
        if (name && name !== task.name) onNameCommit?.(task.id, name);
        break;
      }
      case 'duration': {
        const n = parseInt(rawValue, 10);
        if (Number.isFinite(n) && n >= 1 && n !== ctx.duration) onDurationCommit?.(task.id, n);
        break;
      }
      case 'start': {
        if (rawValue && rawValue !== ctx.plannedStart) onStartCommit?.(task.id, rawValue);
        break;
      }
      case 'preds': {
        const { preds, errors } = parsePredecessorInput(rawValue, wbsToId);
        if (errors.length) {
          toast({ title: 'Predecessor not updated', description: errors.join('; '), variant: 'destructive' });
          break;
        }
        onPredecessorsCommit?.(task.id, preds);
        break;
      }
      case 'pct': {
        const n = parseInt(rawValue, 10);
        if (Number.isFinite(n)) {
          const clamped = Math.max(0, Math.min(100, n));
          if (clamped !== ctx.percentComplete) onProgressCommit?.(task.id, clamped);
        }
        break;
      }
      default:
        break;
    }
  }

  function commitAndMove(direction) {
    if (!cursor) return;
    if (cursor.isGhost) {
      const name = editValue.trim();
      setEditing(false);
      if (name) onCreateTask?.(name);
      // Cursor stays on the ghost row either way, so Enter-name-Enter-name
      // chains keep working.
      return;
    }
    const { rowIdx, colKey } = cursor;
    const task = visibleTasks[rowIdx];
    if (task) commitCell(colKey, task, editValue, getRowCtx(task));
    setEditing(false);
    if (direction === 'down') {
      if (rowIdx + 1 >= visibleTasks.length) {
        setCursor(editable ? { rowIdx: null, colKey: 'name', isGhost: true } : { rowIdx, colKey, isGhost: false });
      } else {
        setCursor({ rowIdx: rowIdx + 1, colKey, isGhost: false });
      }
    } else if (direction === 'right') {
      const colIdx = EDIT_COLS.indexOf(colKey);
      setCursor({ rowIdx, colKey: EDIT_COLS[Math.min(EDIT_COLS.length - 1, colIdx + 1)], isGhost: false });
    }
  }

  function cancelEdit() {
    setEditing(false);
  }

  function handleCellClick(e, rowIdx, colKey) {
    if (!editable) return;
    e.stopPropagation();
    setCursor({ rowIdx, colKey, isGhost: false });
    setEditing(false);
  }

  function handleCellDoubleClick(e, rowIdx, colKey, task, isSummary, ctx) {
    if (!editable || !canEditCol(colKey, task, isSummary)) return;
    e.stopPropagation();
    startEdit(rowIdx, colKey, initialEditValue(colKey, task, ctx));
  }

  function handleGhostClick(e) {
    if (!editable) return;
    e.stopPropagation();
    setCursor({ rowIdx: null, colKey: 'name', isGhost: true });
    setEditing(false);
  }

  function handleGhostDoubleClick(e) {
    if (!editable) return;
    e.stopPropagation();
    startEdit(null, 'name', '', true);
  }

  function handleContainerKeyDown(e) {
    if (!editable || editing) return;

    if (!cursor) {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
        e.preventDefault();
        if (visibleTasks.length) setCursor({ rowIdx: 0, colKey: EDIT_COLS[0], isGhost: false });
        else setCursor({ rowIdx: null, colKey: 'name', isGhost: true });
      }
      return;
    }

    if (cursor.isGhost) {
      if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        if (visibleTasks.length) setCursor({ rowIdx: visibleTasks.length - 1, colKey: 'name', isGhost: false });
      } else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        startEdit(null, 'name', '', true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setCursor(null);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        startEdit(null, 'name', e.key, true);
      }
      return;
    }

    const { rowIdx, colKey } = cursor;
    const colIdx = EDIT_COLS.indexOf(colKey);

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor({ rowIdx: Math.max(0, rowIdx - 1), colKey, isGhost: false });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rowIdx + 1 >= visibleTasks.length) setCursor({ rowIdx: null, colKey: 'name', isGhost: true });
      else setCursor({ rowIdx: rowIdx + 1, colKey, isGhost: false });
    } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setCursor({ rowIdx, colKey: EDIT_COLS[Math.max(0, colIdx - 1)], isGhost: false });
    } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setCursor({ rowIdx, colKey: EDIT_COLS[Math.min(EDIT_COLS.length - 1, colIdx + 1)], isGhost: false });
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      const task = visibleTasks[rowIdx];
      if (!task) return;
      const ctx = getRowCtx(task);
      if (canEditCol(colKey, task, ctx.isSummary)) startEdit(rowIdx, colKey, initialEditValue(colKey, task, ctx));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setCursor(null);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const task = visibleTasks[rowIdx];
      if (!task) return;
      const ctx = getRowCtx(task);
      if (canEditCol(colKey, task, ctx.isSummary)) {
        e.preventDefault();
        startEdit(rowIdx, colKey, e.key);
      }
    }
  }

  const editorKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commitAndMove('down');
    else if (e.key === 'Tab') { e.preventDefault(); commitAndMove('right'); }
    else if (e.key === 'Escape') cancelEdit();
  };

  const isCursor = (rowIdx, colKey) => editable && !cursor?.isGhost && cursor?.rowIdx === rowIdx && cursor?.colKey === colKey;
  const isEditingCell = (rowIdx, colKey) => editing && isCursor(rowIdx, colKey);
  const isGhostCursor = editable && cursor?.isGhost === true;
  const isGhostEditing = editing && isGhostCursor;

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

  return (
    <div className="border-r bg-card h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center px-3 border-b bg-muted/30 h-10 flex-shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task List</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {tasks.length} tasks{totalWorkingDays != null ? ` · ${totalWorkingDays} working days` : ''}
        </span>
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
        <span className="text-center">Days</span>
        <span className="text-center">Pln Start</span>
        <span className="text-center">Pln End</span>
        <span className="text-center">Predecessors</span>
        {baselineMap && <span className="text-center">Baseline</span>}
      </div>

      {/* Rows — flat list from pre-computed visibleTasks */}
      <div
        className="flex-1 overflow-y-auto outline-none"
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={editable ? 0 : undefined}
        onKeyDown={editable ? handleContainerKeyDown : undefined}
      >
        {visibleTasks.map((task, rowIdx) => {
          const hasChildren = summaryIds.has(task.id);
          const isSummary = hasChildren;
          const isExpanded = expandedIds.has(task.id);
          const isMilestone = task.is_milestone || task.duration === 0;
          const ctx = getRowCtx(task);
          const { isCritical, plannedStart, plannedEnd, percentComplete, duration, depsLabel } = ctx;
          const depth = task.level || 0;

          const baselineRecord = baselineMap?.get(task.id);
          const baselineVariance = baselineRecord ? calculateVariance(baselineRecord, ctx.resolved) : null;
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
              data-row-idx={rowIdx}
              style={{
                height: ROW_HEIGHT,
                paddingLeft: `${8 + depth * 16}px`,
                gridTemplateColumns: COLS,
              }}
              className={cn(
                'relative group grid items-center w-full border-b border-border/20 hover:bg-muted/40 transition-colors cursor-pointer px-2 border-l-2',
                isCritical ? 'border-l-red-500 bg-red-50/30 dark:bg-red-950/10' : (levelColors[depth] || 'border-l-muted'),
                isSummary && !isCritical && 'bg-muted/50',
                hoveredTaskId === task.id && 'bg-muted/60',
              )}
              onClick={() => { if (!editable) onTaskClick?.(task); }}
              onMouseEnter={() => onHoverTask?.(task.id)}
              onMouseLeave={() => onHoverTask?.(null)}
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

              {/* Name */}
              <div
                className="px-1 min-w-0"
                onClick={e => handleCellClick(e, rowIdx, 'name')}
                onDoubleClick={e => handleCellDoubleClick(e, rowIdx, 'name', task, isSummary, ctx)}
              >
                {isEditingCell(rowIdx, 'name') ? (
                  <input
                    type="text"
                    autoFocus
                    value={editValue}
                    className="w-full text-xs bg-background border border-primary rounded px-1"
                    onChange={e => setEditValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => commitAndMove(null)}
                    onKeyDown={editorKeyDown}
                  />
                ) : (
                  <span className={cn(
                    'text-xs truncate block',
                    isSummary && 'font-semibold',
                    isMilestone && 'text-indigo-600 dark:text-indigo-400',
                    isCritical && 'text-red-700 dark:text-red-400',
                    isCursor(rowIdx, 'name') && 'ring-1 ring-primary ring-inset rounded',
                  )}>
                    {task.name}
                  </span>
                )}
              </div>

              {/* % */}
              <div
                className="flex items-center gap-0.5 px-1"
                onClick={e => handleCellClick(e, rowIdx, 'pct')}
                onDoubleClick={e => handleCellDoubleClick(e, rowIdx, 'pct', task, isSummary, ctx)}
              >
                {isEditingCell(rowIdx, 'pct') ? (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    autoFocus
                    value={editValue}
                    className="w-full text-center text-[10px] font-mono bg-background border border-primary rounded px-0.5"
                    onChange={e => setEditValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => commitAndMove(null)}
                    onKeyDown={editorKeyDown}
                  />
                ) : (
                  <div className={cn('flex items-center gap-0.5 w-full', isCursor(rowIdx, 'pct') && 'ring-1 ring-primary ring-inset rounded')}>
                    <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${percentComplete}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground w-5 text-right">{percentComplete}%</span>
                  </div>
                )}
              </div>

              {/* Days */}
              <div
                onClick={e => handleCellClick(e, rowIdx, 'duration')}
                onDoubleClick={e => handleCellDoubleClick(e, rowIdx, 'duration', task, isSummary, ctx)}
              >
                {isMilestone ? (
                  <span className="text-center text-muted-foreground font-mono text-[10px] block">—</span>
                ) : isEditingCell(rowIdx, 'duration') ? (
                  <input
                    type="number"
                    min={1}
                    autoFocus
                    value={editValue}
                    className="w-full text-center text-[10px] font-mono bg-background border border-primary rounded px-0.5"
                    onChange={e => setEditValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => commitAndMove(null)}
                    onKeyDown={editorKeyDown}
                  />
                ) : (
                  <span className={cn(
                    'text-center font-mono text-[10px] block',
                    isCursor(rowIdx, 'duration') && 'ring-1 ring-primary ring-inset rounded',
                  )}>
                    {duration}d
                  </span>
                )}
              </div>

              {/* Pln Start */}
              <div
                onClick={e => handleCellClick(e, rowIdx, 'start')}
                onDoubleClick={e => handleCellDoubleClick(e, rowIdx, 'start', task, isSummary, ctx)}
              >
                {isEditingCell(rowIdx, 'start') ? (
                  <input
                    type="date"
                    autoFocus
                    value={editValue}
                    className="w-full text-center text-[10px] font-mono bg-background border border-primary rounded px-0.5"
                    onChange={e => setEditValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => commitAndMove(null)}
                    onKeyDown={editorKeyDown}
                  />
                ) : (
                  <span className={cn(
                    'text-[10px] font-mono text-muted-foreground text-center block',
                    isCursor(rowIdx, 'start') && 'ring-1 ring-primary ring-inset rounded',
                  )}>
                    {plannedStart ? format(new Date(plannedStart), 'dd/MM/yy') : '—'}
                  </span>
                )}
              </div>

              {/* Pln End — not part of the editable grid */}
              <span className="text-[10px] font-mono text-muted-foreground text-center">
                {plannedEnd ? format(new Date(plannedEnd), 'dd/MM/yy') : '—'}
              </span>

              {/* Predecessors */}
              <div
                onClick={e => handleCellClick(e, rowIdx, 'preds')}
                onDoubleClick={e => handleCellDoubleClick(e, rowIdx, 'preds', task, isSummary, ctx)}
              >
                {isEditingCell(rowIdx, 'preds') ? (
                  <input
                    type="text"
                    autoFocus
                    value={editValue}
                    placeholder="e.g. 1.2FS+2d"
                    className="w-full text-center text-[10px] font-mono bg-background border border-primary rounded px-0.5"
                    onChange={e => setEditValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => commitAndMove(null)}
                    onKeyDown={editorKeyDown}
                  />
                ) : (
                  <span
                    className={cn(
                      'text-[10px] font-mono text-muted-foreground text-center truncate px-1 block',
                      isCursor(rowIdx, 'preds') && 'ring-1 ring-primary ring-inset rounded',
                    )}
                    title={depsLabel || undefined}
                  >
                    {depsLabel || '—'}
                  </span>
                )}
              </div>

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
        {/* "Add task…" ghost row — last stop in the cursor grid. Not part of
            visibleTasks, so it can't desync TaskList/GanttChart row order. */}
        {editable && (
          <div
            data-row-idx="ghost"
            style={{ height: ROW_HEIGHT, gridTemplateColumns: COLS }}
            className="grid items-center w-full border-b border-border/20 hover:bg-muted/40 transition-colors cursor-pointer px-2 border-l-2 border-l-transparent"
          >
            <span />
            <div />
            <div
              className="px-1 min-w-0"
              onClick={handleGhostClick}
              onDoubleClick={handleGhostDoubleClick}
            >
              {isGhostEditing ? (
                <input
                  type="text"
                  autoFocus
                  value={editValue}
                  placeholder="Add task…"
                  className="w-full text-xs bg-background border border-primary rounded px-1"
                  onChange={e => setEditValue(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onBlur={() => commitAndMove(null)}
                  onKeyDown={editorKeyDown}
                />
              ) : (
                <span className={cn(
                  'text-xs italic text-muted-foreground truncate block',
                  isGhostCursor && 'ring-1 ring-primary ring-inset rounded',
                )}>
                  Add task…
                </span>
              )}
            </div>
            <span /><span /><span /><span /><span />
            {baselineMap && <span />}
          </div>
        )}
        {/* Bottom spacer — matches GanttChart's chartHeight overshoot so scroll sync
            stays row-accurate when either pane is scrolled to its very bottom.
            Shrunk by one row's height when the ghost row is showing. */}
        {(visibleTasks.length > 0 || editable) && (
          <div style={{ height: editable ? 18 : 50 }} aria-hidden="true" />
        )}
        {tasks.length === 0 && !editable && (
          <div className="text-center py-12 text-sm text-muted-foreground">Import a schedule to get started</div>
        )}
      </div>
    </div>
  );
}
