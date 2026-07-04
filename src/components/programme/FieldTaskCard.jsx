import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Calendar, User } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr), 'dd MMM');
  } catch {
    return '—';
  }
}

export default function FieldTaskCard({ task, planned, onClick, showAssignee }) {
  const pct = task.percent_complete || 0;
  const isMilestone = task.is_milestone || task.duration === 0;
  const today = todayStr();
  const isOverdue = !!(planned?.finishStr && planned.finishStr < today);

  let statusLabel, statusClass;
  if (pct >= 100) {
    statusLabel = 'Complete';
    statusClass = 'bg-emerald-100 text-emerald-700';
  } else if (pct > 0) {
    statusLabel = isOverdue ? 'Overdue' : 'In progress';
    statusClass = isOverdue ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700';
  } else {
    statusLabel = isOverdue ? 'Overdue' : 'Not started';
    statusClass = isOverdue ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground';
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
      className="w-full text-left rounded-lg border bg-card p-3 active:scale-[0.99] transition"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium line-clamp-2">{task.name}</span>
        <div className="flex flex-shrink-0 gap-1">
          {task.wbs && (
            <Badge variant="outline" className="text-[10px] font-mono">{task.wbs}</Badge>
          )}
          {isMilestone && (
            <Badge className="text-[10px] bg-indigo-100 text-indigo-700 border-indigo-200">Milestone</Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
        <Calendar className="w-3.5 h-3.5" />
        <span>{formatDate(planned?.startStr)} → {formatDate(planned?.finishStr)}</span>
      </div>

      {showAssignee && task.assignee_email && (
        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
          <User className="w-3.5 h-3.5" />
          <span className="truncate">{task.assignee_email}</span>
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-1.5 rounded bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded', pct >= 100 ? 'bg-emerald-500' : 'bg-primary')}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
        <span className="text-sm font-bold">{pct}%</span>
      </div>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold', statusClass)}>
          {statusLabel}
        </span>
        {planned?.isCritical && (
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold bg-red-100 text-red-700">
            Critical
          </span>
        )}
      </div>
    </div>
  );
}
