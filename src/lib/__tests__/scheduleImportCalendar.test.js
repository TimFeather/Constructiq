// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseXML } from '../scheduleImportParsers.js';
import { parseMspdiCalendar, compareImportCalendar } from '../scheduleImportCalendar.js';
import { calendarForProgramme } from '../scheduling/scheduleEngine.js';
import { getNzHolidayNames, getNzHolidays } from '../scheduling/nzHolidays.js';

// Shaped like the Kainga Ora template calendar: Christmas shutdown 22 Dec – 3 Jan,
// but Mon 4 Jan 2027 (Day after New Year's, observed) left as a working day.
const xml = (tasks) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <CalendarUID>1</CalendarUID>
  <Calendars>
    <Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID>
      <WeekDays>
        <WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>
        <WeekDay><DayType>2</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>3</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>4</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>5</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>6</DayType><DayWorking>1</DayWorking></WeekDay>
        <WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay>
        <WeekDay><DayType>0</DayType><DayWorking>0</DayWorking>
          <TimePeriod><FromDate>2026-12-22T00:00:00</FromDate><ToDate>2027-01-03T23:59:00</ToDate></TimePeriod>
        </WeekDay>
      </WeekDays>
      <Exceptions>
        <Exception><Name>Christmas Shut-down Period</Name><Type>1</Type><DayWorking>0</DayWorking>
          <TimePeriod><FromDate>2026-12-22T00:00:00</FromDate><ToDate>2027-01-03T23:59:00</ToDate></TimePeriod>
        </Exception>
        <Exception><Name>Recurring</Name><Type>6</Type><DayWorking>0</DayWorking>
          <TimePeriod><FromDate>2026-01-01T00:00:00</FromDate><ToDate>2030-01-01T23:59:00</ToDate></TimePeriod>
        </Exception>
      </Exceptions>
    </Calendar>
  </Calendars>
  <Tasks>${tasks}</Tasks>
</Project>`;

const task = (uid, name, start, finish, hours, pred) => `
    <Task><UID>${uid}</UID><ID>${uid}</ID><Name>${name}</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary>
      <Start>${start}T08:00:00</Start><Finish>${finish}T17:00:00</Finish><Duration>PT${hours}H0M0S</Duration>
      ${pred ? `<PredecessorLink><PredecessorUID>${pred}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>` : ''}
    </Task>`;

// Frame 21 Dec, then (after the shutdown) MS Project resumes Mon 4 Jan
const OVER_NEW_YEAR = xml(
  task(1, 'Frame', '2026-12-21', '2026-12-21', 8)
  + task(2, 'Clad', '2027-01-04', '2027-01-05', 16, 1)
  + task(3, 'Paint', '2027-01-06', '2027-01-06', 8, 2),
);
const IN_NOVEMBER = xml(
  task(1, 'Frame', '2026-11-09', '2026-11-09', 8)
  + task(2, 'Clad', '2026-11-10', '2026-11-11', 16, 1),
);
const WITH_SHUTDOWN = { calendar: { shutdowns: [{ start: '2026-12-22', end: '2027-01-03' }] } };

function check(text, programme) {
  const parsed = parseXML(text, 'p1');
  return compareImportCalendar(parsed, parseMspdiCalendar(text), calendarForProgramme(programme, parsed));
}

describe('parseMspdiCalendar', () => {
  const cal = parseMspdiCalendar(OVER_NEW_YEAR);

  it('reads the working week and expands daily exceptions with their names', () => {
    expect(cal.weekdays).toEqual([false, true, true, true, true, true, false]);
    expect(cal.exceptions.get('2026-12-22')).toEqual({ working: false, name: 'Christmas Shut-down Period' });
    expect(cal.exceptions.get('2027-01-03')?.working).toBe(false);
    expect(cal.exceptions.has('2027-01-04')).toBe(false);
  });

  it('ignores the first→last span of a recurring exception', () => {
    expect(cal.exceptions.has('2026-06-01')).toBe(false);
  });
});

describe('compareImportCalendar', () => {
  it('flags MS Project working the observed Day after New Year and measures the slip', () => {
    const w = check(OVER_NEW_YEAR, WITH_SHUTDOWN);
    expect(w.ranges).toEqual([
      { start: '2027-01-04', end: '2027-01-04', days: 1, mspWorking: true, reason: "Day after New Year's Day (observed)" },
    ]);
    expect(w.tasksShifted).toBe(2);
    expect(w.taskCount).toBe(3);
    expect(w.mspFinish).toBe('2027-01-06');
    expect(w.ciqFinish).toBe('2027-01-07');
    expect(w.finishShiftDays).toBe(1);
  });

  it("lists MS Project's shutdown as one range when CIQ has none configured", () => {
    const w = check(OVER_NEW_YEAR, null);
    // 25–28 Dec and 1–3 Jan are off in both calendars, so the run is bridged
    expect(w.ranges[0]).toEqual({
      start: '2026-12-22', end: '2026-12-31', days: 6, mspWorking: false, reason: 'Christmas Shut-down Period',
    });
    expect(w.finishShiftDays).toBeLessThan(0); // CIQ works through the shutdown → finishes earlier
  });

  it('returns null when no task is affected', () => {
    expect(check(IN_NOVEMBER, null)).toBeNull();
  });
});

describe('getNzHolidayNames', () => {
  const names = getNzHolidayNames(2026, 2027);

  it('names holidays and marks mondayised ones as observed', () => {
    expect(names.get('2027-01-04')).toBe("Day after New Year's Day (observed)");
    expect(names.get('2027-01-01')).toBe("New Year's Day");
    expect(names.get('2026-12-28')).toBe('Boxing Day (observed)');
    expect(names.get('2026-10-23')).toBe("Hawke's Bay Anniversary Day");
    expect(names.get('2026-10-26')).toBe('Labour Day');
  });

  it('covers exactly the dates getNzHolidays returns', () => {
    expect([...names.keys()].sort()).toEqual([...getNzHolidays(2026), ...getNzHolidays(2027)].sort());
  });
});
