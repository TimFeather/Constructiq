/**
 * Full task editor — the native authoring surface.
 * All saves route through scheduleUpdateService (never Task.update directly)
 * so dependency-driven rescheduling and the audit trail happen on every edit.
 */
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
import { Save, Plus, X, Trash2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { updateTaskFull } from '@/lib/scheduleUpdateService';

const CONSTRAINT_OPTIONS = [
  { value: 'ASAP', label: 'As soon as possible (default)' },
  { value: 'SNET', label: 'Start no earlier than' },
  { value: 'SNLT', label: 'Start no later than' },
  { value: 'FNET', label: 'Finish no earlier than' },
  { value: 'FNLT', label: 'Finish no later than' },
  { value: 'MSO', label: 'Must start on' },
  { value: 'MFO', label: 'Must finish on' },
];
const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'];

export default function TaskInlineEditor({ task, tasks = [], scheduleOptions, editable = true, open, onOpenChange }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (task) {
      setForm({
        name: task.name || '',
        duration: task.duration ?? 1,
        start_date: task.start_date || '',
        constraint_type: task.constraint?.type || 'ASAP',
        constraint_date: task.constraint?.date || '',
        predecessors: (task.predecessors || []).map(p => ({
          predecessor_id: p.predecessor_id || p.task_id,
          type: p.type || 'FS',
          lag_days: p.lag_days ?? (p.lag_hours ?? 0) / 8,
        })),
        percent_complete: task.percent_complete || 0,
        task_status: task.task_status || '',
        actual_start: task.actual_start || '',
        actual_finish: task.actual_finish || '',
        delay_notes: task.delay_notes || '',
        status_notes: task.status_notes || '',
      });
      setConfirmDelete(false);
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (data) => {
      const constraint = data.constraint_type && data.constraint_type !== 'ASAP'
        ? { type: data.constraint_type, date: data.constraint_date || null }
        : null;
      const payload = {
        name: data.name,
        duration: task.is_milestone ? 0 : Math.max(1, Number(data.duration) || 1),
        start_date: data.start_date || null,
        constraint,
        predecessors: data.predecessors
          .filter(p => p.predecessor_id)
          .map(p => ({
            predecessor_id: p.predecessor_id,
            type: p.type,
            lag_days: Number(p.lag_days) || 0,
            lag_hours: (Number(p.lag_days) || 0) * 8,
            is_elapsed: false,
          })),
        percent_complete: data.percent_complete,
        task_status: data.task_status || null,
        actual_start: data.actual_start || null,
        actual_finish: data.actual_finish || null,
        delay_notes: data.delay_notes,
        status_notes: data.status_notes,
      };
      return updateTaskFull(task.id, payload, tasks, scheduleOptions || {});
    },
    onSuccess: ({ patches }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({
        title: 'Task updated',
        description: patches.length > 1 ? `${patches.length - 1} downstream task${patches.length === 2 ? '' : 's'} rescheduled.` : undefined,
        duration: 3000,
      });
      onOpenChange(false);
    },
    onError: (e) => toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => Task.delete(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({ title: 'Task deleted', duration: 2500 });
      onOpenChange(false);
    },
    onError: (e) => toast({
      title: 'Delete failed',
      description: e.message?.includes('foreign key') ? 'Move or delete its subtasks first.' : e.message,
      variant: 'destructive',
    }),
  });

  if (!task || !form) return null;

  const isSummary = tasks.some(t => t.parent_id === task.id);
  const isMilestone = task.is_milestone || task.duration === 0;
  const pct = form.percent_complete;
  const predCandidates = tasks.filter(t => t.id !== task.id && !tasks.some(c => c.parent_id === t.id));
  const nameOf = (id) => {
    const t = tasks.find(x => x.id === id);
    return t ? `${t.wbs ? `${t.wbs} ` : ''}${t.name}` : '(missing task)';
  };

  const setPred = (idx, patch) => setForm(f => ({
    ...f,
    predecessors: f.predecessors.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
  }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[380px] sm:w-[440px] flex flex-col">
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
          {editable && (
            <>
              {/* Name */}
              <div>
                <Label className="text-xs">Task name</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mt-1" />
              </div>

              {/* Schedule */}
              {!isSummary && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Duration (working days)</Label>
                    <Input type="number" min={1} value={form.duration} disabled={isMilestone}
                      onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Start date</Label>
                    <Input type="date" value={form.start_date}
                      onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="mt-1" />
                    {form.predecessors.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">Dependencies drive this task — use a constraint to hold a date.</p>
                    )}
                  </div>
                </div>
              )}

              {/* Constraint */}
              {!isSummary && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Constraint</Label>
                    <Select value={form.constraint_type} onValueChange={v => setForm(f => ({ ...f, constraint_type: v }))}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONSTRAINT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Constraint date</Label>
                    <Input type="date" value={form.constraint_date} disabled={form.constraint_type === 'ASAP'}
                      onChange={e => setForm(f => ({ ...f, constraint_date: e.target.value }))} className="mt-1" />
                  </div>
                </div>
              )}

              {/* Dependencies */}
              {!isSummary && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Predecessors</Label>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1"
                      onClick={() => setForm(f => ({ ...f, predecessors: [...f.predecessors, { predecessor_id: '', type: 'FS', lag_days: 0 }] }))}>
                      <Plus className="w-3 h-3" /> Add
                    </Button>
                  </div>
                  <div className="mt-1 space-y-1.5">
                    {form.predecessors.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">No dependencies — this task anchors to its start date.</p>
                    )}
                    {form.predecessors.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <Select value={p.predecessor_id || ''} onValueChange={v => setPred(idx, { predecessor_id: v })}>
                          <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                            <SelectValue placeholder="Select task…">
                              {p.predecessor_id ? <span className="truncate">{nameOf(p.predecessor_id)}</span> : null}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {predCandidates.map(t => (
                              <SelectItem key={t.id} value={t.id}>{t.wbs ? `${t.wbs} ` : ''}{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={p.type} onValueChange={v => setPred(idx, { type: v })}>
                          <SelectTrigger className="h-8 text-xs w-[64px] flex-shrink-0"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DEP_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" value={p.lag_days} title="Lag (working days, negative = lead)"
                          onChange={e => setPred(idx, { lag_days: e.target.value })}
                          className="h-8 text-xs w-[58px] flex-shrink-0" />
                        <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setForm(f => ({ ...f, predecessors: f.predecessors.filter((_, i) => i !== idx) }))}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-4" />
            </>
          )}

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

        <div className="flex-shrink-0 pt-3 border-t space-y-2">
          <Button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending}
            className="w-full gap-2"
          >
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
          {editable && !isSummary && (
            <Button
              variant={confirmDelete ? 'destructive' : 'ghost'}
              size="sm"
              className="w-full gap-2 text-xs"
              disabled={deleteMutation.isPending}
              onClick={() => (confirmDelete ? deleteMutation.mutate() : setConfirmDelete(true))}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleteMutation.isPending ? 'Deleting…' : confirmDelete ? 'Click again to confirm delete' : 'Delete task'}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
