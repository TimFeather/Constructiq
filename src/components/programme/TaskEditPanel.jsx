import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Trash2, ChevronUp, ChevronDown } from 'lucide-react';

export default function TaskEditPanel({ task, tasks = [], open, onOpenChange }) {
  const [form, setForm] = useState({});
  const queryClient = useQueryClient();

  useEffect(() => {
    if (task) setForm({ ...task });
  }, [task]);

  const updateMutation = useMutation({
    mutationFn: (data) => base44.entities.Task.update(task.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => base44.entities.Task.delete(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onOpenChange(false);
    }
  });

  const handleSave = () => {
    const { id, created_date, updated_date, created_by, ...data } = form;
    updateMutation.mutate(data);
  };

  const adjustDuration = (delta) => {
    const newDuration = Math.max(1, (form.duration || 1) + delta);
    setForm({ ...form, duration: newDuration });
  };

  if (!task) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Task</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label>Task Name</Label>
            <Input value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} />
          </div>
          <div>
            <Label>WBS Number</Label>
            <Input value={form.wbs || ''} onChange={e => setForm({...form, wbs: e.target.value})} />
          </div>
          <div>
            <Label>Level</Label>
            <Select value={String(form.level || 0)} onValueChange={v => setForm({...form, level: parseInt(v)})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Phase</SelectItem>
                <SelectItem value="1">Summary Task</SelectItem>
                <SelectItem value="2">Task</SelectItem>
                <SelectItem value="3">Subtask</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Parent Task</Label>
            <Select value={form.parent_id || 'none'} onValueChange={v => setForm({...form, parent_id: v === 'none' ? '' : v})}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (Root)</SelectItem>
                {tasks.filter(t => t.id !== task.id).map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.wbs} {t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={form.start_date || ''} onChange={e => setForm({...form, start_date: e.target.value})} />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" value={form.end_date || ''} onChange={e => setForm({...form, end_date: e.target.value})} />
            </div>
          </div>
          <div>
            <Label>Duration (days)</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => adjustDuration(-1)}>
                <ChevronDown className="w-4 h-4" />
              </Button>
              <Input
                type="number"
                min="1"
                value={form.duration || ''}
                onChange={e => setForm({...form, duration: parseInt(e.target.value) || 0})}
                className="text-center"
              />
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => adjustDuration(1)}>
                <ChevronUp className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div>
            <Label>% Complete: {form.percent_complete || 0}%</Label>
            <Slider
              value={[form.percent_complete || 0]}
              onValueChange={([v]) => setForm({...form, percent_complete: v})}
              max={100}
              step={5}
              className="mt-2"
            />
          </div>
          <div>
            <Label>Assignee Name</Label>
            <Input value={form.assignee_name || ''} onChange={e => setForm({...form, assignee_name: e.target.value})} />
          </div>
          <div>
            <Label>Assignee Email</Label>
            <Input value={form.assignee_email || ''} onChange={e => setForm({...form, assignee_email: e.target.value})} />
          </div>
        </div>
        <SheetFooter className="mt-6 flex justify-between">
          <Button variant="destructive" onClick={() => deleteMutation.mutate()} className="gap-1">
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}