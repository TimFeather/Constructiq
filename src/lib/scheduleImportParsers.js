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
  if (!durationStr) return 1;
  if (typeof durationStr === 'number') return Math.max(1, Math.round(durationStr));
  // ISO 8601: P5DT0H or PT40H
  const dayMatch = durationStr.match(/P(\d+)D/);
  if (dayMatch) return parseInt(dayMatch[1]);
  const hourMatch = durationStr.match(/PT(\d+)H/);
  if (hourMatch) return Math.max(1, Math.round(parseInt(hourMatch[1]) / 8));
  // Plain number string
  const num = parseFloat(durationStr);
  if (!isNaN(num)) return Math.max(1, Math.round(num));
  return 1;
};

// ─── MS Project XML ────────────────────────────────────────────────────────────
// Returns tasks with _mspUid (integer) and _predecessorLinks (raw UID-based deps).
// The caller must do a second pass to resolve UIDs → real DB IDs after bulkCreate.
export const parseXML = (text, projectId) => {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'text/xml');
  const taskNodes = Array.from(xml.querySelectorAll('Tasks > Task'));

  // First pass: collect raw task data keyed by UID
  const rawTasks = taskNodes.map(node => {
    const get = (tag) => node.querySelector(tag)?.textContent?.trim() || '';
    const uid = get('UID');
    const name = get('Name');
    if (!name || uid === '0') return null;

    const predLinks = Array.from(node.querySelectorAll('PredecessorLink')).map(pl => {
      const predUid = pl.querySelector('PredecessorUID')?.textContent?.trim();
      if (!predUid || predUid === '0') return null;
      const typeMap = { '0': 'SS', '1': 'FS', '2': 'SF', '3': 'FF' }; // MS Project: 0=SS,1=FS,2=SF,3=FF
      const rawType = pl.querySelector('Type')?.textContent?.trim();
      const lagText = pl.querySelector('LinkLag')?.textContent?.trim();
      // MS Project stores lag in 1/10 minutes; convert to hours
      const lagHours = lagText ? Math.round(parseInt(lagText) / 600) : 0;
      return {
        _predUid: parseInt(predUid),
        type: typeMap[rawType] || 'FS',
        lag_hours: lagHours,
        is_elapsed: false,
      };
    }).filter(Boolean);

    const constraintType = get('ConstraintType');
    const constraintDate = get('ConstraintDate');
    const constraintTypeMap = { '0':'ASAP','1':'ALAP','2':'MSO','3':'MFO','4':'SNET','5':'SNLT','6':'FNET','7':'FNLT' };

    const task = {
      _mspUid: parseInt(uid),
      _outlineLevel: parseInt(get('OutlineLevel')) || 0,
      name,
      wbs: get('WBS'),
      level: Math.min(parseInt(get('OutlineLevel')) || 0, 3),
      start_date: formatDate(get('Start')),
      end_date: formatDate(get('Finish')),
      duration: parseDuration(get('Duration')),
      percent_complete: parseInt(get('PercentComplete')) || 0,
      is_summary: get('Summary') === '1',
      sort_order: parseInt(get('ID')) || 0,
      project_id: projectId,
      predecessors: [],
      _predecessorLinks: predLinks,
      constraint: {
        type: constraintTypeMap[constraintType] || 'ASAP',
        date: constraintDate ? constraintDate.split('T')[0] : null,
      },
    };

    if (predLinks.length > 0) {
      console.log(`XML Parser: Task ${task.wbs} (${name}, UID ${uid}): found ${predLinks.length} predecessor link(s)`);
    }

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

  return rawTasks;
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