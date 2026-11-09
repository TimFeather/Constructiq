import React from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const asDate = (d) => new Date(`${d}T00:00:00`);

function formatRange(start, end) {
  if (start === end) return format(asDate(start), 'EEE d MMM yyyy');
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${format(asDate(start), sameYear ? 'EEE d MMM' : 'EEE d MMM yyyy')} – ${format(asDate(end), 'EEE d MMM yyyy')}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const SCOPE_LABEL = { company: 'All programmes', programme: 'This programme' };

/**
 * Explains where the imported file's MS Project calendar disagrees with the
 * CIQ calendar, and how far that moves the imported dates.
 *
 * @param {{
 *   warning: Object|null,                       // compareImportCalendar() result
 *   shutdownScopes?: Array<'company'|'programme'>, // where this user may add a close-down
 *   onAddShutdown?: (range, scope) => void,     // copy one of the file's close-downs into CIQ's shutdowns
 *   addingShutdown?: boolean,
 * }} props
 */
export default function ImportCalendarWarning({ warning, shutdownScopes = [], onAddShutdown, addingShutdown = false }) {
  if (!warning) return null;
  const { ranges, weekPatternDays, tasksShifted, taskCount, ciqFinish, mspFinish, finishShiftDays } = warning;
  const scopes = onAddShutdown ? shutdownScopes : [];
  const canAdd = scopes.length > 0 && ranges.some(r => r.shutdown);

  let finishLine = null;
  if (finishShiftDays) {
    const direction = finishShiftDays > 0 ? 'later' : 'earlier';
    finishLine = `Finish: ${format(asDate(ciqFinish), 'EEE d MMM yyyy')} in CIQ vs ${format(asDate(mspFinish), 'EEE d MMM yyyy')} in MS Project — ${plural(Math.abs(finishShiftDays), 'working day')} ${direction}.`;
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
      <div className="flex items-center gap-2 font-semibold text-sm mb-1.5">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
        MS Project calendar differs from CIQ
      </div>
      <p className="mb-2">
        CIQ schedules with NZ public holidays and the shutdowns in its schedule settings, not the calendar saved in the file.
        They disagree on:
      </p>
      <ul className="space-y-1 mb-2">
        {ranges.map(r => (
          <li key={r.start} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{formatRange(r.start, r.end)}</span>
            <span>
              {r.mspWorking
                ? `MS Project works · CIQ: ${r.reason}`
                : `MS Project: ${r.reason} · CIQ works`}
              {r.days > 1 ? ` (${plural(r.days, 'day')})` : ''}
            </span>
            {r.shutdown && scopes.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                <span className="text-amber-800/80 dark:text-amber-200/80">Add as shutdown:</span>
                {scopes.map(scope => (
                  <Button
                    key={scope}
                    type="button" variant="outline" size="sm"
                    className="h-6 px-2 text-[11px] gap-1 border-amber-500/50 bg-transparent hover:bg-amber-500/15"
                    disabled={addingShutdown}
                    onClick={() => onAddShutdown(r, scope)}
                    title={`Adds ${formatRange(r.shutdown.start, r.shutdown.end)} to ${scope === 'company' ? 'every programme' : 'this programme'}'s shutdown periods`}
                  >
                    <Plus className="w-3 h-3" /> {SCOPE_LABEL[scope]}
                  </Button>
                ))}
              </span>
            )}
          </li>
        ))}
        {weekPatternDays > 0 && (
          <li>{plural(weekPatternDays, 'day')} where MS Project&rsquo;s working week differs from CIQ&rsquo;s</li>
        )}
      </ul>
      <p className="font-medium">
        {tasksShifted} of {taskCount} tasks land on different dates than in MS Project.
        {finishLine ? ` ${finishLine}` : ''}
      </p>
      <p className="mt-1.5 text-amber-800/80 dark:text-amber-200/80">
        {canAdd
          ? <>
              Use <span className="font-medium">Add as shutdown</span> to copy MS Project&rsquo;s close-downs into the
              schedule settings{scopes.includes('company') ? <> &mdash; for every programme, or just this one</> : null}.
              {ranges.some(r => !r.shutdown) || weekPatternDays > 0 ? ' The other differences need the MS Project calendar changed.' : ''}
            </>
          : <>To line them up, add CIQ&rsquo;s holidays to the MS Project calendar, or add MS Project&rsquo;s shutdowns to this programme&rsquo;s schedule settings.</>}
      </p>
    </div>
  );
}
