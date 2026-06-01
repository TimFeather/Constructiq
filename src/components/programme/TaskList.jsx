import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Plus, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/shared/StatusBadge';

const levelColors = [
  'border-l-primary',
  'border-l-accent',
  'border-l-amber-500',
  'border-l-purple-500',
];

const levelLabels = ['Phase', 'Summary', 'Task', 'Subtask'];

export default function TaskList({ tasks, onTaskClick, onAddTask, collapsed }) {
  const [expandedIds, setExpandedIds] = useState(new Set(tasks.filter(t => t.level === 0).map(t => t.id)));

  if (collapsed) return null;

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build hierarchy
  const rootTasks = tasks.filter(t => !t.parent_id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const getChildren = (parentId) => {
    return tasks
      .filter(t => t.parent_id === parentId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  };

  const renderTask = (task, depth = 0) => {
    const children = getChildren(task.id);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(task.id);
    const percentComplete = task.percent_complete || 0;

    return (
      <React.Fragment key={task.id}>
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors border-l-3",
            levelColors[task.level || 0] || 'border-l-muted',
          )}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
          onClick={() => onTaskClick(task)}
        >
          {hasChildren ? (
            <button
              className="w-5 h-5 flex items-center justify-center hover:bg-muted rounded"
              onClick={(e) => { e.stopPropagation(); toggleExpand(task.id); }}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <div className="w-5" />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground w-12 flex-shrink-0">{task.wbs || '—'}</span>
              <span className={cn(
                "text-sm truncate",
                task.level === 0 && "font-bold",
                task.level === 1 && "font-semibold",
              )}>
                {task.name}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0 text-xs text-muted-foreground">
            <span className="hidden lg:block w-16 text-right">{task.duration || 0}d</span>
            <div className="hidden md:flex items-center gap-1 w-16">
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${percentComplete}%` }} />
              </div>
              <span className="text-[10px]">{percentComplete}%</span>
            </div>
            <span className="hidden xl:block w-20 truncate">{task.assignee_name || '—'}</span>
          </div>
        </div>

        {hasChildren && isExpanded && children.map(child => renderTask(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="border-r bg-card h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task List</span>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onAddTask}>
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        <div className="w-5" />
        <div className="flex-1 flex items-center gap-2">
          <span className="w-12">WBS</span>
          <span>Name</span>
        </div>
        <span className="hidden lg:block w-16 text-right">Duration</span>
        <span className="hidden md:block w-16">Progress</span>
        <span className="hidden xl:block w-20">Assignee</span>
      </div>

      {/* Task rows */}
      <div className="flex-1 overflow-y-auto">
        {rootTasks.map(task => renderTask(task))}
        {tasks.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No tasks yet</div>
        )}
      </div>
    </div>
  );
}