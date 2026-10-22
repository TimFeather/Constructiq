import React from 'react';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';

const asDate = (d) => new Date(`${d}T00:00:00`);

function formatRange(start, end) {
  if (start === end) return format(asDate(start), 'EEE d MMM yyyy');
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${format(asDate(start), sameYear ? 'EEE d MMM' : 'EEE d MMM yyyy')} – ${format(asDate(end), 'EEE d MMM yyyy')}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Explains where the imported file's MS Project calendar disagrees with the
 * CIQ calendar, and how far that moves the imported dates.
 *
 * @param {{ warning: Object|null }} props - compareImportCalendar() result
 */
export default function ImportCalendarWarning({ warning }) {
  if (!warning) return null;
  const { ranges, weekPatternDays, tasksShifted, taskCount, ciqFinish, mspFinish, finishShiftDays } = warning;

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
        CIQ schedules with NZ public holidays and this programme&rsquo;s shutdowns, not the calendar saved in the file.
        They disagree on:
      </p>
      <ul className="space-y-1 mb-2">
        {ranges.map(r => (
          <li key={r.start} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{formatRange(r.start, r.end)}</span>
            <span>
              {r.mspWorking
                ? `MS Project works · CIQ: ${r.reason}`
                : `MS Project: ${r.reason} · CIQ works`}
              {r.days > 1 ? ` (${plural(r.days, 'day')})` : ''}
            </span>
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
        To line them up, add CIQ&rsquo;s holidays to the MS Project calendar, or add MS Project&rsquo;s shutdowns
        to this programme&rsquo;s schedule settings.
      </p>
    </div>
  );
}
