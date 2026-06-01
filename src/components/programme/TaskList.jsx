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
import { flattenTasks } from '@/lib/flattenTasks';

export const ROW_HEIGHT = 40;

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

  // Use the same flattening logic as GanttChart for alignment
  const flatTasksArray = useMemo(() => flattenTasks(tasks), [tasks]);

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

  const renderTask = (task, depth = 0) => {
    const children = tasks.filter(t => t.parent_id === task.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
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
            "grid items-center w-full h-full hover:bg-muted/50 transition-colors border-l-3 group px-2",
            levelColors[task.level || 0] || 'border-l-muted',
            isEditing ? 'bg-primary/5' : 'cursor-pointer',
            hasPendingUpdate && !isEditing && 'bg-amber-50/50 dark:bg-amber-950/20',
          )}
          style={{ gridTemplateColumns: `auto 24px 1fr 56px 70px 70px 56px 80px`, paddingLeft: `${8 + depth * 16}px` }}
          onClick={isEditing ? undefined : () => onTaskClick(task)}
          onDoubleClick={(e) => canEdit && startEdit(task, e)}
        >
          {/* Expand toggle */}
          <div className="w-5 flex-shrink-0 flex items-center justify-center">
            {hasChildren ? (
              <button
                className="w-5 h-5 flex items-center justify-center hover:bg-muted rounded"
                onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
              >
                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            ) : <div className="w-5" />}
          </div>
          
          {/* Spacer for duration control column in non-edit mode */}
          <div className="w-5" />

          {isEditing ? (
            <>
              <div />
              <Input
                autoFocus
                value={editValues.name}
                onChange={e => handleFieldChange('name', e.target.value)}
                className="h-7 text-xs min-w-0"
                onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(task.id); if (e.key === 'Escape') setEditingId(null); }}
              />
              <Input type="text" value={task.wbs || ''}
                disabled
                className="h-7 text-xs text-center text-[10px] bg-muted/30"
                onClick={e => e.stopPropagation()} />
              <Input type="number" min="1" value={editValues.duration}
                onChange={e => handleFieldChange('duration', e.target.value)}
                className="h-7 text-xs text-center" onClick={e => e.stopPropagation()} />
              <Input type="date" value={editValues.start_date}
                onChange={e => handleFieldChange('start_date', e.target.value)}
                className="h-7 text-xs" onClick={e => e.stopPropagation()} />
              <Input type="date" value={editValues.end_date}
                onChange={e => handleFieldChange('end_date', e.target.value)}
                className="h-7 text-xs" onClick={e => e.stopPropagation()} />
              <div className="flex items-center justify-center gap-1">
                <button className="px-1.5 py-1 text-xs bg-primary text-primary-foreground rounded"
                  onClick={e => { e.stopPropagation(); commitEdit(task.id); }}>✓</button>
                <button className="px-1.5 py-1 text-xs text-muted-foreground rounded"
                  onClick={e => { e.stopPropagation(); setEditingId(null); }}>✕</button>
              </div>
            </>
          ) : (
            <>
              {/* Name column */}
              <span className={cn(
                "text-xs truncate px-1",
                task.level === 0 && "font-bold text-foreground",
                task.level === 1 && "font-semibold",
                isSummary && "italic",
              )}>
                {task.name}
              </span>
              
              {/* WBS column */}
              <span className="text-[10px] font-mono text-muted-foreground text-center flex items-center justify-center">{task.wbs || '—'}</span>
              
              {/* Duration column */}
              <div className="flex items-center justify-center gap-0.5 h-full">
                {canEdit && !isSummary && (
                  <>
                    <button
                      className="w-4 h-4 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={e => { e.stopPropagation(); adjustDays(task, -1); }}
                      disabled={adjustingId === task.id}
                      title="Remove 1 day"
                    >
                      <Minus className="w-2 h-2" />
                    </button>
                    <span className="text-[10px] font-mono w-6 text-center">{resolved.duration}</span>
                    <button
                      className="w-4 h-4 flex items-center justify-center rounded border border-border hover:bg-muted text-muted-foreground disabled:opacity-40 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={e => { e.stopPropagation(); adjustDays(task, 1); }}
                      disabled={adjustingId === task.id}
                      title="Add 1 day"
                    >
                      <Plus className="w-2 h-2" />
                    </button>
                  </>
                )}
                {(!canEdit || isSummary) && <span className="text-[10px] font-mono text-center w-full">{resolved.duration}d</span>}
              </div>
              
              {/* Start date column */}
              <span className="text-[10px] font-mono text-muted-foreground text-center flex items-center justify-center h-full">{resolved.start}</span>
              
              {/* End date column */}
              <span className="text-[10px] font-mono text-muted-foreground text-center flex items-center justify-center h-full">{resolved.end}</span>
              
              {/* Completion column */}
              <div className="flex items-center justify-center gap-1 px-1 h-full">
                <div className="w-8 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${percentComplete}%` }} />
                </div>
                <span className="text-[10px] text-right flex-shrink-0">{percentComplete}%</span>
              </div>
            </>
          )}
        </div>

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

      {/* Column headers */}
      <div className="grid items-center border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider bg-muted/30 px-2 h-10 gap-0" style={{ gridTemplateColumns: 'auto 24px 1fr 56px 70px 70px 56px 80px' }}>
        <div className="w-5" />
        <div className="w-5" />
        <span className="truncate px-1">Name</span>
        <span className="text-center">WBS</span>
        <span className="text-center">Duration</span>
        <span className="text-center">Start</span>
        <span className="text-center">End</span>
        <span className="text-center">Completion</span>
      </div>

      {/* Task rows with fixed height for alignment with Gantt */}
      <div className="flex-1 overflow-y-auto">
        {flatTasksArray.map(task => (
          <div key={task.id} style={{ height: ROW_HEIGHT }} className="w-full">
            {renderTask(task, (task.level || 0))}
          </div>
        ))}
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