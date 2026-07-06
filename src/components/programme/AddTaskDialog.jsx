/**
 * Native task creation — build a programme without MS Project.
 * Creates the task, then (optionally) links a predecessor through the
 * scheduling service so the engine places it straight away.
 */
import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { createTaskInline } from '@/lib/programme/createTask';

const NONE = '__none__';

const DEP_TYPES = [
  { value: 'FS', label: 'Finish-to-Start (FS)' },
  { value: 'SS', label: 'Start-to-Start (SS)' },
  { value: 'FF', label: 'Finish-to-Finish (FF)' },
  { value: 'SF', label: 'Start-to-Finish (SF)' },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AddTaskDialog({ open, onOpenChange, projectId, tasks, scheduleOptions }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', duration: 5, start_date: '', is_milestone: false,
    parent_id: NONE, predecessor_id: NONE, dep_type: 'FS', lag_days: 0,
  });

  useEffect(() => {
    if (open) {
      setForm({
        name: '', duration: 5,
        start_date: scheduleOptions?.dataDate || todayStr(),
        is_milestone: false, parent_id: NONE, predecessor_id: NONE, dep_type: 'FS', lag_days: 0,
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const parentOptions = tasks.filter(t => tasks.some(c => c.parent_id === t.id) || !t.parent_id);

  const predecessor = form.predecessor_id !== NONE ? tasks.find(t => t.id === form.predecessor_id) : null;
  const parentId = form.parent_id === NONE ? null : form.parent_id;
  const predecessorInDifferentGroup = !!predecessor && (predecessor.parent_id || null) !== parentId;

  const handleCreate = async () => {
    if (!form.name.trim() || !projectId || projectId === 'all') return;
    setSaving(true);
    try {
      await createTaskInline({
        projectId,
        name: form.name,
        tasks,
        scheduleOptions,
        parentId,
        predecessorId: form.predecessor_id !== NONE ? form.predecessor_id : null,
        depType: form.dep_type,
        lagDays: form.lag_days,
        duration: form.duration,
        isMilestone: form.is_milestone,
        startDate: form.start_date,
      });

      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast({ title: 'Task added', description: form.name.trim(), duration: 2500 });
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not add task', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Task name *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Frame ground floor walls" className="mt-1" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Duration (working days)</Label>
              <Input type="number" min={1} value={form.duration} disabled={form.is_milestone}
                onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Start date</Label>
              <Input type="date" value={form.start_date}
                onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="mt-1" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="add-task-milestone" checked={form.is_milestone}
              onCheckedChange={v => setForm(f => ({ ...f, is_milestone: !!v }))} />
            <Label htmlFor="add-task-milestone" className="text-sm font-normal">Milestone (zero duration)</Label>
          </div>
          <div>
            <Label>Parent (WBS group)</Label>
            <Select value={form.parent_id} onValueChange={v => setForm(f => ({ ...f, parent_id: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None (top level)</SelectItem>
                {parentOptions.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.wbs ? `${t.wbs} ` : ''}{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Predecessor (optional)</Label>
            <Select value={form.predecessor_id} onValueChange={v => setForm(f => ({ ...f, predecessor_id: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {tasks.filter(t => !tasks.some(c => c.parent_id === t.id)).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.wbs ? `${t.wbs} ` : ''}{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Dependency type</Label>
              <Select
                value={form.dep_type}
                onValueChange={v => setForm(f => ({ ...f, dep_type: v }))}
                disabled={form.predecessor_id === NONE}
              >
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEP_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Lag (days)</Label>
              <Input
                type="number"
                value={form.lag_days}
                disabled={form.predecessor_id === NONE}
                onChange={e => setForm(f => ({ ...f, lag_days: e.target.value }))}
                className="mt-1"
                placeholder="0"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-2">
            {predecessorInDifferentGroup
              ? 'Predecessor is in a different WBS group — this task is placed at the end of the chosen parent group.'
              : predecessor
                ? 'New task is placed directly below its predecessor.'
                : 'Negative lag = lead time. More links can be added afterwards by dragging between bars.'}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving || !form.name.trim()}>
            {saving ? 'Adding…' : 'Add Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
