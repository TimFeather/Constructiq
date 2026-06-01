import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, Plus, Minus, AlertCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { cascadeTaskDates } from '@/lib/cascadeTaskDates';
import { runScheduleEngine } from '@/lib/schedulingEngine';

const levelColors = [
  'border-l-primary',
  'border-l-accent',
  'border-l-amber-500',
  'border-l-purple-500',
];

const DEP_TYPE_BADGE = {
  FS: 'bg-blue-100 text-blue-700',
  SS: 'bg-emerald-100 text-emerald-700',
  FF: 'bg-amber-100 text-amber-700',
  SF: 'bg-purple-100 text-purple-700',
};

export default function TaskList({ tasks, onTaskClick, onAddTask, collapsed, canEdit = false }) {
  const [expandedIds, setExpandedIds] = useState(new Set(tasks.filter(t => t.level === 0).map(t => t.id)));
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [adjustingId, setAdjustingId] = useState(null);
  const queryClient = useQueryClient();

  // Run the scheduling engine to get live-resolved dates for all tasks
  const scheduledDates = useMemo(() => {
    if (!tasks.length) return new Map();
    const projectStart = tasks.reduce((min, t) => {
      if (!t.start_date) return min;
      return t.start_date < min ? t.start_date : min;
    }, tasks.find(t => t.start_date)?.start_date || new Date().toISOString().split('T')[0]);
    return runScheduleEngine(tasks, projectStart);
  }, [tasks]);

  const getResolvedDates = (task) => {
    const resolved = scheduledDates.get(task.id);
    return {
      start: resolved?.startStr || task.start_date || '—',
      end: resolved?.finishStr || task.end_date || '—',
      duration: resolved?.durationDays || task.duration || 0,
    };
  };

  const adjustDays = async (task, delta) => {
    const newDuration = Math.max(1, (task.duration || 1) + delta);
    const newEnd = task.start_date
      ? format(addDays(new Date(task.start_date), newDuration - 1), 'yyyy-MM-dd')
      : task.end_date;
    setAdjustingId(task.id);
    await base44.entities.Task.update(task.id, { duration: newDuration, end_date: newEnd });
    const mergedTasks = tasks.map(t => t.id === task.id ? { ...t, duration: newDuration, end_date: newEnd } : t);
    await cascadeTaskDates(task.id, mergedTasks, (id, data) => base44.entities.Task.update(id, data));
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setAdjustingId(null);
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
      end_date: task.end_date || '',
      duration: task.duration || '',
    });
  };

  const commitEdit = async (taskId) => {
    const v = editValues;
    let finalData = { ...v };
    if (v.start_date && v.duration) {
      finalData.end_date = format(addDays(new Date(v.start_date), parseInt(v.duration) - 1), 'yyyy-MM-dd');
    } else if (v.start_date && v.end_date) {
      finalData.duration = differenceInCalendarDays(new Date(v.end_date), new Date(v.start_date)) + 1;
    }
    await base44.entities.Task.update(taskId, finalData);
    const mergedTasks = tasks.map(t => t.id === taskId ? { ...t, ...finalData } : t);
    await cascadeTaskDates(taskId, mergedTasks, (id, data) => base44.entities.Task.update(id, data));
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setEditingId(null);
  };

  const handleFieldChange = (field, value) => {
    const updated = { ...editValues, [field]: value };
    if (field === 'start_date' && updated.duration) {
      updated.end_date = format(addDays(new Date(value), parseInt(updated.duration) - 1), 'yyyy-MM-dd');
    } else if (field === 'duration' && updated.start_date) {
      updated.end_date = format(addDays(new Date(updated.start_date), parseInt(value) - 1), 'yyyy-MM-dd');
    } else if (field === 'end_date' && updated.start_date) {
      updated.duration = differenceInCalendarDays(new Date(value), new Date(updated.start_date)) + 1;
    }
    setEditValues(updated);
  };

  const rootTasks = tasks.filter(t => !t.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const getChildren = (parentId) => tasks.filter(t => t.parent_id === parentId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const renderTask = (task, depth = 0) => {
    const children = getChildren(task.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(task.id);
    const isEditing = editingId === task.id;
    const isSummary = task.is_summary || task.level === 0 || task.level === 1;
    const percentComplete = task.percent_complete || 0;
    const resolved = getResolvedDates(task);

    // Show if engine-resolved dates differ from stored (indicating pending cascade)
    const hasPendingUpdate = resolved.start !== (task.start_date || '—') || resolved.end !== (task.end_date || '—');

    // Get predecessor info for display
    const preds = (task.predecessors || []);
    const predTypes = preds
      .filter(p => p.predecessor_id || p.task_id)
      .map(p => ({
        name: tasks.find(t => t.id === (p.predecessor_id || p.task_id))?.wbs || '?',
        type: p.type || 'FS',
        lag: p.lag_hours || p.lag_days * 8 || 0,
      }));

    return (
      <React.Fragment key={task.id}>
        <div
          className={cn(
            "flex items-start gap-1 hover:bg-muted/50 transition-colors border-l-3 group",
            levelColors[task.level || 0] || 'border-l-muted',
            isEditing ? 'bg-primary/5' : 'cursor-pointer',
            hasPendingUpdate && !isEditing && 'bg-amber-50/50 dark:bg-amber-950/20',
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={isEditing ? undefined : () => onTaskClick(task)}
          onDoubleClick={(e) => canEdit && startEdit(task, e)}
        >
          {/* Expand toggle */}
          <div className="w-5 flex-shrink-0 mt-2">
            {hasChildren ? (
              <button
                className="w-5 h-5 flex items-center justify-center hover:bg-muted rounded"
                onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : <div className="w-5" />}
          </div>

          {isEditing ? (
            <div className="flex items-center gap-1 flex-1 py-1">
              <Input
                autoFocus
                value={editValues.name}
                onChange={e => handleFieldChange('name', e.target.value)}
                className="h-7 text-xs flex-1 min-w-0"
                onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(task.id); if (e.key === 'Escape') setEditingId(null); }}
              />
              <Input type="date" value={editValues.start_date}
                onChange={e => handleFieldChange('start_date', e.target.value)}
                className="h-7 text-xs w-32 flex-shrink-0" onClick={e => e.stopPropagation()} />
              <Input type="number" min="1" value={editValues.duration}
                onChange={e => handleFieldChange('duration', e.target.value)}
                className="h-7 text-xs w-14 flex-shrink-0 text-center" onClick={e => e.stopPropagation()} />
              <Input type="date" value={editValues.end_date}
                onChange={e => handleFieldChange('end_date', e.target.value)}
                className="h-7 text-xs w-32 flex-shrink-0" onClick={e => e.stopPropagation()} />
              <button className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded flex-shrink-0"
                onClick={e => { e.stopPropagation(); commitEdit(task.id); }}>✓</button>
              <button className="px-2 py-1 text-xs text-muted-foreground rounded flex-shrink-0"
                onClick={e => { e.stopPropagation(); setEditingId(null); }}>✕</button>
            </div>
          ) : (
            <div className="flex-1 min-w-0 py-1.5 flex items-start justify-between gap-2">
              {/* Left: WBS + Name + Dates + Predecessor badges */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-8 flex-shrink-0">{task.wbs || '—'}</span>
                  <span className={cn(
                    "text-xs truncate",
                    task.level === 0 && "font-bold text-foreground",
                    task.level === 1 && "font-semibold",
                    isSummary && "italic",
                  )}>
                    {task.name}
                    {isSummary && <span className="ml-1 text-[9px] text-muted-foreground font-normal not-italic">(summary)</span>}
                  </span>
                  {hasPendingUpdate && (
                    <AlertCircle className="w-3 h-3 text-amber-500 flex-shrink-0" title="Engine date differs from stored — save to apply" />
                  )}
                </div>

                {/* Engine-resolved dates */}
                <div className="flex items-center gap-1.5 mt-0.5 pl-9">
                  <span className="text-[10px] text-muted-foreground font-mono">{resolved.start}</span>
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <span className="text-[10px] text-muted-foreground font-mono">{resolved.end}</span>
                  <span className="text-[10px] text-muted-foreground/60">({resolved.duration}d)</span>
                </div>

                {/* Predecessor dependency badges */}
                {predTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5 pl-9">
                    {predTypes.map((p, i) => (
                      <span key={i} className={cn("text-[9px] px-1.5 py-0.5 rounded font-mono", DEP_TYPE_BADGE[p.type] || 'bg-muted text-muted-foreground')}>
                        {p.name} {p.type}{p.lag !== 0 ? ` ${p.lag > 0 ? '+' : ''}${p.lag}h` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Duration controls + progress */}
              <div className="flex items-center gap-1.5 flex-shrink-0 pr-2 pt-0.5">
                {canEdit && !isSummary && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="w-5 h-5 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40"
                      onClick={e => { e.stopPropagation(); adjustDays(task, -1); }}
                      disabled={adjustingId === task.id}
                      title="Remove 1 day"
                    >
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <button
                      className="w-5 h-5 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40"
                      onClick={e => { e.stopPropagation(); adjustDays(task, 1); }}
                      disabled={adjustingId === task.id}
                      title="Add 1 day"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1 w-14">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${percentComplete}%` }} />
                  </div>
                  <span className="text-[10px] w-7 flex-shrink-0 text-right">{percentComplete}%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {hasChildren && isExpanded && children.map(child => renderTask(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="border-r bg-card h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task List</span>
        {canEdit && (
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onAddTask}>
            <Plus className="w-3 h-3" /> Add
          </Button>
        )}
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        <div className="w-5" />
        <div className="flex-1">
          <span>WBS / Name / Dates / Dependencies</span>
        </div>
        <span className="w-20 pr-2 text-right">Progress</span>
      </div>

      {/* Task rows */}
      <div className="flex-1 overflow-y-auto">
        {rootTasks.map(task => renderTask(task))}
        {tasks.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No tasks yet</div>
        )}
        {canEdit && tasks.length > 0 && (
          <button
            onClick={onAddTask}
            className="w-full text-left px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-2 border-t border-dashed"
          >
            <Plus className="w-3 h-3" /> Add task
          </button>
        )}
      </div>

      {canEdit && (
        <div className="px-3 py-1.5 border-t bg-muted/20">
          <p className="text-[10px] text-muted-foreground">Double-click any row to edit inline · Click to open edit panel</p>
        </div>
      )}
    </div>
  );
}