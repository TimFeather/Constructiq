import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { saveTaskAssignees } from '@/api/programmeData';
import { memberDisplayName } from '@/lib/scheduleImportResources';
import { buildAssigneeChanges, defaultPicks, pickKey, proposeSubAssignments, subLabel } from '@/lib/programme/subTaskMatch';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function TaskLine({ task, checked = false, onCheckedChange = undefined }) {
  return (
    <label className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${onCheckedChange ? 'cursor-pointer hover:bg-muted/50' : ''}`}>
      {onCheckedChange && <Checkbox checked={checked} onCheckedChange={onCheckedChange} className="mt-0.5" />}
      {task.wbs && <span className="w-10 flex-shrink-0 text-muted-foreground tabular-nums">{task.wbs}</span>}
      <span className="min-w-0 flex-1 break-words">
        {task.name}
        {task.via && <span className="text-muted-foreground"> · under &ldquo;{task.via}&rdquo;</span>}
      </span>
    </label>
  );
}

function SubGroup({ sub, tasks, picks, setPicks }) {
  const [open, setOpen] = useState(sub.shared);
  const keys = sub.taskIds.map(id => pickKey(sub.id, id));
  const ticked = keys.filter(k => picks.has(k)).length;
  const all = ticked === keys.length;

  const toggle = (k, on) => setPicks(prev => {
    const next = new Set(prev);
    if (on) next.add(k); else next.delete(k);
    return next;
  });
  const toggleAll = (on) => setPicks(prev => {
    const next = new Set(prev);
    for (const k of keys) { if (on) next.add(k); else next.delete(k); }
    return next;
  });

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 px-3 py-2">
        <Checkbox
          checked={all ? true : ticked ? 'indeterminate' : false}
          onCheckedChange={(v) => toggleAll(v === true)}
          aria-label={`All tasks for ${sub.name}`}
        />
        <button type="button" onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
          <span className="min-w-0 truncate text-sm font-medium" title={subLabel(sub)}>{subLabel(sub)}</span>
        </button>
        {sub.draft && (
          <Badge variant="secondary" className="hidden sm:inline-flex text-[10px] font-medium" title="Goes on by name; linked to them when their invite is sent">
            Not invited yet
          </Badge>
        )}
        <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">{ticked}/{keys.length}</span>
      </div>
      {sub.shared && (
        <p className="mx-3 mb-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300">
          Another company has the same trade, so nothing is ticked — tick the tasks this one does.
        </p>
      )}
      {open && (
        <div className="border-t px-1 py-1">
          {sub.taskIds.map(id => {
            const k = pickKey(sub.id, id);
            return <TaskLine key={id} task={tasks.get(id)} checked={picks.has(k)} onCheckedChange={(v) => toggle(k, v === true)} />;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Put the project's subcontractors on unassigned programme tasks by trade
 * (see lib/programme/subTaskMatch). Lists each sub with the tasks their trade
 * matched, ticked unless another sub shares the trade; Assign writes the
 * ticked ones. Mount it only while open: the suggestion is worked out once,
 * so a background refetch can't reset the user's ticks.
 *
 * @param {{ projectId: string, team: Array, tasks: Array, userId?: string, onClose: () => void }} props
 *   tasks need id, name, wbs, parent_id, sort_order and assignees
 */
export default function AssignSubsDialog({ projectId, team, tasks, userId = null, onClose }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [proposal] = useState(() => proposeSubAssignments(tasks, team));
  const [picks, setPicks] = useState(() => defaultPicks(proposal));
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [saving, setSaving] = useState(false);

  const withTasks = proposal.subs.filter(s => s.taskIds.length);
  const withoutTasks = proposal.subs.filter(s => !s.taskIds.length);
  const matchedCount = proposal.candidateCount - proposal.unmatchedIds.length;
  const taskCount = new Set([...picks].map(k => k.split('\n')[1])).size;

  const assign = async () => {
    const changes = buildAssigneeChanges(tasks, proposal, picks);
    setSaving(true);
    try {
      await saveTaskAssignees(projectId, changes, userId);
      toast({
        title: `${plural(changes.length, 'task')} assigned`,
        description: 'Invited subs now see them under My Tasks.',
      });
      onClose();
    } catch (e) {
      toast({
        title: 'Some tasks weren’t assigned',
        description: `${e?.message || 'Save failed'}. Open Assign Subs again to finish — tasks already done won’t be listed.`,
        variant: 'destructive',
        duration: 10000,
      });
      setSaving(false);
    } finally {
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['taskAssignees', projectId] });
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Assign subs to tasks</DialogTitle>
          <DialogDescription>
            {plural(proposal.candidateCount, 'task')} with nobody assigned · {matchedCount} match a sub&rsquo;s trade
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Each sub&rsquo;s trade is looked for in the task name, then in the group the task sits under. Untick
          anything that&rsquo;s wrong; you can change any task later in its editor. Tasks that already have
          someone assigned aren&rsquo;t touched, and inspections and sign-offs are left for you.
        </p>

        {proposal.noTradeSubs.length > 0 && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-600" />
            <span>
              No trade set for {proposal.noTradeSubs.map(memberDisplayName).join(', ')}, so they can&rsquo;t be
              matched. Set their trade on the project&rsquo;s Subcontractors tab.
            </span>
          </div>
        )}

        <ScrollArea className="max-h-[50vh] pr-3">
          <div className="space-y-1.5">
            {withTasks.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {proposal.candidateCount === 0
                  ? 'Every task already has someone assigned.'
                  : 'No unassigned task names a trade one of these subs covers.'}
              </p>
            )}
            {withTasks.map(sub => (
              <SubGroup key={sub.id} sub={sub} tasks={proposal.tasks} picks={picks} setPicks={setPicks} />
            ))}

            {withoutTasks.length > 0 && (
              <p className="px-1 pt-1 text-xs text-muted-foreground">
                No matching tasks: {withoutTasks.map(s => `${s.name} (${s.trade})`).join(', ')}
              </p>
            )}

            {proposal.unmatchedIds.length > 0 && (
              <div className="pt-2">
                <button type="button" onClick={() => setShowUnmatched(s => !s)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                  {showUnmatched ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {plural(proposal.unmatchedIds.length, 'task')} not matched to a sub
                </button>
                {showUnmatched && (
                  <div className="mt-1">
                    {proposal.unmatchedIds.map(id => <TaskLine key={id} task={proposal.tasks.get(id)} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={assign} disabled={saving || taskCount === 0} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Assigning…' : `Assign ${plural(taskCount, 'task')}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
