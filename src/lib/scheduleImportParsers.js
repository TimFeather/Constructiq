import * as XLSX from 'xlsx';

const formatDate = (str) => {
  if (!str) return null;
  // Handle ISO datetime: "2025-06-01T08:00:00"
  if (typeof str === 'string') return str.split('T')[0];
  // Handle Excel serial date numbers
  if (typeof str === 'number') {
    const date = XLSX.SSF.parse_date_code(str);
    if (date) return `${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`;
  }
  return null;
};

const parseDuration = (durationStr) => {
  if (durationStr === 0 || durationStr === '0') return 0;
  if (!durationStr) return 1;
  if (typeof durationStr === 'number') return Math.max(0, Math.round(durationStr));
  // ISO 8601: P5DT0H or PT40H0M0S (0 is valid — milestones)
  const dayMatch = durationStr.match(/P(\d+)D/);
  const hourMatch = durationStr.match(/PT(\d+(?:\.\d+)?)H/);
  if (dayMatch || hourMatch) {
    const days = (dayMatch ? parseInt(dayMatch[1]) : 0)
      + (hourMatch ? parseFloat(hourMatch[1]) / 8 : 0);
    return Math.round(days * 100) / 100;
  }
  // Plain number string
  const num = parseFloat(durationStr);
  if (!isNaN(num)) return Math.max(0, Math.round(num * 100) / 100);
  return 1;
};

// MSPDI PredecessorLink Type codes (MS Project XML spec): 0=FF, 1=FS, 2=SF, 3=SS
export const MSPDI_TYPE_TO_DEP = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' };
export const DEP_TO_MSPDI_TYPE = { FF: 0, FS: 1, SF: 2, SS: 3 };

// MSPDI Resource Type codes: 0=Material, 1=Work, 2=Cost. Only work resources
// (people, crews, subcontractors, trades) can be task assignees.
const MSPDI_WORK_RESOURCE = '1';

/** Text of a direct child element, never a nested Baseline/TimephasedData one. */
const childText = (node, tag) => {
  for (const child of node.children) {
    if (child.localName === tag) return child.textContent.trim();
  }
  return '';
};

// UID → resource for every named work resource. UID 0 is MS Project's blank
// placeholder; a missing Type is a work resource.
const readWorkResources = (xml) => {
  const resources = new Map();
  for (const node of xml.querySelectorAll('Resources > Resource')) {
    const uid = parseInt(childText(node, 'UID'));
    const name = childText(node, 'Name');
    const type = childText(node, 'Type');
    if (!uid || !name || childText(node, 'IsNull') === '1') continue;
    if (type && type !== MSPDI_WORK_RESOURCE) continue;
    resources.set(uid, {
      uid,
      name,
      email: childText(node, 'EmailAddress') || null,
      group: childText(node, 'Group') || null,
      calendarUid: parseInt(childText(node, 'CalendarUID')) || null,
    });
  }
  return resources;
};

// Task UID → [{ resourceUid, units }] for assignments to work resources. This
// also drops MS Project's ResourceUID -65535, written for a task with no resources.
const readAssignments = (xml, workResources) => {
  const byTask = new Map();
  for (const node of xml.querySelectorAll('Assignments > Assignment')) {
    const taskUid = parseInt(childText(node, 'TaskUID'));
    const resourceUid = parseInt(childText(node, 'ResourceUID'));
    if (!taskUid || !workResources.has(resourceUid)) continue;
    const units = parseFloat(childText(node, 'Units'));
    if (!byTask.has(taskUid)) byTask.set(taskUid, []);
    byTask.get(taskUid).push({
      resourceUid,
      units: Number.isFinite(units) ? Math.round(units * 100) / 100 : 1,
    });
  }
  return byTask;
};

/**
 * Work resources in an MSPDI file, with how many tasks each is assigned to.
 * Feeds the import's resource → team member mapping step.
 *
 * @returns {Array<{ uid, name, email, group, calendarUid, taskCount }>}
 */
export const parseMspdiResources = (text) => {
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  const workResources = readWorkResources(xml);
  const taskCounts = new Map();
  for (const list of readAssignments(xml, workResources).values()) {
    for (const { resourceUid } of list) taskCounts.set(resourceUid, (taskCounts.get(resourceUid) || 0) + 1);
  }
  return [...workResources.values()].map(r => ({ ...r, taskCount: taskCounts.get(r.uid) || 0 }));
};

// ─── MS Project XML ────────────────────────────────────────────────────────────
// Returns tasks with _mspUid (integer), _predecessorLinks (raw UID-based deps)
// and _mspAssignments (raw resource UIDs, resolved to assignees by the caller).
// The caller must do a second pass to resolve UIDs → real DB IDs after bulkCreate.
export const parseXML = (text, projectId) => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'text/xml');
  const taskNodes = Array.from(xml.querySelectorAll('Tasks > Task'));
  const assignments = readAssignments(xml, readWorkResources(xml));

  // First pass: collect raw task data keyed by UID
  const rawTasks = taskNodes.map(node => {
    const get = (tag) => node.querySelector(tag)?.textContent?.trim() || '';
    const uid = get('UID');
    const name = get('Name');
    if (!name || uid === '0') return null;

    const predLinks = Array.from(node.querySelectorAll('PredecessorLink')).map(pl => {
      const predUid = pl.querySelector('PredecessorUID')?.textContent?.trim();
      if (!predUid || predUid === '0') return null;
      const rawType = pl.querySelector('Type')?.textContent?.trim();
      const lagText = pl.querySelector('LinkLag')?.textContent?.trim();
      // MS Project stores lag in 1/10 minutes; convert to hours (can be fractional/negative)
      const lagHours = lagText ? Math.round((parseInt(lagText) / 600) * 100) / 100 : 0;
      return {
        _predUid: parseInt(predUid),
        type: MSPDI_TYPE_TO_DEP[parseInt(rawType)] || 'FS',
        lag_hours: lagHours,
        is_elapsed: false,
      };
    }).filter(Boolean);

    const constraintType = get('ConstraintType');
    const constraintDate = get('ConstraintDate');
    const constraintTypeMap = { '0':'ASAP','1':'ALAP','2':'MSO','3':'MFO','4':'SNET','5':'SNLT','6':'FNET','7':'FNLT' };

    const isMilestone = get('Milestone') === '1';
    const duration = parseDuration(get('Duration'));
    const isSummary = get('Summary') === '1';
    const startDate = formatDate(get('Start'));

    let constraintData = {
      type: constraintTypeMap[constraintType] || 'ASAP',
      date: constraintDate ? constraintDate.split('T')[0] : null,
    };
    // Resource levelling delays a task past what its links require, and the
    // engine has no levelling, so a linked task would snap back to its early
    // start. Hold it at the levelled start the file carries. Unlinked tasks
    // already anchor to their stored start. Runs before applyManualScheduling,
    // which pins linked manual tasks (MSO) and skips tasks constrained here.
    if (!isSummary && parseFloat(get('LevelingDelay')) > 0
        && constraintData.type === 'ASAP' && predLinks.length && startDate) {
      constraintData = { type: 'SNET', date: startDate, source: 'msp_leveling' };
    }

    const task = {
      _mspUid: parseInt(uid),
      _outlineLevel: parseInt(get('OutlineLevel')) || 0,
      _manual: get('Manual') === '1',
      mspdi_uid: parseInt(uid),   // persisted for round-trip / re-import matching
      name,
      wbs: get('WBS'),
      level: Math.min(parseInt(get('OutlineLevel')) || 0, 3),
      start_date: startDate,
      end_date: formatDate(get('Finish')),
      duration: isMilestone ? 0 : duration,
      is_milestone: isMilestone || duration === 0,
      percent_complete: parseInt(get('PercentComplete')) || 0,
      is_summary: isSummary,
      sort_order: parseInt(get('ID')) || 0,
      project_id: projectId,
      predecessors: [],
      _predecessorLinks: predLinks,
      _mspAssignments: assignments.get(parseInt(uid)) || [],
      constraint_data: constraintData,
    };

    return task;
  }).filter(Boolean);

  // Second pass: derive parent_id by tracking the ancestor stack per outline level
  // Stack maps outlineLevel → the UID of the most recent task at that level
  const ancestorStack = new Map(); // level → uid

  rawTasks.forEach(task => {
    const level = task._outlineLevel;

    // Parent is the most recent task whose outlineLevel is one less
    let parentUid = null;
    for (let l = level - 1; l >= 0; l--) {
      if (ancestorStack.has(l)) {
        parentUid = ancestorStack.get(l);
        break;
      }
    }
    task._parentUid = parentUid;

    // Register this task as the current node at its level
    ancestorStack.set(level, task._mspUid);
    // Clear any deeper levels (they are no longer valid ancestors)
    for (const key of [...ancestorStack.keys()]) {
      if (key > level) ancestorStack.delete(key);
    }
  });

  applyManualScheduling(rawTasks);

  return rawTasks;
};

// The engine has no manual scheduling mode, so express what MS Project does with
// manually scheduled tasks as constraints, or the imported dates get recomputed:
//  - a manual summary's start is a floor for its auto-scheduled subtasks → SNET
//    on descendant leaf tasks that carry no constraint of their own
//  - a manual leaf task ignores its links and stays where it was typed → MSO
const applyManualScheduling = (tasks) => {
  const byUid = new Map(tasks.map(t => [t._mspUid, t]));
  for (const task of tasks) {
    if (task.is_summary) continue;

    if (task._manual) {
      if (task._predecessorLinks.length && task.start_date) {
        task.constraint_data = { type: 'MSO', date: task.start_date };
      }
      continue;
    }
    if (task.constraint_data.type !== 'ASAP') continue;

    let floor = null;
    const seen = new Set();
    for (let p = byUid.get(task._parentUid); p && !seen.has(p._mspUid); p = byUid.get(p._parentUid)) {
      seen.add(p._mspUid);
      if (p._manual && p.start_date && (!floor || p.start_date > floor)) floor = p.start_date;
    }
    if (floor) task.constraint_data = { type: 'SNET', date: floor };
  }
};

// ─── MPX (legacy MS Project text format) ──────────────────────────────────────
export const parseMPX = (text, projectId) => {
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let inTask = false;
  let current = null;
  let sortOrder = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // MPX uses record numbers; record 70 = Task
    const parts = trimmed.split(',');
    const record = parts[0];

    if (record === '70') {
      // Task record: ID, Name, Duration, Start, Finish, %Complete, WBS, OutlineLevel
      sortOrder++;
      const name = parts[4]?.replace(/"/g, '') || '';
      if (!name) continue;

      tasks.push({
        name,
        wbs: parts[8]?.replace(/"/g, '') || String(sortOrder),
        level: Math.min(parseInt(parts[9]) || 0, 3),
        start_date: formatDate(parts[11]?.replace(/"/g, '')),
        end_date: formatDate(parts[12]?.replace(/"/g, '')),
        duration: parseDuration(parts[5]?.replace(/"/g, '')),
        percent_complete: parseInt(parts[23]) || 0,
        sort_order: sortOrder,
        project_id: projectId,
        predecessors: [],
      });
    }
  }
  return tasks;
};

// ─── Excel / CSV ───────────────────────────────────────────────────────────────
const COLUMN_ALIASES = {
  name: ['name', 'task name', 'task', 'activity', 'description', 'title'],
  wbs: ['wbs', 'wbs code', 'outline number', 'id'],
  level: ['level', 'outline level', 'indent', 'hierarchy'],
  start_date: ['start', 'start date', 'begin', 'begin date'],
  end_date: ['end', 'end date', 'finish', 'finish date', 'due', 'due date'],
  duration: ['duration', 'duration (days)', 'days'],
  percent_complete: ['% complete', 'percent complete', 'progress', 'complete', '% comp'],
};

const findColumn = (headers, fieldKey) => {
  const aliases = COLUMN_ALIASES[fieldKey];
  for (const alias of aliases) {
    const match = headers.find(h => h.toLowerCase().trim() === alias);
    if (match) return match;
  }
  return null;
};

export const parseExcelCSV = (file, projectId) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rows.length) return resolve([]);

      const headers = Object.keys(rows[0]);
      const col = {};
      for (const field of Object.keys(COLUMN_ALIASES)) {
        col[field] = findColumn(headers, field);
      }

      const tasks = rows.map((row, i) => {
        const name = col.name ? String(row[col.name]).trim() : '';
        if (!name) return null;

        const startRaw = col.start_date ? row[col.start_date] : null;
        const endRaw = col.end_date ? row[col.end_date] : null;

        // Handle Date objects from cellDates:true
        const toDateStr = (val) => {
          if (!val) return null;
          if (val instanceof Date) return val.toISOString().split('T')[0];
          return formatDate(val);
        };

        return {
          name,
          wbs: col.wbs ? String(row[col.wbs]).trim() : String(i + 1),
          level: Math.min(parseInt(col.level ? row[col.level] : 0) || 0, 3),
          start_date: toDateStr(startRaw),
          end_date: toDateStr(endRaw),
          duration: parseDuration(col.duration ? row[col.duration] : 1),
          percent_complete: parseInt(col.percent_complete ? row[col.percent_complete] : 0) || 0,
          sort_order: i + 1,
          project_id: projectId,
          predecessors: [],
        };
      }).filter(Boolean);

      resolve(tasks);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};