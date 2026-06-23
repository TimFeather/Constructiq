import React, { useState, useEffect } from 'react';
import { Task } from '@/api/entities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { format, differenceInDays } from 'date-fns';

export default function TaskProgressPanel({ task, tasks = [], scheduledMap, open, onOpenChange }) {
  const [form, setForm] = useState({});
  const queryClient = useQueryClient();

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

  const saveMutation = useMutation({
    mutationFn: (data) => Task.update(task.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    },
  });

  if (!task) return null;

  const resolved = scheduledMap?.get(task.id);
  const plannedStart = resolved?.startStr || task.start_date;
  const plannedEnd = resolved?.finishStr || task.end_date;
  const isMilestone = task.is_milestone || task.duration === 0;
  const isSummary = tasks.some(t => t.parent_id === task.id);
  const isCritical = resolved?.isCritical || false;

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

        {/* Planned dates (read-only info) */}
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
          {varianceEl && (
            <div className="pt-2 border-t border-border/50 text-xs">
              Variance: {varianceEl}
            </div>
          )}
        </div>

        <div className="space-y-5 mt-5">
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
        </div>

        <SheetFooter className="mt-6 flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save Progress'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}