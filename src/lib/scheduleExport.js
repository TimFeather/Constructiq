/**
 * scheduleExport.js
 *
 * Exports a programme back out of ConstructIQ:
 *  - MSPDI XML (.xml) that Microsoft Project opens natively (File → Open)
 *  - Excel workbook for recipients without MS Project
 *
 * MSPDI specifics honoured here:
 *  - UID-0 project summary task emitted first
 *  - PredecessorLink Type codes 0=FF / 1=FS / 2=SF / 3=SS
 *  - Durations as ISO-8601 PT{h}H{m}M0S (8h working day)
 *  - LinkLag in tenths of a minute (1 working day = 4800)
 */

import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { DEP_TO_MSPDI_TYPE } from './scheduleImportParsers';

const CONSTRAINT_TO_CODE = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Depth-first traversal in sort_order: parents immediately before their
 * children — the sequential order MSPDI's OutlineLevel encoding requires.
 * Returns [{ task, outlineLevel }] with outlineLevel starting at 1.
 */
export function outlineOrder(tasks) {
  const byParent = new Map();
  for (const t of tasks) {
    const key = t.parent_id || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(t);
  }
  const ids = new Set(tasks.map(t => t.id));
  // Treat tasks whose parent isn't in the set as roots (defensive)
  const roots = tasks.filter(t => !t.parent_id || !ids.has(t.parent_id));
  byParent.set(null, roots);

  for (const list of byParent.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  const out = [];
  const walk = (task, level) => {
    out.push({ task, outlineLevel: level });
    for (const child of byParent.get(task.id) || []) walk(child, level + 1);
  };
  for (const root of byParent.get(null)) walk(root, 1);
  return out;
}

function durationToPT(durationDays) {
  const totalHours = Math.max(0, (durationDays || 0) * 8);
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);
  return `PT${hours}H${minutes}M0S`;
}

function dateTime(dateStr, endOfDay = false) {
  if (!dateStr) return null;
  return `${dateStr}T${endOfDay ? '17:00:00' : '08:00:00'}`;
}

/**
 * Build an MSPDI XML string for a programme.
 *
 * @param {Array}  tasks     - engine-shape tasks (predecessors attached)
 * @param {Object} programme - programmes row (calendar JSONB) or null
 * @param {Object} opts      - { projectName, holidays: ['yyyy-MM-dd'] }
 */
export function buildMspdiXml(tasks, programme, opts = {}) {
  const ordered = outlineOrder(tasks);

  // Assign UIDs: keep round-tripped mspdi_uid, synthesize for native tasks
  const usedUids = new Set(tasks.filter(t => t.mspdi_uid != null).map(t => Number(t.mspdi_uid)));
  let nextUid = usedUids.size ? Math.max(...usedUids) + 1 : 1;
  const idToUid = new Map();
  for (const { task } of ordered) {
    if (task.mspdi_uid != null && !idToUid.has(task.id)) {
      idToUid.set(task.id, Number(task.mspdi_uid));
    } else {
      while (usedUids.has(nextUid)) nextUid += 1;
      idToUid.set(task.id, nextUid);
      usedUids.add(nextUid);
    }
  }

  const childIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
  const starts = tasks.map(t => t.start_date).filter(Boolean).sort();
  const finishes = tasks.map(t => t.end_date).filter(Boolean).sort();
  const projectStart = starts[0] || null;
  const projectFinish = finishes[finishes.length - 1] || null;

  const holidays = (opts.holidays || programme?.calendar?.holidays || [])
    .filter(h => !projectStart || (h >= `${projectStart.slice(0, 4)}-01-01`))
    .slice(0, 200); // keep the file sane

  const calendarType = programme?.calendar?.type || '5day';
  const workingDow = calendarType === '7day' ? [1, 2, 3, 4, 5, 6, 7]
    : calendarType === '6day' ? [2, 3, 4, 5, 6, 7]
    : [2, 3, 4, 5, 6]; // MSPDI DayType: 1=Sunday … 7=Saturday

  const weekDaysXml = [1, 2, 3, 4, 5, 6, 7].map(dow => {
    if (!workingDow.includes(dow)) {
      return `        <WeekDay><DayType>${dow}</DayType><DayWorking>0</DayWorking></WeekDay>`;
    }
    return `        <WeekDay><DayType>${dow}</DayType><DayWorking>1</DayWorking>
          <WorkingTimes>
            <WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime>
            <WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime>
          </WorkingTimes>
        </WeekDay>`;
  }).join('\n');

  const exceptionsXml = holidays.map(h =>
    `        <WeekDay><DayType>0</DayType><DayWorking>0</DayWorking>
          <TimePeriod><FromDate>${h}T00:00:00</FromDate><ToDate>${h}T23:59:59</ToDate></TimePeriod>
        </WeekDay>`
  ).join('\n');

  const name = esc(opts.projectName || programme?.name || 'ConstructIQ Programme');

  const taskXml = [];

  // UID-0 project summary task — required first
  taskXml.push(`    <Task>
      <UID>0</UID><ID>0</ID>
      <Name>${name}</Name>
      <Type>1</Type><IsNull>0</IsNull>
      <OutlineNumber>0</OutlineNumber><OutlineLevel>0</OutlineLevel>
      ${projectStart ? `<Start>${dateTime(projectStart)}</Start>` : ''}
      ${projectFinish ? `<Finish>${dateTime(projectFinish, true)}</Finish>` : ''}
      <Summary>1</Summary><Milestone>0</Milestone>
    </Task>`);

  ordered.forEach(({ task, outlineLevel }, idx) => {
    const uid = idToUid.get(task.id);
    const isSummary = childIds.has(task.id);
    const isMilestone = task.is_milestone || task.duration === 0;
    const constraint = task.constraint_data || task.constraint || null;
    const constraintCode = CONSTRAINT_TO_CODE[constraint?.type] ?? 0;

    const predXml = (task.predecessors || [])
      .map(p => {
        const predUid = idToUid.get(p.predecessor_id || p.task_id);
        if (predUid == null) return null;
        const lagHours = p.lag_hours ?? (p.lag_days ?? 0) * 8;
        return `      <PredecessorLink>
        <PredecessorUID>${predUid}</PredecessorUID>
        <Type>${DEP_TO_MSPDI_TYPE[p.type] ?? 1}</Type>
        <CrossProject>0</CrossProject>
        <LinkLag>${Math.round(lagHours * 600)}</LinkLag>
        <LagFormat>7</LagFormat>
      </PredecessorLink>`;
      })
      .filter(Boolean)
      .join('\n');

    taskXml.push(`    <Task>
      <UID>${uid}</UID><ID>${idx + 1}</ID>
      <Name>${esc(task.name)}</Name>
      <Type>0</Type><IsNull>0</IsNull>
      ${task.wbs ? `<WBS>${esc(task.wbs)}</WBS>` : ''}
      <OutlineLevel>${outlineLevel}</OutlineLevel>
      <Priority>500</Priority>
      ${task.start_date ? `<Start>${dateTime(task.start_date)}</Start>` : ''}
      ${task.end_date ? `<Finish>${dateTime(task.end_date, true)}</Finish>` : ''}
      <Duration>${durationToPT(isMilestone ? 0 : task.duration)}</Duration>
      <DurationFormat>7</DurationFormat>
      <Milestone>${isMilestone ? 1 : 0}</Milestone>
      <Summary>${isSummary ? 1 : 0}</Summary>
      <PercentComplete>${Math.round(task.percent_complete || 0)}</PercentComplete>
      <ConstraintType>${constraintCode}</ConstraintType>
      ${constraint?.date ? `<ConstraintDate>${dateTime(constraint.date)}</ConstraintDate>` : ''}
      ${task.actual_start ? `<ActualStart>${dateTime(task.actual_start)}</ActualStart>` : ''}
      ${task.actual_finish ? `<ActualFinish>${dateTime(task.actual_finish, true)}</ActualFinish>` : ''}
${predXml}
    </Task>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${name}</Name>
  <Title>${name}</Title>
  ${projectStart ? `<StartDate>${dateTime(projectStart)}</StartDate>` : ''}
  ${projectFinish ? `<FinishDate>${dateTime(projectFinish, true)}</FinishDate>` : ''}
  <FYStartDate>1</FYStartDate>
  <CalendarUID>1</CalendarUID>
  <MinutesPerDay>480</MinutesPerDay>
  <MinutesPerWeek>2400</MinutesPerWeek>
  <DaysPerMonth>20</DaysPerMonth>
  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <WeekDays>
${weekDaysXml}
${exceptionsXml}
      </WeekDays>
    </Calendar>
  </Calendars>
  <Tasks>
${taskXml.join('\n')}
  </Tasks>
</Project>
`;
}

/** Human-readable dependency string like "12FS+2d" using export row IDs. */
export function predecessorLabel(preds, idToRowNum) {
  return (preds || [])
    .map(p => {
      const row = idToRowNum.get(p.predecessor_id || p.task_id);
      if (row == null) return null;
      const lagDays = p.lag_days ?? (p.lag_hours ?? 0) / 8;
      const lag = lagDays ? (lagDays > 0 ? `+${lagDays}d` : `${lagDays}d`) : '';
      return `${row}${p.type || 'FS'}${lag}`;
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Build an Excel workbook of the programme.
 *
 * @param {Array} tasks - engine-shape tasks
 * @param {Map}   scheduledMap - optional engine output for float/critical columns
 * @returns {XLSX.WorkBook}
 */
export function buildProgrammeWorkbook(tasks, scheduledMap = new Map()) {
  const ordered = outlineOrder(tasks);
  const childIds = new Set(tasks.filter(t => t.parent_id).map(t => t.parent_id));
  const idToRowNum = new Map(ordered.map(({ task }, i) => [task.id, i + 1]));

  const rows = ordered.map(({ task, outlineLevel }, i) => {
    const r = scheduledMap.get(task.id);
    const isMilestone = task.is_milestone || task.duration === 0;
    return {
      'ID': i + 1,
      'WBS': task.wbs || '',
      'Task name': `${'    '.repeat(Math.max(0, outlineLevel - 1))}${task.name}`,
      'Type': childIds.has(task.id) ? 'Summary' : (isMilestone ? 'Milestone' : 'Task'),
      'Start': task.start_date || '',
      'Finish': task.end_date || '',
      'Duration (days)': isMilestone ? 0 : (task.duration ?? ''),
      '% complete': task.percent_complete ?? 0,
      'Predecessors': predecessorLabel(task.predecessors, idToRowNum),
      'Total float (days)': r ? Math.round((r.totalFloat / 8) * 10) / 10 : '',
      'Critical': r ? (r.isCritical ? 'Yes' : 'No') : '',
      'Assigned to': task.assignee_name || task.assignee_email || '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 5 }, { wch: 10 }, { wch: 45 }, { wch: 10 }, { wch: 11 }, { wch: 11 },
    { wch: 14 }, { wch: 11 }, { wch: 18 }, { wch: 15 }, { wch: 8 }, { wch: 22 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Programme');
  return wb;
}

/** Download the programme as an MSPDI .xml file (opens in MS Project). */
export function downloadMspdi(tasks, programme, opts = {}) {
  const xml = buildMspdiXml(tasks, programme, opts);
  const fileName = `${(opts.projectName || 'programme').replace(/[^\w\- ]+/g, '')}.xml`;
  saveAs(new Blob([xml], { type: 'application/xml;charset=utf-8' }), fileName);
}

/** Download the programme as an Excel workbook. */
export function downloadProgrammeExcel(tasks, scheduledMap, projectName = 'programme') {
  const wb = buildProgrammeWorkbook(tasks, scheduledMap);
  XLSX.writeFile(wb, `${projectName.replace(/[^\w\- ]+/g, '')}.xlsx`);
}
