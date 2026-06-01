import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import { cascadeTaskDates } from '@/lib/cascadeTaskDates';

const levelColors = [
  'border-l-primary',
  'border-l-accent',
  'border-l-amber-500',
  'border-l-purple-500',
];

export default function TaskList({ tasks, onTaskClick, onAddTask, collapsed, canEdit = false }) {
  const [expandedIds, setExpandedIds] = useState(new Set(tasks.filter(t => t.level === 0).map(t => t.id)));
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Task.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

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
    if (finalData.end_date) {
      await cascadeTaskDates(taskId, finalData.end_date, tasks, (id, data) => base44.entities.Task.update(id, data));
    }
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setEditingId(null);
  };

  const handleFieldChange = (field, value) => {
    const updated = { ...editValues, [field]: value };
    // Auto-recalculate
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
    const percentComplete = task.percent_complete || 0;

    return (
      <React.Fragment key={task.id}>
        <div
          className={cn(
            "flex items-center gap-1 hover:bg-muted/50 transition-colors border-l-3 group",
            levelColors[task.level || 0] || 'border-l-muted',
            isEditing ? 'bg-primary/5' : 'cursor-pointer',
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={isEditing ? undefined : () => onTaskClick(task)}
          onDoubleClick={(e) => canEdit && startEdit(task, e)}
        >
          {/* Expand toggle */}
          <div className="w-5 flex-shrink-0">
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
            /* Inline edit row */
            <>
              <Input
                autoFocus
                value={editValues.name}
                onChange={e => handleFieldChange('name', e.target.value)}
                className="h-7 text-xs flex-1 min-w-0 mr-1"
                onClick={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(task.id); if (e.key === 'Escape') setEditingId(null); }}
              />
              <Input
                type="date"
                value={editValues.start_date}
                onChange={e => handleFieldChange('start_date', e.target.value)}
                className="h-7 text-xs w-32 flex-shrink-0"
                onClick={e => e.stopPropagation()}
              />
              <Input
                type="number"
                min="1"
                value={editValues.duration}
                onChange={e => handleFieldChange('duration', e.target.value)}
                className="h-7 text-xs w-14 flex-shrink-0 text-center"
                onClick={e => e.stopPropagation()}
                title="Duration (days)"
              />
              <Input
                type="date"
                value={editValues.end_date}
                onChange={e => handleFieldChange('end_date', e.target.value)}
                className="h-7 text-xs w-32 flex-shrink-0"
                onClick={e => e.stopPropagation()}
              />
              <button
                className="ml-1 px-2 py-1 text-xs bg-primary text-primary-foreground rounded flex-shrink-0"
                onClick={e => { e.stopPropagation(); commitEdit(task.id); }}
              >✓</button>
              <button
                className="px-2 py-1 text-xs text-muted-foreground rounded flex-shrink-0"
                onClick={e => { e.stopPropagation(); setEditingId(null); }}
              >✕</button>
            </>
          ) : (
            /* Normal display row */
            <>
              <div className="flex-1 min-w-0 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-10 flex-shrink-0">{task.wbs || '—'}</span>
                  <span className={cn(
                    "text-xs truncate",
                    task.level === 0 && "font-bold",
                    task.level === 1 && "font-semibold",
                  )}>
                    {task.name}
                  </span>
                  {canEdit && (
                    <span className="opacity-0 group-hover:opacity-100 text-[9px] text-muted-foreground ml-1 flex-shrink-0">(dbl-click)</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground pr-2">
                <span className="w-14 text-right">{task.duration || 0}d</span>
                <div className="flex items-center gap-1 w-20">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${percentComplete}%` }} />
                  </div>
                  <span className="text-[10px] w-7 flex-shrink-0">{percentComplete}%</span>
                </div>
                <span className="w-24 truncate">{task.assignee_name || '—'}</span>
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
      {/* Header */}
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
        <div className="flex-1 flex items-center gap-1.5">
          <span className="w-10">WBS</span>
          <span>Name</span>
        </div>
        <span className="w-14 text-right pr-2">Dur.</span>
        <span className="w-20">Progress</span>
        <span className="w-24 pr-2">Assignee</span>
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
          <p className="text-[10px] text-muted-foreground">Double-click any row to edit inline</p>
        </div>
      )}
    </div>
  );
}