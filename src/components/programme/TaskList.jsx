import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Plus, Minus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { flattenTasks } from '@/lib/flattenTasks';
import { indentTask, outdentTask, computeWBS } from '@/lib/wbsUtils';
import TaskContextMenu from './TaskContextMenu';

export const ROW_HEIGHT = 40;

const levelColors = [
  'border-l-primary',
  'border-l-accent',
  'border-l-amber-500',
  'border-l-purple-500',
];

export default function TaskList({ tasks, allTasks, scheduledMap, onTaskClick, onAddTask, collapsed, canEdit = false, scrollRef, onScroll, onPushHistory, projectStart }) {
  const [expandedIds, setExpandedIds] = useState(new Set(tasks.filter(t => t.level === 0).map(t => t.id)));
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [adjustingId, setAdjustingId] = useState(null);
  const [adjustingCompletionId, setAdjustingCompletionId] = useState(null);
  const queryClient = useQueryClient();

  // Use pre-computed scheduledMap from parent — no calculations here
  const getResolvedDates = (task) => {
    const resolved = scheduledMap?.get(task.id);
    return {
      start: resolved?.startStr || task.start_date || '—',
      end: resolved?.finishStr || task.end_date || '—',
      duration: resolved?.durationDays || task.duration || 0,
      isCritical: resolved?.isCritical || false,
      totalFloat: resolved?.totalFloat ?? null,
    };
  };

  // Flatten tasks respecting collapsed state
  const flatTasksArray = useMemo(() => {
    const result = [];
    const wbsCompare = (a, b) => {
      const parse = (w) => (w || '').split('.').map(n => parseInt(n) || 0);
      const aParts = parse(a.wbs), bParts = parse(b.wbs);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const diff = (aParts[i] || 0) - (bParts[i] || 0);
        if (diff !== 0) return diff;
      }
      return (a.sort_order || 0) - (b.sort_order || 0);
    };
    const addTask = (task) => {
      result.push(task);
      if (expandedIds.has(task.id)) {
        const children = tasks.filter(t => t.parent_id === task.id).sort(wbsCompare);
        children.forEach(addTask);
      }
    };
    tasks.filter(t => !t.parent_id).sort(wbsCompare).forEach(addTask);
    return result;
  }, [tasks, expandedIds]);

  const adjustCompletion = async (task, delta) => {
    if (adjustingCompletionId === task.id) return;
    const newPct = Math.min(100, Math.max(0, (task.percent_complete || 0) + delta));
    setAdjustingCompletionId(task.id);
    onPushHistory?.(
      [{ id: task.id, data: { percent_complete: task.percent_complete || 0 } }],
      [{ id: task.id, data: { percent_complete: newPct } }],
    );
    await base44.entities.Task.update(task.id, { percent_complete: newPct });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setAdjustingCompletionId(null);
  };

  const adjustDays = async (task, delta) => {
    if (adjustingId === task.id) return;
    setAdjustingId(task.id);
    try {
      const newDuration = Math.max(1, (task.duration || 1) + delta);
      onPushHistory?.(
        [{ id: task.id, data: { duration: task.duration } }],
        [{ id: task.id, data: { duration: newDuration } }],
      );
      await base44.entities.Task.update(task.id, { duration: newDuration });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } finally {
      setAdjustingId(null);
    }
  };

  // Context menu actions
  const handleContextAction = async (action, task) => {
    if (action === 'insert-above' || action === 'insert-below') {
      onAddTask?.();
      return;
    }
    if (action === 'delete') {
      await base44.entities.Task.delete(task.id);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      return;
    }
    if (action === 'convert-milestone') {
      await base44.entities.Task.update(task.id, { duration: 0, is_milestone: true });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      return;
    }
    if (action === 'indent') {
      const patches = indentTask(task.id, tasks);
      if (!patches.length) return;
      await Promise.all(patches.map(p => {
        const { id, ...data } = p;
        return base44.entities.Task.update(id, data);
      }));
      // Recompute WBS for all tasks
      const updatedTasks = tasks.map(t => {
        const patch = patches.find(p => p.id === t.id);
        return patch ? { ...t, ...patch } : t;
      });
      const wbsPatches = computeWBS(updatedTasks);
      await Promise.all(wbsPatches.map(p => base44.entities.Task.update(p.id, { wbs: p.wbs })));
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      return;
    }
    if (action === 'outdent') {
      const patches = outdentTask(task.id, tasks);
      if (!patches.length) return;
      await Promise.all(patches.map(p => {
        const { id, ...data } = p;
        return base44.entities.Task.update(id, data);
      }));
      const updatedTasks = tasks.map(t => {
        const patch = patches.find(p => p.id === t.id);
        return patch ? { ...t, ...patch } : t;
      });
      const wbsPatches = computeWBS(updatedTasks);
      await Promise.all(wbsPatches.map(p => base44.entities.Task.update(p.id, { wbs: p.wbs })));
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      return;
    }
  };

  if (collapsed) return null;

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startEdit = (task, e) => {
    if (!canEdit) return;
    e.stopPropagation();
    setEditingId(task.id);
    setEditValues({
      name: task.name || '',
      start_date: task.start_date || '',
      duration: task.duration || 1,
    });
  };

  const commitEdit = async (taskId) => {
    const v = editValues;
    const finalData = {
      name: v.name,
      start_date: v.start_date,
      duration: Math.max(1, parseInt(v.duration) || 1),
    };
    const originalTask = tasks.find(t => t.id === taskId);
    if (originalTask && onPushHistory) {
      const { name, start_date, duration } = originalTask;
      onPushHistory(
        [{ id: taskId, data: { name, start_date, duration } }],
        [{ id: taskId, data: finalData }],
      );
    }
    await base44.entities.Task.update(taskId, finalData);
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setEditingId(null);
  };

  const renderTask = (task, depth = 0) => {
    const children = tasks.filter(t => t.parent_id === task.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const hasChildren = children.length > 0;
    // Summary detection: based on having children only (per spec)
    const isSummary = hasChildren;
    const isExpanded = expandedIds.has(task.id);
    const isEditing = editingId === task.id;
    const isMilestone = task.is_milestone || task.duration === 0;
    const resolved = getResolvedDates(task);
    const isCritical = resolved.isCritical;
    const percentComplete = isSummary
      ? (scheduledMap?.get(task.id)?.rolledProgress ?? task.percent_complete ?? 0)
      : (task.percent_complete || 0);
    const hasPendingUpdate = resolved.start !== (task.start_date || '—') || resolved.end !== (task.end_date || '—');

    const rowContent = (
      <div
        className={cn(
          "grid items-center w-full h-full hover:bg-muted/50 transition-colors border-l-3 group px-2",
          isCritical ? 'border-l-red-500' : (levelColors[task.level || 0] || 'border-l-muted'),
          isEditing ? 'bg-primary/5' : 'cursor-pointer',
          isCritical && !isEditing && 'bg-red-50/30 dark:bg-red-950/10',
          hasPendingUpdate && !isEditing && !isCritical && 'bg-amber-50/50 dark:bg-amber-950/20',
        )}
        style={{ gridTemplateColumns: `56px auto 24px 1fr 70px 70px 56px 80px`, paddingLeft: `${8 + depth * 16}px` }}
        onClick={isEditing ? undefined : () => onTaskClick(task)}
        onDoubleClick={(e) => canEdit && startEdit(task, e)}
      >
        <span className="text-[10px] font-mono text-muted-foreground text-center flex items-center justify-center">{task.wbs || '—'}</span>

        <div className="w-5 flex-shrink-0 flex items-center justify-center">
          {hasChildren ? (
            <button className="w-5 h-5 flex items-center justify-center hover:bg-muted rounded"
              onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}>
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : <div className="w-5" />}
        </div>

        <div className="w-5" />

        {isEditing ? (
          <>
            <Input autoFocus value={editValues.name}
              onChange={e => setEditValues(p => ({ ...p, name: e.target.value }))}
              className="h-7 text-xs min-w-0" onClick={e => e.stopPropagation()}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(task.id); if (e.key === 'Escape') setEditingId(null); }} />
            <Input type="number" min="1" value={editValues.duration}
              onChange={e => setEditValues(p => ({ ...p, duration: e.target.value }))}
              className="h-7 text-xs text-center" onClick={e => e.stopPropagation()} />
            <Input type="date" value={editValues.start_date}
              onChange={e => setEditValues(p => ({ ...p, start_date: e.target.value }))}
              className="h-7 text-xs" onClick={e => e.stopPropagation()} />
            <div />
            <div className="flex items-center justify-center gap-1">
              <button className="px-1.5 py-1 text-xs bg-primary text-primary-foreground rounded"
                onClick={e => { e.stopPropagation(); commitEdit(task.id); }}>✓</button>
              <button className="px-1.5 py-1 text-xs text-muted-foreground rounded"
                onClick={e => { e.stopPropagation(); setEditingId(null); }}>✕</button>
            </div>
          </>
        ) : (
          <>
            <span className={cn("text-xs truncate px-1", isSummary && "font-semibold", isMilestone && "text-indigo-600 dark:text-indigo-400")}>
              {task.name}
            </span>

            <div className="flex items-center justify-center gap-0.5 h-full">
              {canEdit && !isSummary ? (
                <>
                  <button className="w-4 h-4 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); adjustDays(task, -1); }} disabled={adjustingId === task.id} title="Remove 1 day">
                    <Minus className="w-2 h-2" />
                  </button>
                  <span className="text-[10px] font-mono w-6 text-center">{resolved.duration}</span>
                  <button className="w-4 h-4 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); adjustDays(task, 1); }} disabled={adjustingId === task.id} title="Add 1 day">
                    <Plus className="w-2 h-2" />
                  </button>
                </>
              ) : (
                <span className="text-[10px] font-mono text-center w-full">{resolved.duration}d</span>
              )}
            </div>

            <span className="text-[10px] font-mono text-muted-foreground text-center flex items-center justify-center h-full">
              {resolved.start !== '—' ? format(new Date(resolved.start), 'dd/MM/yy') : '—'}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground text-center flex items-center justify-center h-full">
              {resolved.end !== '—' ? format(new Date(resolved.end), 'dd/MM/yy') : '—'}
            </span>

            <div className="flex items-center justify-center gap-0.5 h-full px-1">
              {canEdit && !isSummary ? (
                <>
                  <button className="w-4 h-4 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); adjustCompletion(task, -5); }} disabled={adjustingCompletionId === task.id} title="Remove 5%">
                    <Minus className="w-2 h-2" />
                  </button>
                  <span className="text-[10px] font-mono w-7 text-center">{percentComplete}%</span>
                  <button className="w-4 h-4 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={e => { e.stopPropagation(); adjustCompletion(task, 5); }} disabled={adjustingCompletionId === task.id} title="Add 5%">
                    <Plus className="w-2 h-2" />
                  </button>
                </>
              ) : (
                <>
                  <div className="w-8 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${percentComplete}%` }} />
                  </div>
                  <span className="text-[10px] text-right flex-shrink-0">{percentComplete}%</span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );

    return (
      <React.Fragment key={task.id}>
        {canEdit ? (
          <TaskContextMenu task={task} onAction={handleContextAction}>
            {rowContent}
          </TaskContextMenu>
        ) : rowContent}
        {hasChildren && isExpanded && children.map(child => renderTask(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="border-r bg-card h-full flex flex-col">
      <div className="flex items-center justify-between px-3 border-b bg-muted/30 h-10">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task List</span>
        {canEdit && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onAddTask}>
            <Plus className="w-3 h-3" /> Add
          </Button>
        )}
      </div>

      <div className="grid items-center border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/30 px-2 h-10 gap-0" style={{ gridTemplateColumns: '56px auto 24px 1fr 70px 70px 56px 80px' }}>
        <span className="text-center">WBS</span>
        <div className="w-5" />
        <div className="w-5" />
        <span className="truncate px-1">Name</span>
        <span className="text-center">Duration</span>
        <span className="text-center">Start</span>
        <span className="text-center">End</span>
        <span className="text-center">% Done</span>
      </div>

      <div className="flex-1 overflow-y-auto" ref={scrollRef} onScroll={onScroll}>
        {flatTasksArray.map(task => (
          <div key={task.id} style={{ height: ROW_HEIGHT }} className="w-full">
            {renderTask(task, (task.level || 0))}
          </div>
        ))}
        {tasks.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No tasks yet</div>
        )}
        {canEdit && tasks.length > 0 && (
          <button onClick={onAddTask}
            className="w-full text-left px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-2 border-t border-dashed">
            <Plus className="w-3 h-3" /> Add task
          </button>
        )}
      </div>

      {canEdit && (
        <div className="px-3 py-1.5 border-t bg-muted/20">
          <p className="text-[10px] text-muted-foreground">Double-click to edit inline · Click to open panel · Right-click for more</p>
        </div>
      )}
    </div>
  );
}