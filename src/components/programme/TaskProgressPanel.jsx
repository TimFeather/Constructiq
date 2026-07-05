import React, { useState, useEffect } from 'react';
import { TaskChangeLog } from '@/api/entities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle } from 'lucide-react';
import { format, differenceInDays, formatDistanceToNow } from 'date-fns';
import { updateTaskFull } from '@/lib/scheduleUpdateService';
import { useToast } from '@/components/ui/use-toast';

const FIELD_LABELS = {
  start_date: 'Start', end_date: 'Finish', duration: 'Duration',
  percent_complete: '% complete', actual_start: 'Actual start',
  actual_finish: 'Actual finish', constraint: 'Constraint',
  predecessors: 'Dependencies', name: 'Name', assignee_email: 'Assignee',
};

export default function TaskProgressPanel({ task, tasks = [], scheduledMap, scheduleOptions, editable = true, open, onOpenChange }) {
  const [form, setForm] = useState({});
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (task) {
      setForm({
        percent_complete: task.percent_complete || 0,
        actual_start: task.actual_start || '',
        actual_finish: task.actual_finish || '',
        status_notes: task.status_notes || '',
        delay_notes: task.delay_notes || '',
      });
    }
  }, [task]);

  // Audit trail: why did this task move?
  const { data: changeLog = [] } = useQuery({
    queryKey: ['taskChangeLog', task?.id],
    queryFn: () => TaskChangeLog.filter({ task_id: task.id }, '-created_at', 8),
    enabled: open && !!task?.id,
  });

  const saveMutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        ...data,
        actual_start: data.actual_start || null,
        actual_finish: data.actual_finish || null,
      };
      return updateTaskFull(task.id, payload, tasks, scheduleOptions || {});
    },
    onSuccess: ({ patches }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (patches.length > 1) {
        toast({ title: 'Progress saved', description: `${patches.length - 1} downstream task${patches.length === 2 ? '' : 's'} rescheduled.`, duration: 3500 });
      }
      onOpenChange(false);
    },
    onError: (e) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  if (!task) return null;

  const resolved = scheduledMap?.get(task.id);
  const plannedStart = resolved?.startStr || task.start_date;
  const plannedEnd = resolved?.finishStr || task.end_date;
  const isMilestone = task.is_milestone || task.duration === 0;
  const isSummary = tasks.some(t => t.parent_id === task.id);
  const isCritical = resolved?.isCritical || false;
  const floatDays = resolved ? Math.round((resolved.totalFloat / 8) * 10) / 10 : null;
  const conflict = resolved?.constraintConflict || null;

  // Variance calculation
  const today = new Date();
  const plannedEndDate = plannedEnd ? new Date(plannedEnd) : null;
  let varianceEl = null;
  if (plannedEndDate) {
    if (form.actual_finish) {
      const v = differenceInDays(plannedEndDate, new Date(form.actual_finish));
      varianceEl = v > 0
        ? <span className="text-emerald-600 font-semibold">{v} days ahead</span>
        : v < 0
          ? <span className="text-red-500 font-semibold">{Math.abs(v)} days behind</span>
          : <span className="text-muted-foreground">On time</span>;
    } else if (form.percent_complete < 100) {
      const v = differenceInDays(plannedEndDate, today);
      varianceEl = v >= 0
        ? <span className="text-emerald-600">{v} days remaining</span>
        : <span className="text-red-500">{Math.abs(v)} days overdue</span>;
    }
  }

  const taskName = (id) => tasks.find(t => t.id === id)?.name || 'another task';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 flex-wrap">
            <span className="truncate">{task.name}</span>
            <div className="flex gap-1">
              {task.wbs && <Badge variant="outline" className="text-xs font-mono">{task.wbs}</Badge>}
              {isMilestone && <Badge className="text-xs bg-indigo-100 text-indigo-700 border-indigo-200">Milestone</Badge>}
              {isSummary && <Badge variant="secondary" className="text-xs">Summary</Badge>}
              {isCritical && <Badge variant="destructive" className="text-xs">Critical</Badge>}
            </div>
          </SheetTitle>
        </SheetHeader>

        {/* Planned dates + schedule intel */}
        <div className="mt-4 p-3 rounded-lg bg-muted/40 border space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Planned Schedule</p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground block">Start</span>
              <span className="font-mono">{plannedStart ? format(new Date(plannedStart), 'dd MMM yy') : '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Finish</span>
              <span className="font-mono">{plannedEnd ? format(new Date(plannedEnd), 'dd MMM yy') : '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Duration</span>
              <span className="font-mono">{task.duration || 0}d</span>
            </div>
          </div>
          {floatDays !== null && !isSummary && (
            <div className="pt-2 border-t border-border/50 text-xs flex items-center justify-between">
              <span className="text-muted-foreground">Float (slack)</span>
              <span className={floatDays < 0 ? 'text-red-500 font-semibold' : isCritical ? 'text-red-500 font-semibold' : 'font-semibold'}>
                {floatDays < 0 ? `${floatDays}d — behind schedule` : isCritical ? '0d — critical path' : `${floatDays}d before it delays the programme`}
              </span>
            </div>
          )}
          {varianceEl && (
            <div className="pt-2 border-t border-border/50 text-xs">
              Variance: {varianceEl}
            </div>
          )}
          {conflict && (
            <div className="mt-2 p-2 rounded border border-amber-500/40 bg-amber-500/10 text-xs flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
              <span>
                Constraint conflict: this task's <span className="font-mono">{conflict.type}</span> constraint
                ({format(new Date(conflict.constraintDate), 'dd MMM yy')}) contradicts its dependencies,
                which need {format(new Date(conflict.requiredDate), 'dd MMM yy')}.
              </span>
            </div>
          )}
        </div>

        <div className="space-y-5 mt-5">
          {editable ? (
            <>
              {/* Progress slider */}
              <div>
                <Label className="flex justify-between">
                  <span>Percent Complete</span>
                  <span className="font-semibold text-primary">{form.percent_complete || 0}%</span>
                </Label>
                <Slider
                  value={[form.percent_complete || 0]}
                  onValueChange={([v]) => setForm(f => ({ ...f, percent_complete: v }))}
                  max={100} step={5} className="mt-3"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>
              </div>

              {/* Actual dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Actual Start</Label>
                  <Input
                    type="date"
                    value={form.actual_start || ''}
                    onChange={e => setForm(f => ({ ...f, actual_start: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Actual Finish</Label>
                  <Input
                    type="date"
                    value={form.actual_finish || ''}
                    onChange={e => setForm(f => ({ ...f, actual_finish: e.target.value, percent_complete: e.target.value ? 100 : f.percent_complete }))}
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Status notes */}
              <div>
                <Label>Status Notes</Label>
                <Textarea
                  value={form.status_notes || ''}
                  onChange={e => setForm(f => ({ ...f, status_notes: e.target.value }))}
                  placeholder="Current status, progress details..."
                  className="mt-1 h-20 text-sm"
                />
              </div>

              {/* Delay notes */}
              <div>
                <Label>Delay Notes</Label>
                <Textarea
                  value={form.delay_notes || ''}
                  onChange={e => setForm(f => ({ ...f, delay_notes: e.target.value }))}
                  placeholder="Reason for any delays..."
                  className="mt-1 h-20 text-sm"
                />
              </div>
            </>
          ) : (
            <div className="p-3 rounded-lg bg-muted/40 border space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Progress</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground block">% Complete</span>
                  <span className="font-semibold">{task.percent_complete || 0}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Actual Start</span>
                  <span className="font-mono">{task.actual_start ? format(new Date(task.actual_start), 'dd MMM yy') : '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Actual Finish</span>
                  <span className="font-mono">{task.actual_finish ? format(new Date(task.actual_finish), 'dd MMM yy') : '—'}</span>
                </div>
              </div>
              {task.status_notes && (
                <div className="text-xs pt-2 border-t border-border/50">
                  <span className="text-muted-foreground block">Status Notes</span>
                  <p className="whitespace-pre-wrap">{task.status_notes}</p>
                </div>
              )}
              {task.delay_notes && (
                <div className="text-xs pt-2 border-t border-border/50">
                  <span className="text-muted-foreground block">Delay Notes</span>
                  <p className="whitespace-pre-wrap">{task.delay_notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Why did this move? — audit trail */}
          {changeLog.length > 0 && (
            <div>
              <Label>Recent Schedule Changes</Label>
              <div className="mt-2 space-y-1.5">
                {changeLog.map(row => (
                  <div key={row.id} className="text-[11px] p-2 rounded border bg-muted/30">
                    <span className="font-medium">{FIELD_LABELS[row.field_changed] || row.field_changed}</span>
                    {': '}
                    <span className="line-through text-muted-foreground">{row.old_value ?? '—'}</span>
                    {' → '}
                    <span className="font-medium">{row.new_value ?? '—'}</span>
                    <div className="text-muted-foreground mt-0.5">
                      {row.trigger_task_id
                        ? <>rescheduled automatically after “{taskName(row.trigger_task_id)}” moved</>
                        : row.changed_by ? 'edited manually' : 'system change'}
                      {row.created_at ? ` · ${formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <SheetFooter className="mt-6 flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{editable ? 'Cancel' : 'Close'}</Button>
          {editable && (
            <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save Progress'}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
