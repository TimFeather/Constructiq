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
 *  - Task assignees as work Resources + Assignments, each resource with its
 *    own calendar based on Standard (as MS Project writes them)
 */

import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { DEP_TO_MSPDI_TYPE } from './scheduleImportParsers';
import { assigneeNames, taskAssignees } from './programme/assignees';
import { assigneeKey } from './scheduleImportResources';

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

const initialsOf = (name) => String(name || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();

/**
 * Work resources for the tasks' assignees, and which resources each task has.
 *
 * An assignee imported from MS Project keeps its resource UID and, via the
 * programme's resource_map, the resource's original name, so MS Project
 * sees the same resources it exported. An assignee added in CIQ joins the
 * resource of the same person or name, or gets a new UID.
 *
 * @returns {{ resources: Array<{ uid, name, email }>, byTask: Map<taskId, Array<{ uid, units }>> }}
 */
export function exportResources(tasks, resourceMap = {}) {
  const resources = new Map(); // uid → { uid, name, email }
  const keyToUid = new Map();
  const byTask = new Map();

  const addToTask = (task, uid, units) => {
    if (!byTask.has(task.id)) byTask.set(task.id, []);
    const list = byTask.get(task.id);
    if (!list.some(r => r.uid === uid)) list.push({ uid, units: Number.isFinite(Number(units)) && Number(units) > 0 ? Number(units) : 1 });
  };

  // Pass 1: assignees that came from MS Project define their resources
  for (const task of tasks) {
    for (const a of taskAssignees(task)) {
      const uid = Number(a.msp_resource_uid);
      if (!Number.isInteger(uid) || uid <= 0) continue;
      if (!resources.has(uid)) {
        resources.set(uid, { uid, name: resourceMap?.[String(uid)]?.name || a.name, email: a.email || null });
      } else if (a.email && !resources.get(uid).email) {
        resources.get(uid).email = a.email;
      }
      if (!keyToUid.has(assigneeKey(a))) keyToUid.set(assigneeKey(a), uid);
      addToTask(task, uid, a.units);
    }
  }

  // Pass 2: assignees added in CIQ
  let nextUid = resources.size ? Math.max(...resources.keys()) + 1 : 1;
  for (const task of tasks) {
    for (const a of taskAssignees(task)) {
      const uid = Number(a.msp_resource_uid);
      if (Number.isInteger(uid) && uid > 0) continue;
      const key = assigneeKey(a);
      if (!keyToUid.has(key)) {
        keyToUid.set(key, nextUid);
        resources.set(nextUid, { uid: nextUid, name: a.name || a.email, email: a.email || null });
        nextUid += 1;
      }
      addToTask(task, keyToUid.get(key), a.units);
    }
  }

  return { resources: [...resources.values()].sort((a, b) => a.uid - b.uid), byTask };
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
      <EffortDriven>0</EffortDriven>
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

  // Resources + assignments, only when someone is assigned (otherwise the
  // file is exactly what it was before assignees existed). Each resource
  // gets its own calendar on top of Standard (UID 1), like MS Project's own.
  const { resources, byTask } = exportResources(tasks, programme?.resource_map);
  let resourceSections = null;
  if (resources.length) {
    const calUid = (i) => i + 2;
    const resourceCalendarsXml = resources.map((r, i) => `    <Calendar>
      <UID>${calUid(i)}</UID>
      <Name>${esc(r.name)}</Name>
      <IsBaseCalendar>0</IsBaseCalendar>
      <BaseCalendarUID>1</BaseCalendarUID>
    </Calendar>`).join('\n');

    const resourcesXml = resources.map((r, i) => `    <Resource>
      <UID>${r.uid}</UID><ID>${i + 1}</ID>
      <Name>${esc(r.name)}</Name>
      <Type>1</Type><IsNull>0</IsNull>
      <Initials>${esc(initialsOf(r.name))}</Initials>
      ${r.email ? `<EmailAddress>${esc(r.email)}</EmailAddress>` : ''}
      <CalendarUID>${calUid(i)}</CalendarUID>
    </Resource>`).join('\n');

    let assignmentUid = 0;
    const assignmentsXml = ordered.flatMap(({ task }) => (byTask.get(task.id) || []).map(({ uid, units }) => {
      assignmentUid += 1;
      return `    <Assignment>
      <UID>${assignmentUid}</UID>
      <TaskUID>${idToUid.get(task.id)}</TaskUID>
      <ResourceUID>${uid}</ResourceUID>
      <Units>${units}</Units>
    </Assignment>`;
    })).join('\n');

    resourceSections = { resourceCalendarsXml, resourcesXml, assignmentsXml };
  }

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
${resourceSections ? `${resourceSections.resourceCalendarsXml}\n` : ''}  </Calendars>
  <Tasks>
${taskXml.join('\n')}
  </Tasks>
${resourceSections ? `  <Resources>
${resourceSections.resourcesXml}
  </Resources>
  <Assignments>
${resourceSections.assignmentsXml}
  </Assignments>
` : ''}</Project>
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
 * Map task.id -> a display label for predecessor references.
 * Prefers task.wbs; falls back to outline row number (1-based, depth-first
 * sort_order order) for any task missing a WBS value (e.g. freshly created,
 * before a renumber cascade has run).
 */
export function wbsLabelMap(tasks) {
  const ordered = outlineOrder(tasks);
  const map = new Map();
  ordered.forEach(({ task }, i) => {
    map.set(task.id, task.wbs || String(i + 1));
  });
  return map;
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
  const wbsMap = wbsLabelMap(tasks);

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
      'Predecessors': predecessorLabel(task.predecessors, wbsMap),
      'Total float (days)': r ? Math.round((r.totalFloat / 8) * 10) / 10 : '',
      'Critical': r ? (r.isCritical ? 'Yes' : 'No') : '',
      'Assigned to': assigneeNames(task),
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
