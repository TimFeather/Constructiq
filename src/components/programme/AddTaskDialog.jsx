/**
 * Native task creation — build a programme without MS Project.
 * Creates the task, then (optionally) links a predecessor through the
 * scheduling service so the engine places it straight away.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { createTaskInline } from '@/lib/programme/createTask';
import { taskPathLabel, inOutlineOrder } from '@/lib/programme/taskPath';

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

// Every search word must appear somewhere in the option's WBS, name or path.
const matchAllWords = (_value, search, keywords) => {
  const haystack = (keywords || []).join(' ').toLowerCase();
  return search.toLowerCase().split(/\s+/).filter(Boolean).every(w => haystack.includes(w)) ? 1 : 0;
};

function OptionLabel({ option }) {
  return (
    <span className="min-w-0">
      <span className="block truncate">{option.wbs ? `${option.wbs} ` : ''}{option.name}</span>
      {option.path && <span className="block truncate text-[11px] text-muted-foreground">{option.path}</span>}
    </span>
  );
}

/**
 * Searchable task picker. Each option shows the groups it sits under, because
 * imported programmes repeat names ("UNITS 6 & 7") under different parents.
 * options: [{ id, wbs, name, path }]
 */
function TaskPicker({ value, onChange, options, noneLabel, placeholder }) {
  const [open, setOpen] = useState(false);
  const selected = value !== NONE ? options.find(o => o.id === value) : null;
  const pick = (id) => { onChange(id); setOpen(false); };

  return (
    // modal: lets the list scroll with the wheel inside the dialog
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className="mt-1 w-full justify-between font-normal h-auto min-h-9 py-1.5 text-left">
          {selected ? <OptionLabel option={selected} /> : <span>{noneLabel}</span>}
          <ChevronsUpDown className="w-4 h-4 opacity-50 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0 w-[--radix-popover-trigger-width] min-w-[20rem]">
        <Command filter={matchAllWords}>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandItem value={NONE} keywords={[noneLabel]} onSelect={() => pick(NONE)}>
              <Check className={cn('w-4 h-4', value === NONE ? 'opacity-100' : 'opacity-0')} />
              {noneLabel}
            </CommandItem>
            {options.map(o => (
              <CommandItem key={o.id} value={o.id} keywords={[o.wbs || '', o.name || '', o.path]} onSelect={() => pick(o.id)}>
                <Check className={cn('w-4 h-4', value === o.id ? 'opacity-100' : 'opacity-0')} />
                <OptionLabel option={o} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * @param {() => object|null} [getAnchorTask] — the row selected in the task table
 *   when the dialog opens; the new task defaults to that row's group.
 * @param {(created: object) => void} [onCreated] — called with the new task
 *   (including its WBS number) so the page can reveal it.
 */
export default function AddTaskDialog({ open, onOpenChange, projectId, tasks, scheduleOptions, getAnchorTask, onCreated }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', duration: 5, start_date: '', is_milestone: false,
    parent_id: NONE, predecessor_id: NONE, dep_type: 'FS', lag_days: 0,
  });
  // The parent follows the selected row / the predecessor until the user picks one themselves
  const [parentTouched, setParentTouched] = useState(false);
  const [defaultParentId, setDefaultParentId] = useState(NONE);

  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const summaryIds = useMemo(() => new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id)), [tasks]);

  useEffect(() => {
    if (open) {
      // Default to the group of the row selected in the table: the row itself
      // if it is a group, otherwise the group it sits in.
      const anchor = getAnchorTask?.();
      const liveAnchor = anchor ? tasksById.get(anchor.id) : null;
      const anchorParent = !liveAnchor ? NONE
        : summaryIds.has(liveAnchor.id) ? liveAnchor.id
        : (liveAnchor.parent_id || NONE);
      setDefaultParentId(anchorParent);
      setParentTouched(false);
      setForm({
        name: '', duration: 5,
        start_date: scheduleOptions?.dataDate || todayStr(),
        is_milestone: false, parent_id: anchorParent, predecessor_id: NONE, dep_type: 'FS', lag_days: 0,
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const { parentOptions, predecessorOptions } = useMemo(() => {
    const toOption = (t) => ({ id: t.id, wbs: t.wbs, name: t.name, path: taskPathLabel(t, tasksById) });
    const outline = inOutlineOrder(tasks);
    return {
      parentOptions: outline.filter(t => summaryIds.has(t.id) || !t.parent_id).map(toOption),
      predecessorOptions: outline.filter(t => !summaryIds.has(t.id)).map(toOption),
    };
  }, [tasks, tasksById, summaryIds]);

  const handleParentChange = (id) => {
    setParentTouched(true);
    setForm(f => ({ ...f, parent_id: id }));
  };

  // Picking a predecessor moves the task into the predecessor's group (so it
  // lands directly below it) unless the user has chosen a parent themselves.
  const handlePredecessorChange = (id) => {
    setForm(f => {
      if (parentTouched) return { ...f, predecessor_id: id };
      const pred = id !== NONE ? tasksById.get(id) : null;
      return { ...f, predecessor_id: id, parent_id: pred ? (pred.parent_id || NONE) : defaultParentId };
    });
  };

  const predecessor = form.predecessor_id !== NONE ? tasksById.get(form.predecessor_id) : null;
  const parentId = form.parent_id === NONE ? null : form.parent_id;
  const predecessorInDifferentGroup = !!predecessor && (predecessor.parent_id || null) !== parentId;

  const handleCreate = async () => {
    if (!form.name.trim() || !projectId || projectId === 'all') return;
    setSaving(true);
    try {
      const created = await createTaskInline({
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
      const where = created ? taskPathLabel(created, tasksById) : '';
      toast({
        title: `Task added${created?.wbs ? ` as ${created.wbs}` : ''}`,
        description: where ? `${form.name.trim()} — under ${where}` : form.name.trim(),
        duration: 5000,
      });
      onOpenChange(false);
      if (created) onCreated?.(created);
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
              <Input type="number" min={0.25} step="any" value={form.duration} disabled={form.is_milestone}
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
            <TaskPicker
              value={form.parent_id}
              onChange={handleParentChange}
              options={parentOptions}
              noneLabel="None (top level)"
              placeholder="Search groups…"
            />
          </div>
          <div>
            <Label>Predecessor (optional)</Label>
            <TaskPicker
              value={form.predecessor_id}
              onChange={handlePredecessorChange}
              options={predecessorOptions}
              noneLabel="None"
              placeholder="Search tasks…"
            />
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
