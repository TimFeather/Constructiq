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
import { Task } from '@/api/entities';
import { updateTaskDependency } from '@/lib/scheduleUpdateService';

const NONE = '__none__';

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
    parent_id: NONE, predecessor_id: NONE,
  });

  useEffect(() => {
    if (open) {
      setForm({
        name: '', duration: 5,
        start_date: scheduleOptions?.dataDate || todayStr(),
        is_milestone: false, parent_id: NONE, predecessor_id: NONE,
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const parentOptions = tasks.filter(t => tasks.some(c => c.parent_id === t.id) || !t.parent_id);

  const handleCreate = async () => {
    if (!form.name.trim() || !projectId || projectId === 'all') return;
    setSaving(true);
    try {
      const maxSort = tasks.reduce((m, t) => Math.max(m, Number(t.sort_order) || 0), 0);
      const parentId = form.parent_id === NONE ? null : form.parent_id;
      const parent = parentId ? tasks.find(t => t.id === parentId) : null;

      const created = await Task.create({
        project_id: projectId,
        name: form.name.trim(),
        duration: form.is_milestone ? 0 : Math.max(1, Number(form.duration) || 1),
        is_milestone: form.is_milestone,
        start_date: form.start_date || todayStr(),
        end_date: null,
        parent_id: parentId,
        level: parent ? Math.min((parent.level ?? 1) + 1, 3) : 1,
        sort_order: maxSort + 1,
        percent_complete: 0,
        task_status: 'Not Started',
      });

      // Optional predecessor: link via the service so the engine places the
      // new task (and cascades) immediately.
      if (form.predecessor_id !== NONE && created?.id) {
        const allTasks = [...tasks, { ...created, predecessors: [] }];
        await updateTaskDependency(created.id, [{
          predecessor_id: form.predecessor_id, type: 'FS', lag_days: 0, lag_hours: 0, is_elapsed: false,
        }], allTasks, scheduleOptions);
      }

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
            <Label>Predecessor (optional, finish-to-start)</Label>
            <Select value={form.predecessor_id} onValueChange={v => setForm(f => ({ ...f, predecessor_id: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {tasks.filter(t => !tasks.some(c => c.parent_id === t.id)).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.wbs ? `${t.wbs} ` : ''}{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              More link types and lag can be set afterwards by dragging between bars or editing the task.
            </p>
          </div>
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
