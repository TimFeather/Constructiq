import React from 'react';
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
import { cn } from '@/lib/utils';

const EM_DASH = '—';

const FIELD_LABELS = {
  start_date: 'Start',
  end_date: 'Finish',
  duration: 'Duration (days)',
  percent_complete: '% complete',
  predecessors: 'Dependencies',
  constraint_data: 'Constraint',
  parent: 'Parent task',
  wbs: 'WBS',
  name: 'Name',
};

function humanizeField(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return EM_DASH;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function SectionHeading({ children, count, colorClass }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className={cn('text-sm font-semibold', colorClass)}>{children}</h3>
      <Badge variant="secondary" className="text-xs">{count}</Badge>
    </div>
  );
}

function AddedTaskRow({ task }) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-muted-foreground">{formatValue(task.wbs)}</span>
        <span className="font-medium">{formatValue(task.name)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        <span>Start: {formatValue(task.start_date)}</span>
        <span>Finish: {formatValue(task.end_date)}</span>
        <span>Duration: {formatValue(task.duration)}</span>
      </div>
    </div>
  );
}

function ChangedTaskRow({ item }) {
  const name = item.incoming?.name ?? item.existing?.name;
  const wbs = item.incoming?.wbs ?? item.existing?.wbs;
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 mb-1.5">
        <span className="font-mono text-xs text-muted-foreground">{formatValue(wbs)}</span>
        <span className="font-medium">{formatValue(name)}</span>
      </div>
      <div className="space-y-1">
        {item.fieldDiffs.map((fd, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground min-w-[7rem] shrink-0">{humanizeField(fd.field)}:</span>
            <span className="text-muted-foreground line-through">{formatValue(fd.from)}</span>
            <span className="text-muted-foreground">&rarr;</span>
            <span className="font-medium text-amber-700 dark:text-amber-400">{formatValue(fd.to)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MissingTaskRow({ task }) {
  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-xs text-muted-foreground">{formatValue(task.wbs)}</span>
        <span className="font-medium">{formatValue(task.name)}</span>
      </div>
    </div>
  );
}

export default function ImportDiffDialog({ open, onOpenChange, diff, onConfirm, onCancel, fileName }) {
  const added = diff?.added || [];
  const changed = diff?.changed || [];
  const missing = diff?.missing || [];
  const unmatchedExisting = diff?.unmatchedExisting || [];
  const unchangedCount = diff?.unchangedCount || 0;

  const hasNoChanges = added.length === 0 && changed.length === 0;

  const summary = `${added.length} new · ${changed.length} changed · ${missing.length} missing from file · ${unchangedCount} unchanged`;

  const handleOpenChange = (next) => {
    if (!next) onCancel?.();
    onOpenChange?.(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review import update</DialogTitle>
          <DialogDescription>
            {fileName ? <span className="font-medium text-foreground">{fileName}</span> : null}
            {fileName ? ' — ' : ''}
            {summary}
          </DialogDescription>
        </DialogHeader>

        {hasNoChanges ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No changes detected &mdash; the file matches the current programme.
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-5">
              {added.length > 0 && (
                <section>
                  <SectionHeading count={added.length} colorClass="text-green-600 dark:text-green-400">
                    New tasks
                  </SectionHeading>
                  <div className="space-y-1.5">
                    {added.map((task, i) => (
                      <AddedTaskRow key={task.mspdi_uid ?? task.wbs ?? i} task={task} />
                    ))}
                  </div>
                </section>
              )}

              {changed.length > 0 && (
                <section>
                  <SectionHeading count={changed.length} colorClass="text-amber-600 dark:text-amber-400">
                    Changed tasks
                  </SectionHeading>
                  <div className="space-y-1.5">
                    {changed.map((item, i) => (
                      <ChangedTaskRow key={item.existing?.id ?? i} item={item} />
                    ))}
                  </div>
                </section>
              )}

              {missing.length > 0 && (
                <section>
                  <SectionHeading count={missing.length} colorClass="text-slate-600 dark:text-slate-400">
                    Missing from file
                  </SectionHeading>
                  <p className="text-xs text-muted-foreground mb-2">
                    These tasks exist in ConstructIQ but are not in the imported file. They will be KEPT and
                    flagged &mdash; nothing is deleted by an import.
                  </p>
                  <div className="space-y-1.5">
                    {missing.map((task, i) => (
                      <MissingTaskRow key={task.id ?? i} task={task} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        )}

        {unmatchedExisting.length > 0 && (
          <p className="text-xs text-muted-foreground border-t pt-2">
            {unmatchedExisting.length} existing task{unmatchedExisting.length !== 1 ? 's' : ''} have no MS Project ID
            and can't be matched; they will be left untouched.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          {hasNoChanges ? (
            <Button onClick={onCancel}>Close</Button>
          ) : (
            <Button onClick={onConfirm}>Apply update</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
