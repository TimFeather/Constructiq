import React, { useState, useEffect } from 'react';
import { Task } from '@/api/entities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Save } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function TaskInlineEditor({ task, open, onOpenChange }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (task) {
      setForm({
        percent_complete: task.percent_complete || 0,
        task_status: task.task_status || '',
        actual_start: task.actual_start || '',
        actual_finish: task.actual_finish || '',
        delay_days: task.delay_days ?? '',
        delay_notes: task.delay_notes || '',
        status_notes: task.status_notes || '',
      });
    }
  }, [task?.id]);

  const mutation = useMutation({
    mutationFn: (data) => Task.update(task.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({ title: 'Task updated', duration: 3000 });
      onOpenChange(false);
    },
  });

  if (!task || !form) return null;

  const isSummary = false; // display only
  const pct = form.percent_complete;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[380px] sm:w-[420px] flex flex-col">
        <SheetHeader className="flex-shrink-0 pb-3 border-b">
          <SheetTitle className="text-sm leading-snug pr-6">
            {task.wbs && (
              <span className="text-muted-foreground font-mono text-xs mr-2">{task.wbs}</span>
            )}
            {task.name}
          </SheetTitle>
          {(task.start_date || task.end_date) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Planned: {task.start_date ? format(new Date(task.start_date), 'dd MMM') : '—'}
              {' → '}
              {task.end_date ? format(new Date(task.end_date), 'dd MMM yyyy') : '—'}
              {task.duration ? ` · ${task.duration}d` : ''}
            </p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Status */}
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.task_status} onValueChange={v => setForm(f => ({ ...f, task_status: v }))}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Not Started">Not Started</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="On Hold">On Hold</SelectItem>
                <SelectItem value="Complete">Complete</SelectItem>
                <SelectItem value="Delayed">Delayed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Percent Complete */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Percent Complete</Label>
              <span className={cn(
                'text-xs font-semibold',
                pct === 100 ? 'text-emerald-600' : pct > 0 ? 'text-primary' : 'text-muted-foreground'
              )}>{pct}%</span>
            </div>
            <div className="flex items-center gap-3">
              <Slider
                value={[pct]}
                onValueChange={([v]) => setForm(f => ({ ...f, percent_complete: v }))}
                min={0} max={100} step={5}
                className="flex-1"
              />
              <Input
                type="number"
                min={0} max={100}
                value={pct}
                onChange={e => setForm(f => ({ ...f, percent_complete: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                className="w-16 h-8 text-sm text-center"
              />
            </div>
          </div>

          {/* Actual Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Actual Start</Label>
              <Input
                type="date"
                value={form.actual_start}
                onChange={e => setForm(f => ({ ...f, actual_start: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Actual Finish</Label>
              <Input
                type="date"
                value={form.actual_finish}
                onChange={e => setForm(f => ({ ...f, actual_finish: e.target.value }))}
                className="mt-1"
              />
            </div>
          </div>

          {/* Delay Days */}
          <div>
            <Label className="text-xs">Delay Days</Label>
            <Input
              type="number"
              min={0}
              value={form.delay_days}
              onChange={e => setForm(f => ({ ...f, delay_days: e.target.value !== '' ? Number(e.target.value) : '' }))}
              placeholder="0"
              className="mt-1"
            />
          </div>

          {/* Delay Reason */}
          <div>
            <Label className="text-xs">Delay Reason</Label>
            <Textarea
              value={form.delay_notes}
              onChange={e => setForm(f => ({ ...f, delay_notes: e.target.value }))}
              rows={2}
              placeholder="Reason for any delay..."
              className="mt-1 text-sm"
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={form.status_notes}
              onChange={e => setForm(f => ({ ...f, status_notes: e.target.value }))}
              rows={3}
              placeholder="Status notes..."
              className="mt-1 text-sm"
            />
          </div>
        </div>

        <div className="flex-shrink-0 pt-3 border-t">
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending}
            className="w-full gap-2"
          >
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}