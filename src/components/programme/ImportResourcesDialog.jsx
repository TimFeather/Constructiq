import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { assignableMembers, memberOptionLabel, needsReview } from '@/lib/scheduleImportResources';

const STATUS = {
  saved: { label: 'Saved', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
  exact: { label: 'Matched', className: 'bg-green-500/10 text-green-700 dark:text-green-400' },
  trade: { label: 'Matched by trade', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  ambiguous: { label: 'Several matches', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  unmatched: { label: 'No match', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-400' },
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Select values are strings: 'label', 'ignore' or 'member:<email>'
const encode = (choice) => (choice.action === 'member' ? `member:${choice.email}` : choice.action);
const decode = (value) => (value.startsWith('member:') ? { action: 'member', email: value.slice(7) } : { action: value });

function ResourceRow({ match, value, onChange, members }) {
  const { resource, status, candidates } = match;
  const suggested = new Set(candidates.map(c => c.user_email));
  const others = members.filter(m => !suggested.has(m.user_email));

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-words">{resource.name}</span>
          <Badge variant="secondary" className={cn('text-[10px] font-medium', STATUS[status].className)}>
            {STATUS[status].label}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground break-words">
          {plural(resource.taskCount, 'task')}
          {resource.group ? ` · ${resource.group}` : ''}
          {resource.email ? ` · ${resource.email}` : ''}
        </div>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-full sm:w-64 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {candidates.length > 0 && (
            <SelectGroup>
              <SelectLabel>Suggested</SelectLabel>
              {candidates.map(m => (
                <SelectItem key={m.user_email} value={`member:${m.user_email}`}>{memberOptionLabel(m)}</SelectItem>
              ))}
            </SelectGroup>
          )}
          {others.length > 0 && (
            <SelectGroup>
              <SelectLabel>Project team</SelectLabel>
              {others.map(m => (
                <SelectItem key={m.user_email} value={`member:${m.user_email}`}>{memberOptionLabel(m)}</SelectItem>
              ))}
            </SelectGroup>
          )}
          {members.length > 0 && <SelectSeparator />}
          <SelectItem value="label">Name only: {resource.name}</SelectItem>
          <SelectItem value="ignore">Ignore</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Import step: decide who each MS Project resource is in CIQ. Rows that
 * matched exactly (or were saved from an earlier import) start collapsed;
 * trade matches, ambiguous and unmatched rows are listed open.
 *
 * @param {{ matches: Array, team: Array, onConfirm: (choices: Map<number, Object>) => void }} props
 *   matches - matchResources() output; onConfirm gets resource UID → choice
 */
export default function ImportResourcesDialog({ open, matches, team, fileName, onConfirm, onCancel }) {
  const members = useMemo(() => assignableMembers(team), [team]);
  const [values, setValues] = useState({});
  const [showMatched, setShowMatched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries((matches || []).map(m => [m.resource.uid, encode(m.choice)])));
    setShowMatched(false);
  }, [open, matches]);

  const all = matches || [];
  const review = all.filter(needsReview);
  const matched = all.filter(m => !needsReview(m));
  const valueOf = (m) => values[m.resource.uid] ?? encode(m.choice);
  const setValue = (uid) => (value) => setValues(prev => ({ ...prev, [uid]: value }));

  const handleConfirm = () => {
    onConfirm(new Map(all.map(m => [m.resource.uid, decode(valueOf(m))])));
  };

  const row = (m) => (
    <ResourceRow key={m.resource.uid} match={m} value={valueOf(m)} onChange={setValue(m.resource.uid)} members={members} />
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel?.(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Match MS Project resources</DialogTitle>
          <DialogDescription>
            {fileName ? <span className="font-medium text-foreground">{fileName}</span> : null}
            {fileName ? ' — ' : ''}
            {plural(all.length, 'resource')} assigned to tasks · {review.length} to check
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Link each resource to a project team member to put their name on those tasks and show them under
          &ldquo;My tasks&rdquo; in Look Ahead. &ldquo;Name only&rdquo; keeps the resource name with no CIQ user.
          Your choices are remembered for this programme.
        </p>

        {members.length === 0 && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>
              No one on this project&rsquo;s team has an email yet, so resources can only come in by name. Add
              subcontractors on the project&rsquo;s Subcontractors tab, then re-import to link them.
            </span>
          </div>
        )}

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-1.5">
            {review.map(row)}

            {matched.length > 0 && (
              <div className={cn(review.length > 0 && 'pt-2')}>
                <button
                  type="button"
                  onClick={() => setShowMatched(s => !s)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {showMatched ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {matched.length} matched automatically
                </button>
                {showMatched && <div className="mt-1.5 space-y-1.5">{matched.map(row)}</div>}
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel import</Button>
          <Button onClick={handleConfirm}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
