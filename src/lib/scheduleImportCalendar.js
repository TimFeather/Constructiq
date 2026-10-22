/**
 * scheduleImportCalendar.js
 *
 * ConstructIQ schedules imported programmes on its own calendar (NZ public
 * holidays + programme shutdowns), not the calendar saved in the MS Project
 * file. Where the two disagree — e.g. MS Project works Mon 4 Jan 2027, the
 * observed Day after New Year's — imported dates drift from MS Project's.
 * This module finds those days and measures the drift so the import can warn
 * before committing.
 */

import { isWorkingDay, parseDate, toDateStr, countWorkingDays } from './scheduling/calendarEngine.js';
import { runScheduleEngine } from './scheduling/scheduleEngine.js';
import { getNzHolidayNames } from './scheduling/nzHolidays.js';

const DAY_MS = 86400000;
// CIQ calendar types → working weekdays (index 0 = Sunday)
const CIQ_WEEKS = {
  '5day': [false, true, true, true, true, true, false],
  '6day': [false, true, true, true, true, true, true],
  '7day': [true, true, true, true, true, true, true],
};

const directChild = (node, tag) => Array.from(node?.children || []).find(c => c.localName === tag);
const childText = (node, tag) => directChild(node, tag)?.textContent?.trim() ?? '';
const children = (node, tag) => Array.from(node?.children || []).filter(c => c.localName === tag);

/** Every yyyy-MM-dd from the date part of `from` to that of `to`, inclusive. */
function eachDate(from, to) {
  const out = [];
  const start = parseDate(String(from).slice(0, 10));
  const end = parseDate(String(to).slice(0, 10));
  if (!start || !end || isNaN(start) || isNaN(end) || end < start) return out;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(toDateStr(d));
  return out;
}

/**
 * Read the project calendar from MSPDI XML text.
 *
 * @returns {{ name: string, weekdays: boolean[], exceptions: Map<string, { working: boolean, name: string }> } | null}
 *   weekdays is indexed 0 = Sunday. null when the file carries no usable calendar.
 */
export function parseMspdiCalendar(text) {
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  const project = xml.documentElement;
  const calendars = children(directChild(project, 'Calendars'), 'Calendar');
  const byUid = new Map(calendars.map(c => [childText(c, 'UID'), c]));
  const own = byUid.get(childText(project, 'CalendarUID')) || calendars.find(c => childText(c, 'IsBaseCalendar') === '1');
  if (!own) return null;

  // Base calendar first, so the project calendar's own settings override it
  const chain = [];
  for (let c = own; c && !chain.includes(c); c = byUid.get(childText(c, 'BaseCalendarUID'))) chain.unshift(c);

  const weekdays = [false, true, true, true, true, true, false];
  const exceptions = new Map();
  for (const cal of chain) {
    for (const wd of children(directChild(cal, 'WeekDays'), 'WeekDay')) {
      const type = parseInt(childText(wd, 'DayType'), 10);
      const working = childText(wd, 'DayWorking') === '1';
      if (type >= 1 && type <= 7) {
        weekdays[type - 1] = working;
      } else if (type === 0) {
        // Pre-2007 exception format (MS Project still writes it, already expanded per occurrence)
        const period = directChild(wd, 'TimePeriod');
        for (const date of eachDate(childText(period, 'FromDate'), childText(period, 'ToDate'))) {
          exceptions.set(date, { working, name: '' });
        }
      }
    }
    for (const ex of children(directChild(cal, 'Exceptions'), 'Exception')) {
      // Only daily ranges: a recurring exception's period spans first→last occurrence,
      // and its individual days are covered by the legacy WeekDay entries above.
      const type = childText(ex, 'Type');
      if (type && type !== '1') continue;
      const period = directChild(ex, 'TimePeriod');
      const working = childText(ex, 'DayWorking') === '1';
      for (const date of eachDate(childText(period, 'FromDate'), childText(period, 'ToDate'))) {
        exceptions.set(date, { working, name: childText(ex, 'Name') });
      }
    }
  }

  return { name: childText(own, 'Name'), weekdays, exceptions };
}

/** Parsed import rows → the task shape the schedule engine runs on (ids = MS Project UIDs). */
export function parsedToEngineTasks(parsedTasks) {
  return parsedTasks.map(pt => ({
    id: String(pt.mspdi_uid),
    parent_id: pt._parentUid != null ? String(pt._parentUid) : null,
    start_date: pt.start_date,
    end_date: pt.end_date,
    duration: pt.duration,
    is_milestone: pt.is_milestone,
    percent_complete: pt.percent_complete,
    constraint: pt.constraint_data,
    predecessors: (pt._predecessorLinks || []).map(l => ({
      predecessor_id: String(l._predUid),
      type: l.type,
      lag_hours: l.lag_hours,
      is_elapsed: l.is_elapsed,
    })),
  }));
}

/** Why CIQ doesn't work a day: holiday name, shutdown or weekend. */
function ciqReason(date, calendar, holidayNames) {
  if (holidayNames.has(date)) return holidayNames.get(date);
  if ((calendar.shutdowns || []).some(s => date >= s.start && date <= s.end)) return 'Shutdown in programme settings';
  if ((calendar.holidays || []).includes(date)) return 'Holiday in programme settings';
  return 'Weekend in CIQ';
}

/**
 * Compare the MS Project file's calendar with the CIQ calendar over the
 * imported schedule's span, and measure how far CIQ's dates drift from the
 * file's because of it.
 *
 * @param {Array} parsedTasks - parseXML output (after manual-scheduling constraints)
 * @param {Object|null} mspCalendar - parseMspdiCalendar output
 * @param {Object} ciqCalendar - calendarForProgramme output
 * @param {{ region?: string, dataDate?: string|null }} [options]
 * @returns {null | {
 *   calendarName: string,
 *   ranges: Array<{ start, end, days, mspWorking, reason }>,
 *   weekPatternDays: number,
 *   tasksShifted: number,
 *   taskCount: number,
 *   ciqFinish: string, mspFinish: string,
 *   finishShiftDays: number,   // working days CIQ's finish is later (+) / earlier (−) than MS Project's
 * }}
 *   null when the calendars agree or the differences move no task.
 */
export function compareImportCalendar(parsedTasks, mspCalendar, ciqCalendar, options = {}) {
  if (!mspCalendar || !parsedTasks?.length) return null;

  const starts = parsedTasks.map(t => t.start_date).filter(Boolean).sort();
  const finishes = parsedTasks.map(t => t.end_date).filter(Boolean).sort();
  if (!starts.length || !finishes.length) return null;
  const span = eachDate(starts[0], finishes[finishes.length - 1]);

  const years = span.map(d => parseInt(d.slice(0, 4), 10));
  const holidayNames = getNzHolidayNames(Math.min(...years), Math.max(...years), { region: options.region || 'hawkes-bay' });
  const ciqWeek = CIQ_WEEKS[ciqCalendar.type] || CIQ_WEEKS['5day'];

  // Per-day disagreements. A day that differs only because the weekly patterns
  // differ (MS Project works Saturdays, say) is counted, not listed.
  const days = [];
  let weekPatternDays = 0;
  const mspNonWorking = [];
  const bothOff = new Set();
  for (const date of span) {
    const dow = parseDate(date).getDay();
    const exception = mspCalendar.exceptions.get(date);
    const mspWorking = exception ? exception.working : mspCalendar.weekdays[dow];
    if (!mspWorking) mspNonWorking.push(date);
    const ciqWorking = isWorkingDay(parseDate(date), ciqCalendar);
    if (!mspWorking && !ciqWorking) bothOff.add(date);
    if (mspWorking === ciqWorking) continue;

    const ciqOverride = ciqWorking !== ciqWeek[dow];
    if (!exception && !ciqOverride) { weekPatternDays += 1; continue; }
    days.push({
      date,
      mspWorking,
      reason: mspWorking
        ? ciqReason(date, ciqCalendar, holidayNames)
        : (exception?.name || 'Non-working in MS Project'),
    });
  }
  if (!days.length && !weekPatternDays) return null;

  // Group runs with the same direction and reason (e.g. a shutdown), bridging
  // days both calendars already treat as non-working (weekends, Christmas Day)
  const ranges = [];
  const bridges = (from, to) => {
    for (let d = new Date(parseDate(from).getTime() + DAY_MS * 1.5); toDateStr(d) < to; d.setDate(d.getDate() + 1)) {
      if (!bothOff.has(toDateStr(d))) return false;
    }
    return true;
  };
  for (const d of days) {
    const last = ranges[ranges.length - 1];
    if (last && last.mspWorking === d.mspWorking && last.reason === d.reason && bridges(last.end, d.date)) {
      last.end = d.date;
      last.days += 1;
    } else {
      ranges.push({ start: d.date, end: d.date, days: 1, mspWorking: d.mspWorking, reason: d.reason });
    }
  }

  // Schedule twice — CIQ's calendar vs one that follows the file — and compare.
  const mspWeekType = Object.keys(CIQ_WEEKS).find(k => CIQ_WEEKS[k].every((w, i) => w === mspCalendar.weekdays[i]));
  const fileCalendar = {
    type: mspWeekType || ciqCalendar.type,
    holidays: mspNonWorking.filter(d => (CIQ_WEEKS[mspWeekType || ciqCalendar.type] || ciqWeek)[parseDate(d).getDay()]),
    shutdowns: [],
  };
  const engineTasks = parsedToEngineTasks(parsedTasks);
  const engineOptions = { dataDate: options.dataDate || null };
  const ciqRun = runScheduleEngine(engineTasks, starts[0], ciqCalendar, engineOptions);
  const fileRun = runScheduleEngine(engineTasks, starts[0], fileCalendar, engineOptions);

  let tasksShifted = 0;
  let ciqFinish = null;
  let mspFinish = null;
  for (const pt of parsedTasks) {
    if (pt.is_summary) continue;
    const a = ciqRun.get(String(pt.mspdi_uid));
    const b = fileRun.get(String(pt.mspdi_uid));
    if (!a || !b) continue;
    if (a.startStr !== b.startStr || a.finishStr !== b.finishStr) tasksShifted += 1;
    if (!ciqFinish || a.finishStr > ciqFinish) ciqFinish = a.finishStr;
    if (!mspFinish || b.finishStr > mspFinish) mspFinish = b.finishStr;
  }
  if (!tasksShifted) return null;

  const finishShiftDays = ciqFinish === mspFinish ? 0
    : ciqFinish > mspFinish
      ? countWorkingDays(parseDate(mspFinish), parseDate(ciqFinish), ciqCalendar)
      : -countWorkingDays(parseDate(ciqFinish), parseDate(mspFinish), ciqCalendar);

  return {
    calendarName: mspCalendar.name,
    ranges,
    weekPatternDays,
    tasksShifted,
    taskCount: parsedTasks.filter(t => !t.is_summary).length,
    ciqFinish,
    mspFinish,
    finishShiftDays,
  };
}
