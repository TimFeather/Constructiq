import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { cascadeTaskDates } from '@/lib/cascadeTaskDates';
import { wouldCreateCycle } from '@/lib/schedulingEngine';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, X, AlertTriangle } from 'lucide-react';

const DEP_TYPES = [
  { value: 'FS', label: 'FS — Finish-to-Start' },
  { value: 'SS', label: 'SS — Start-to-Start' },
  { value: 'FF', label: 'FF — Finish-to-Finish' },
  { value: 'SF', label: 'SF — Start-to-Finish' },
];

const CONSTRAINT_TYPES = [
  { value: 'ASAP', label: 'ASAP — As Soon As Possible' },
  { value: 'ALAP', label: 'ALAP — As Late As Possible' },
  { value: 'MSO',  label: 'MSO — Must Start On' },
  { value: 'FNLT', label: 'FNLT — Finish No Later Than' },
];

export default function TaskEditPanel({ task, tasks = [], open, onOpenChange, onPushHistory }) {
  const [form, setForm] = useState({});
  const [cycleError, setCycleError] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (task) {
      setForm({
        ...task,
        constraint: task.constraint || { type: 'ASAP', date: null },
        predecessors: (task.predecessors || []).map(p => ({
          predecessor_id: p.predecessor_id || p.task_id || '',
          type: p.type || 'FS',
          lag_hours: p.lag_hours ?? (p.lag_days != null ? p.lag_days * 8 : 0),
          is_elapsed: p.is_elapsed || false,
        })),
      });
      setCycleError(null);
    }
  }, [task]);

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      await base44.entities.Task.update(task.id, data);
      // Merge updated task into tasks list for accurate cascade
      const mergedTasks = tasks.map(t => t.id === task.id ? { ...t, ...data } : t);
      await cascadeTaskDates(task.id, mergedTasks, (id, d) => base44.entities.Task.update(id, d));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const deletedId = task.id;
      // Remove predecessor references to this task from all other tasks
      const affected = tasks.filter(t =>
        t.id !== deletedId &&
        (t.predecessors || []).some(p => (p.predecessor_id || p.task_id) === deletedId)
      );
      await Promise.all(
        affected.map(t =>
          base44.entities.Task.update(t.id, {
            predecessors: (t.predecessors || []).filter(
              p => (p.predecessor_id || p.task_id) !== deletedId
            ),
          })
        )
      );
      return base44.entities.Task.delete(deletedId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    }
  });

  const recalcEnd = (start, duration) => {
    if (!start || !duration) return form.end_date || '';
    let date = new Date(start + 'T00:00:00');
    let daysAdded = 0;
    const target = Math.max(1, duration) - 1;
    while (daysAdded < target) {
      date.setDate(date.getDate() + 1);
      const dow = date.getDay();
      if (dow !== 0 && dow !== 6) daysAdded++;
    }
    return date.toISOString().split('T')[0];
  };

  const handleSave = () => {
    const { id, created_date, updated_date, created_by, ...data } = form;
    // Normalise predecessors to canonical schema
    data.predecessors = (form.predecessors || []).map(p => ({
      predecessor_id: p.predecessor_id,
      task_id: p.predecessor_id, // keep backward compat
      type: p.type || 'FS',
      lag_hours: p.lag_hours || 0,
      lag_days: Math.round((p.lag_hours || 0) / 8),
      is_elapsed: p.is_elapsed || false,
    }));
    // Record undo snapshot: revert to original task state
    if (onPushHistory && task) {
      const { id: _id, created_date: _cd, updated_date: _ud, created_by: _cb, ...originalData } = task;
      onPushHistory(
        [{ id: task.id, data: originalData }],  // undo: restore original
        [{ id: task.id, data }],                  // redo: re-apply new data
      );
    }
    updateMutation.mutate(data);
  };

  const addPredecessor = () => {
    setForm(f => ({
      ...f,
      predecessors: [...(f.predecessors || []), { predecessor_id: '', type: 'FS', lag_hours: 0, is_elapsed: false }]
    }));
  };

  const updatePredecessor = (idx, field, value) => {
    setCycleError(null);
    const updated = (form.predecessors || []).map((p, i) => i === idx ? { ...p, [field]: value } : p);

    if (field === 'predecessor_id' && value && value !== '') {
      // Cycle check
      const tasksWithNewDep = tasks.map(t => {
        if (t.id !== task.id) return t;
        return {
          ...t,
          predecessors: updated.map(p => ({ ...p, task_id: p.predecessor_id }))
        };
      });
      if (wouldCreateCycle(tasksWithNewDep, value, task.id)) {
        setCycleError(`Circular dependency detected: linking to "${tasks.find(t => t.id === value)?.name}" would create a loop.`);
        return;
      }
    }

    setForm(f => ({ ...f, predecessors: updated }));
  };

  const removePredecessor = (idx) => {
    setForm(f => ({ ...f, predecessors: (f.predecessors || []).filter((_, i) => i !== idx) }));
  };

  if (!task) return null;

  const isSummary = form.is_summary || form.level === 0 || form.level === 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Edit Task
            {isSummary && <Badge variant="secondary" className="text-xs">Summary</Badge>}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {/* Name */}
          <div>
            <Label>Task Name</Label>
            <Input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>

          {/* WBS + Level */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>WBS</Label>
              <Input value={form.wbs || ''} onChange={e => setForm({ ...form, wbs: e.target.value })} />
            </div>
            <div>
              <Label>Level</Label>
              <Select value={String(form.level ?? 2)} onValueChange={v => setForm({ ...form, level: parseInt(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Phase</SelectItem>
                  <SelectItem value="1">Summary Task</SelectItem>
                  <SelectItem value="2">Task</SelectItem>
                  <SelectItem value="3">Subtask</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Parent */}
          <div>
            <Label>Parent Task</Label>
            <Select value={form.parent_id || 'none'} onValueChange={v => setForm({ ...form, parent_id: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="None (Root)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Root)</SelectItem>
                {tasks.filter(t => t.id !== task.id && t.project_id === task.project_id).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.wbs ? `${t.wbs} ` : ''}{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Constraint */}
          <div>
            <Label>Scheduling Constraint</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <Select
                value={(form.constraint || {}).type || 'ASAP'}
                onValueChange={v => setForm({ ...form, constraint: { ...(form.constraint || {}), type: v } })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSTRAINT_TYPES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {['MSO', 'FNLT'].includes((form.constraint || {}).type) && (
                <Input
                  type="date"
                  value={(form.constraint || {}).date || ''}
                  onChange={e => setForm({ ...form, constraint: { ...(form.constraint || {}), date: e.target.value } })}
                />
              )}
            </div>
          </div>

          {/* Dates — read-only for summary tasks */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date {isSummary && <span className="text-muted-foreground text-[10px]">(auto)</span>}</Label>
              <Input
                type="date"
                value={form.start_date || ''}
                disabled={isSummary}
                onChange={e => {
                  const start = e.target.value;
                  setForm({ ...form, start_date: start, end_date: recalcEnd(start, form.duration) });
                }}
              />
            </div>
            <div>
              <Label>End Date {isSummary && <span className="text-muted-foreground text-[10px]">(auto)</span>}</Label>
              <Input
                type="date"
                value={form.end_date || ''}
                disabled={isSummary}
                onChange={e => {
                  const end = e.target.value;
                  const start = form.start_date;
                  let duration = form.duration;
                  if (start && end) {
                    duration = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
                  }
                  setForm({ ...form, end_date: end, duration });
                }}
              />
            </div>
          </div>

          {/* Duration */}
          {!isSummary && (
            <div>
              <Label>Duration (days)</Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0"
                  onClick={() => {
                    const dur = Math.max(1, (form.duration || 1) - 1);
                    setForm({ ...form, duration: dur, end_date: recalcEnd(form.start_date, dur) });
                  }}>−</Button>
                <Input
                  type="number" min="1"
                  value={form.duration || 1}
                  onChange={e => {
                    const dur = Math.max(1, parseInt(e.target.value) || 1);
                    setForm({ ...form, duration: dur, end_date: recalcEnd(form.start_date, dur) });
                  }}
                  className="text-center"
                />
                <Button type="button" variant="outline" size="sm" className="h-8 w-8 p-0"
                  onClick={() => {
                    const dur = (form.duration || 1) + 1;
                    setForm({ ...form, duration: dur, end_date: recalcEnd(form.start_date, dur) });
                  }}>+</Button>
              </div>
            </div>
          )}

          {/* Progress */}
          <div>
            <Label>% Complete: {form.percent_complete || 0}%</Label>
            <Slider
              value={[form.percent_complete || 0]}
              onValueChange={([v]) => setForm({ ...form, percent_complete: v })}
              max={100} step={5} className="mt-2"
            />
          </div>

          {/* Assignee */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Assignee Name</Label>
              <Input value={form.assignee_name || ''} onChange={e => setForm({ ...form, assignee_name: e.target.value })} />
            </div>
            <div>
              <Label>Assignee Email</Label>
              <Input value={form.assignee_email || ''} onChange={e => setForm({ ...form, assignee_email: e.target.value })} />
            </div>
          </div>

          {/* ── Predecessors ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Dependencies (Predecessors)</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={addPredecessor}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>

            {cycleError && (
              <div className="flex items-start gap-2 text-destructive text-xs mb-2 bg-destructive/10 rounded p-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                {cycleError}
              </div>
            )}

            {(form.predecessors || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No predecessors — task is ASAP</p>
            )}

            <div className="space-y-2">
              {(form.predecessors || []).map((pred, idx) => (
                <div key={idx} className="border rounded-md p-2 space-y-2 bg-muted/20">
                  <div className="flex items-center gap-2">
                    {/* Predecessor task */}
                    <Select
                      value={pred.predecessor_id || 'none'}
                      onValueChange={v => updatePredecessor(idx, 'predecessor_id', v === 'none' ? '' : v)}
                    >
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Select predecessor" />
                      </SelectTrigger>
                      <SelectContent>
                        {tasks.filter(t => t.id !== task.id && t.project_id === task.project_id).map(t => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.wbs ? `${t.wbs} ` : ''}{t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Remove */}
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removePredecessor(idx)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Dependency type */}
                    <Select
                      value={pred.type || 'FS'}
                      onValueChange={v => updatePredecessor(idx, 'type', v)}
                    >
                      <SelectTrigger className="w-[160px] h-8 text-xs flex-shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DEP_TYPES.map(d => (
                          <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Lag in hours */}
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">Lag (hrs)</span>
                      <Input
                        type="number"
                        value={pred.lag_hours ?? 0}
                        onChange={e => updatePredecessor(idx, 'lag_hours', parseFloat(e.target.value) || 0)}
                        className="h-8 text-xs text-center"
                      />
                    </div>

                    {/* Elapsed toggle */}
                    <button
                      type="button"
                      title="Elapsed lag bypasses the working calendar (24/7 hours)"
                      onClick={() => updatePredecessor(idx, 'is_elapsed', !pred.is_elapsed)}
                      className={`flex-shrink-0 text-[10px] px-2 py-1 rounded border transition-colors ${
                        pred.is_elapsed
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {pred.is_elapsed ? 'Elapsed' : 'Working'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <SheetFooter className="mt-6 flex justify-between">
          <Button variant="destructive" onClick={() => deleteMutation.mutate()} className="gap-1" disabled={deleteMutation.isPending}>
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending || !!cycleError}>
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}