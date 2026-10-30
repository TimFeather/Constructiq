// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseXML, parseMspdiResources, MSPDI_TYPE_TO_DEP, DEP_TO_MSPDI_TYPE } from '../scheduleImportParsers.js';
import { computeImportDiff, isUpdateImport } from '../scheduleImportDiff.js';
import { buildMspdiXml, outlineOrder } from '../scheduleExport.js';
import { runScheduleEngine } from '../scheduling/scheduleEngine.js';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Fixture</Name>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Fixture</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Stage 1</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary>
      <Start>2026-01-05T08:00:00</Start><Finish>2026-01-16T17:00:00</Finish>
      <Duration>PT80H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
    </Task>
    <Task><UID>2</UID><ID>2</ID><Name>Excavate</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-05T08:00:00</Start><Finish>2026-01-09T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration><PercentComplete>25</PercentComplete><Milestone>0</Milestone>
      <ConstraintType>4</ConstraintType><ConstraintDate>2026-01-05T08:00:00</ConstraintDate>
    </Task>
    <Task><UID>3</UID><ID>3</ID><Name>Pour slab</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-12T08:00:00</Start><Finish>2026-01-13T17:00:00</Finish>
      <Duration>PT16H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>4</UID><ID>4</ID><Name>Cure</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-12T08:00:00</Start><Finish>2026-01-16T17:00:00</Finish>
      <Duration>PT40H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>0</Milestone>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>3</Type><LinkLag>4800</LinkLag></PredecessorLink>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>0</Type><LinkLag>-2400</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>5</UID><ID>5</ID><Name>Slab complete</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary>
      <Start>2026-01-16T17:00:00</Start><Finish>2026-01-16T17:00:00</Finish>
      <Duration>PT0H0M0S</Duration><PercentComplete>0</PercentComplete><Milestone>1</Milestone>
    </Task>
  </Tasks>
</Project>`;

describe('parseXML', () => {
  const tasks = parseXML(FIXTURE, 'p1');

  it('maps MSPDI Type codes per spec: 0=FF, 1=FS, 2=SF, 3=SS', () => {
    expect(MSPDI_TYPE_TO_DEP).toEqual({ 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' });
    const pour = tasks.find(t => t.name === 'Pour slab');
    expect(pour._predecessorLinks[0].type).toBe('FS');
    const cure = tasks.find(t => t.name === 'Cure');
    expect(cure._predecessorLinks.find(l => l._predUid === 3).type).toBe('SS');
    expect(cure._predecessorLinks.find(l => l._predUid === 2).type).toBe('FF');
  });

  it('converts LinkLag from tenths of minutes to hours (incl. negative lead)', () => {
    const cure = tasks.find(t => t.name === 'Cure');
    expect(cure._predecessorLinks.find(l => l._predUid === 3).lag_hours).toBe(8);   // 4800/600
    expect(cure._predecessorLinks.find(l => l._predUid === 2).lag_hours).toBe(-4);  // -2400/600
  });

  it('persists mspdi_uid and skips the UID-0 project summary', () => {
    expect(tasks.every(t => t.mspdi_uid > 0)).toBe(true);
    expect(tasks.map(t => t.mspdi_uid)).toEqual([1, 2, 3, 4, 5]);
  });

  it('derives parents from OutlineLevel', () => {
    const excavate = tasks.find(t => t.name === 'Excavate');
    expect(excavate._parentUid).toBe(1);
  });

  it('parses milestones as duration 0', () => {
    const ms = tasks.find(t => t.name === 'Slab complete');
    expect(ms.duration).toBe(0);
    expect(ms.is_milestone).toBe(true);
  });

  it('parses constraints', () => {
    const excavate = tasks.find(t => t.name === 'Excavate');
    expect(excavate.constraint_data).toEqual({ type: 'SNET', date: '2026-01-05' });
  });
});

// Mirrors 26-28 Plowman: a manually scheduled summary (typed start Mon 2 Nov)
// holds its auto-scheduled subtasks back even though their links allow 19/20 Oct.
const MANUAL_FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Tasks>
    <Task><UID>10</UID><ID>1</ID><Name>Site establishment</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Manual>1</Manual>
      <Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T17:00:00</Finish><Duration>PT8H0M0S</Duration>
    </Task>
    <Task><UID>11</UID><ID>2</ID><Name>Prestart meeting</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Manual>0</Manual>
      <Start>2026-10-19T08:00:00</Start><Finish>2026-10-19T17:00:00</Finish><Duration>PT8H0M0S</Duration>
      <ConstraintType>4</ConstraintType><ConstraintDate>2026-10-19T08:00:00</ConstraintDate>
    </Task>
    <Task><UID>12</UID><ID>3</ID><Name>Site set up</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Manual>0</Manual>
      <Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T17:00:00</Finish><Duration>PT8H0M0S</Duration>
      <PredecessorLink><PredecessorUID>11</PredecessorUID><Type>3</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>13</UID><ID>4</ID><Name>Council sign-off</Name><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Manual>0</Manual>
      <Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T08:00:00</Finish><Duration>PT0H0M0S</Duration><Milestone>1</Milestone>
      <PredecessorLink><PredecessorUID>11</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>14</UID><ID>5</ID><Name>Services</Name><OutlineLevel>2</OutlineLevel><Summary>1</Summary><Manual>0</Manual>
      <Start>2026-11-03T08:00:00</Start><Finish>2026-11-04T17:00:00</Finish><Duration>PT16H0M0S</Duration>
    </Task>
    <Task><UID>15</UID><ID>6</ID><Name>Temp power</Name><OutlineLevel>3</OutlineLevel><Summary>0</Summary><Manual>0</Manual>
      <Start>2026-11-03T08:00:00</Start><Finish>2026-11-04T17:00:00</Finish><Duration>PT16H0M0S</Duration>
      <PredecessorLink><PredecessorUID>12</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>16</UID><ID>7</ID><Name>Disconnections</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary><Manual>1</Manual>
      <Start>2026-11-09T08:00:00</Start><Finish>2026-11-09T17:00:00</Finish><Duration>PT8H0M0S</Duration>
      <PredecessorLink><PredecessorUID>11</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
  </Tasks>
</Project>`;

describe('parseXML — manually scheduled tasks', () => {
  const tasks = parseXML(MANUAL_FIXTURE, 'p1');
  const byName = Object.fromEntries(tasks.map(t => [t.name, t]));

  it('floors auto-scheduled subtasks of a manual summary at its start (SNET)', () => {
    expect(byName['Site set up'].constraint_data).toEqual({ type: 'SNET', date: '2026-11-02' });
    expect(byName['Council sign-off'].constraint_data).toEqual({ type: 'SNET', date: '2026-11-02' });
    expect(byName['Temp power'].constraint_data).toEqual({ type: 'SNET', date: '2026-11-02' });
  });

  it("keeps a subtask's own constraint and leaves summaries unconstrained", () => {
    expect(byName['Prestart meeting'].constraint_data).toEqual({ type: 'SNET', date: '2026-10-19' });
    expect(byName['Services'].constraint_data.type).toBe('ASAP');
    expect(byName['Site establishment'].constraint_data.type).toBe('ASAP');
  });

  it('pins a linked manual task to its typed start (MSO)', () => {
    expect(byName['Disconnections'].constraint_data).toEqual({ type: 'MSO', date: '2026-11-09' });
  });

  it('engine reproduces the MS Project dates for every leaf task', () => {
    const engineTasks = tasks.map(pt => ({
      id: String(pt.mspdi_uid),
      parent_id: pt._parentUid != null ? String(pt._parentUid) : null,
      start_date: pt.start_date,
      end_date: pt.end_date,
      duration: pt.duration,
      is_milestone: pt.is_milestone,
      percent_complete: pt.percent_complete,
      constraint: pt.constraint_data,
      predecessors: pt._predecessorLinks.map(l => ({
        predecessor_id: String(l._predUid), type: l.type, lag_hours: l.lag_hours,
      })),
    }));
    const result = runScheduleEngine(engineTasks, '2026-10-19');
    for (const pt of tasks.filter(t => !t.is_summary)) {
      const r = result.get(String(pt.mspdi_uid));
      expect([pt.name, r.startStr, r.finishStr]).toEqual([pt.name, pt.start_date, pt.end_date]);
    }
  });
});

// Resourced and levelled in MS Project. Unlevelled, Plumbing and Electrical would
// both start Mon 9 Mar after Frame; levelling pushed them to Wed 11 Mar.
const RESOURCE_FIXTURE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Resourced</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Frame</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary>
      <Start>2026-03-02T08:00:00</Start><Finish>2026-03-06T17:00:00</Finish><Duration>PT40H0M0S</Duration>
    </Task>
    <Task><UID>2</UID><ID>2</ID><Name>Plumbing rough-in</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary>
      <Start>2026-03-11T08:00:00</Start><Finish>2026-03-12T17:00:00</Finish><Duration>PT16H0M0S</Duration>
      <LevelingDelay>9600</LevelingDelay><LevelingDelayFormat>7</LevelingDelayFormat>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>3</UID><ID>3</ID><Name>Electrical rough-in</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary>
      <Start>2026-03-11T08:00:00</Start><Finish>2026-03-12T17:00:00</Finish><Duration>PT16H0M0S</Duration>
      <ConstraintType>7</ConstraintType><ConstraintDate>2026-03-13T17:00:00</ConstraintDate>
      <LevelingDelay>9600</LevelingDelay><LevelingDelayFormat>7</LevelingDelayFormat>
      <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>4</UID><ID>4</ID><Name>Pre-line inspection</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary>
      <Start>2026-03-13T08:00:00</Start><Finish>2026-03-13T17:00:00</Finish><Duration>PT8H0M0S</Duration>
      <LevelingDelay>0</LevelingDelay>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
    <Task><UID>5</UID><ID>5</ID><Name>Scaffold</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary>
      <Start>2026-03-04T08:00:00</Start><Finish>2026-03-05T17:00:00</Finish><Duration>PT16H0M0S</Duration>
      <LevelingDelay>4800</LevelingDelay><LevelingDelayFormat>7</LevelingDelayFormat>
    </Task>
    <Task><UID>6</UID><ID>6</ID><Name>Site clean</Name><OutlineLevel>1</OutlineLevel><Summary>0</Summary><Manual>1</Manual>
      <Start>2026-03-17T08:00:00</Start><Finish>2026-03-17T17:00:00</Finish><Duration>PT8H0M0S</Duration>
      <LevelingDelay>4800</LevelingDelay><LevelingDelayFormat>7</LevelingDelayFormat>
      <PredecessorLink><PredecessorUID>4</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>
    </Task>
  </Tasks>
  <Resources>
    <Resource><UID>0</UID><ID>0</ID><Type>1</Type><IsNull>0</IsNull></Resource>
    <Resource><UID>1</UID><ID>1</ID><Name>ABC Plumbing Ltd</Name><Type>1</Type>
      <EmailAddress>office@abcplumbing.co.nz</EmailAddress><Group>Plumber</Group><CalendarUID>3</CalendarUID>
      <Baseline><Number>0</Number><Work>PT24H0M0S</Work></Baseline>
    </Resource>
    <Resource><UID>2</UID><ID>2</ID><Name>Electrician</Name><Type>1</Type><Group>Electrical</Group></Resource>
    <Resource><UID>3</UID><ID>3</ID><Name>Timber</Name><Type>0</Type></Resource>
    <Resource><UID>4</UID><ID>4</ID><Name>Crane hire</Name><Type>2</Type></Resource>
    <Resource><UID>5</UID><ID>5</ID><Name>Builder</Name></Resource>
    <Resource><UID>6</UID><ID>6</ID><Name>Roofer</Name><Type>1</Type></Resource>
  </Resources>
  <Assignments>
    <Assignment><UID>1</UID><TaskUID>1</TaskUID><ResourceUID>5</ResourceUID><Units>1</Units></Assignment>
    <Assignment><UID>2</UID><TaskUID>2</TaskUID><ResourceUID>1</ResourceUID><Units>1</Units>
      <TimephasedData><Type>1</Type><UID>2</UID><Start>2026-03-11T08:00:00</Start><Finish>2026-03-12T08:00:00</Finish><Unit>2</Unit><Value>PT8H0M0S</Value></TimephasedData>
    </Assignment>
    <Assignment><UID>3</UID><TaskUID>2</TaskUID><ResourceUID>3</ResourceUID><Units>10</Units></Assignment>
    <Assignment><UID>4</UID><TaskUID>3</TaskUID><ResourceUID>2</ResourceUID><Units>0.5</Units></Assignment>
    <Assignment><UID>5</UID><TaskUID>3</TaskUID><ResourceUID>4</ResourceUID><Units>1</Units></Assignment>
    <Assignment><UID>6</UID><TaskUID>4</TaskUID><ResourceUID>1</ResourceUID><Units>1</Units></Assignment>
    <Assignment><UID>7</UID><TaskUID>4</TaskUID><ResourceUID>2</ResourceUID><Units>1</Units></Assignment>
    <Assignment><UID>8</UID><TaskUID>4</TaskUID><ResourceUID>5</ResourceUID></Assignment>
    <Assignment><UID>9</UID><TaskUID>5</TaskUID><ResourceUID>-65535</ResourceUID><Units>1</Units></Assignment>
    <Assignment><UID>10</UID><TaskUID>6</TaskUID><ResourceUID>5</ResourceUID><Units>1</Units></Assignment>
  </Assignments>
</Project>`;

describe('parseMspdiResources', () => {
  const resources = parseMspdiResources(RESOURCE_FIXTURE);

  it('lists named work resources only, with task counts', () => {
    expect(resources).toEqual([
      { uid: 1, name: 'ABC Plumbing Ltd', email: 'office@abcplumbing.co.nz', group: 'Plumber', calendarUid: 3, taskCount: 2 },
      { uid: 2, name: 'Electrician', email: null, group: 'Electrical', calendarUid: null, taskCount: 2 },
      { uid: 5, name: 'Builder', email: null, group: null, calendarUid: null, taskCount: 3 },
      { uid: 6, name: 'Roofer', email: null, group: null, calendarUid: null, taskCount: 0 },
    ]);
  });

  it('returns nothing for a file with no resources', () => {
    expect(parseMspdiResources(FIXTURE)).toEqual([]);
  });
});

describe('parseXML — resource assignments', () => {
  const tasks = parseXML(RESOURCE_FIXTURE, 'p1');
  const byName = Object.fromEntries(tasks.map(t => [t.name, t]));

  it('attaches work-resource assignments, dropping material and cost resources', () => {
    expect(byName['Frame']._mspAssignments).toEqual([{ resourceUid: 5, units: 1 }]);
    expect(byName['Plumbing rough-in']._mspAssignments).toEqual([{ resourceUid: 1, units: 1 }]);
    expect(byName['Electrical rough-in']._mspAssignments).toEqual([{ resourceUid: 2, units: 0.5 }]);
  });

  it('keeps every resource on a multi-resource task; missing Units means 100%', () => {
    expect(byName['Pre-line inspection']._mspAssignments).toEqual([
      { resourceUid: 1, units: 1 },
      { resourceUid: 2, units: 1 },
      { resourceUid: 5, units: 1 },
    ]);
  });

  it("drops MS Project's -65535 unassigned placeholder", () => {
    expect(byName['Scaffold']._mspAssignments).toEqual([]);
  });

  it('gives every task an empty list when the file has no assignments', () => {
    expect(parseXML(FIXTURE, 'p1').every(t => Array.isArray(t._mspAssignments) && !t._mspAssignments.length)).toBe(true);
  });
});

describe('parseXML — resource levelling', () => {
  const tasks = parseXML(RESOURCE_FIXTURE, 'p1');
  const byName = Object.fromEntries(tasks.map(t => [t.name, t]));

  it('holds a levelled linked task at its levelled start (SNET)', () => {
    expect(byName['Plumbing rough-in'].constraint_data)
      .toEqual({ type: 'SNET', date: '2026-03-11', source: 'msp_leveling' });
  });

  it("keeps a levelled task's own constraint", () => {
    expect(byName['Electrical rough-in'].constraint_data).toEqual({ type: 'FNLT', date: '2026-03-13' });
  });

  it('leaves unlevelled and unlinked tasks alone', () => {
    expect(byName['Pre-line inspection'].constraint_data.type).toBe('ASAP');
    expect(byName['Frame'].constraint_data.type).toBe('ASAP');
    // Unlinked: the engine already anchors it to its stored (levelled) start
    expect(byName['Scaffold'].constraint_data.type).toBe('ASAP');
  });

  it('a levelled linked manual task is still pinned (MSO)', () => {
    expect(byName['Site clean'].constraint_data).toEqual({ type: 'MSO', date: '2026-03-17' });
  });

  it('engine reproduces the levelled MS Project dates', () => {
    const engineTasks = tasks.map(pt => ({
      id: String(pt.mspdi_uid),
      parent_id: null,
      start_date: pt.start_date,
      end_date: pt.end_date,
      duration: pt.duration,
      is_milestone: pt.is_milestone,
      percent_complete: pt.percent_complete,
      constraint: pt.constraint_data,
      predecessors: pt._predecessorLinks.map(l => ({
        predecessor_id: String(l._predUid), type: l.type, lag_hours: l.lag_hours,
      })),
    }));
    const result = runScheduleEngine(engineTasks, '2026-03-02');
    // Electrical keeps its own FNLT, so its levelling delay is not reproduced
    for (const pt of tasks.filter(t => t.name !== 'Electrical rough-in')) {
      const r = result.get(String(pt.mspdi_uid));
      expect([pt.name, r.startStr, r.finishStr]).toEqual([pt.name, pt.start_date, pt.end_date]);
    }
  });

  it('re-importing the same levelled file is not a constraint change', () => {
    const frame = byName['Frame'];
    const plumbing = byName['Plumbing rough-in'];
    const existing = (constraintData) => [
      { id: 'db1', project_id: 'p1', mspdi_uid: 1, name: frame.name, wbs: frame.wbs, parent_id: null,
        start_date: frame.start_date, end_date: frame.end_date, duration: frame.duration,
        percent_complete: 0, constraint_data: frame.constraint_data, predecessors: [] },
      { id: 'db2', project_id: 'p1', mspdi_uid: 2, name: plumbing.name, wbs: plumbing.wbs, parent_id: null,
        start_date: plumbing.start_date, end_date: plumbing.end_date, duration: plumbing.duration,
        percent_complete: 0, constraint_data: constraintData,
        predecessors: [{ predecessor_id: 'db1', type: 'FS', lag_hours: 0 }] },
    ];
    const fieldsFor = (diff) => diff.changed.find(c => c.existing.id === 'db2')?.fieldDiffs.map(d => d.field) || [];

    // Stored without the source tag (e.g. edited since) — same type and date, no change
    expect(fieldsFor(computeImportDiff([frame, plumbing], existing({ type: 'SNET', date: '2026-03-11' }))))
      .not.toContain('constraint_data');
    // Imported before levelling was handled — picks up the SNET
    expect(fieldsFor(computeImportDiff([frame, plumbing], existing({ type: 'ASAP', date: null }))))
      .toContain('constraint_data');
  });
});

describe('computeImportDiff', () => {
  const parsed = parseXML(FIXTURE, 'p1');

  function asExisting(pt, id, extra = {}) {
    return {
      id,
      project_id: 'p1',
      mspdi_uid: pt.mspdi_uid,
      name: pt.name,
      wbs: pt.wbs,
      parent_id: null,
      start_date: pt.start_date,
      end_date: pt.end_date,
      duration: pt.duration,
      percent_complete: pt.percent_complete,
      constraint_data: pt.constraint_data,
      predecessors: [],
      ...extra,
    };
  }

  it('classifies added / changed / missing / unchanged', () => {
    // Existing DB: uids 1,2,3 present (3 has a moved date), uid 99 not in file.
    // Parent/dep diffs are expected for tasks whose file versions carry them.
    const existing = [
      asExisting(parsed[0], 'db1'),
      asExisting(parsed[1], 'db2', { parent_id: 'db1' }),
      asExisting(parsed[2], 'db3', { parent_id: 'db1', start_date: '2026-01-20', end_date: '2026-01-21' }),
      { id: 'db99', project_id: 'p1', mspdi_uid: 99, name: 'Old task', predecessors: [] },
    ];
    // Give existing uid-3 its dependency so only dates differ
    existing[2].predecessors = [{ predecessor_id: 'db2', type: 'FS', lag_hours: 0 }];

    const diff = computeImportDiff(parsed, existing);

    expect(diff.added.map(t => t.mspdi_uid)).toEqual([4, 5]);
    expect(diff.missing.map(t => t.id)).toEqual(['db99']);

    const changed3 = diff.changed.find(c => c.existing.id === 'db3');
    expect(changed3).toBeTruthy();
    const fields = changed3.fieldDiffs.map(d => d.field);
    expect(fields).toContain('start_date');
    expect(fields).toContain('end_date');
    expect(fields).not.toContain('predecessors'); // deps identical
  });

  it('detects dependency changes in uid space', () => {
    const existing = [
      asExisting(parsed[1], 'db2'), // Excavate uid 2
      asExisting(parsed[2], 'db3'), // Pour slab uid 3 — but with NO deps stored
    ];
    const diff = computeImportDiff(parsed, existing);
    const changed3 = diff.changed.find(c => c.existing.id === 'db3');
    expect(changed3.fieldDiffs.some(d => d.field === 'predecessors')).toBe(true);
  });

  it('isUpdateImport is true only when uids exist', () => {
    expect(isUpdateImport([{ mspdi_uid: 3 }])).toBe(true);
    expect(isUpdateImport([{ mspdi_uid: null }])).toBe(false);
    expect(isUpdateImport([])).toBe(false);
  });
});

describe('MSPDI export round-trip', () => {
  // Engine-shape tasks as they'd come from fetchProgrammeTasks
  const dbTasks = [
    {
      id: 'a', project_id: 'p1', mspdi_uid: null, name: 'Groundworks', parent_id: null, sort_order: 1,
      start_date: '2026-01-05', end_date: '2026-01-16', duration: 10, percent_complete: 0,
      predecessors: [], constraint_data: null,
    },
    {
      id: 'b', project_id: 'p1', mspdi_uid: null, name: 'Excavate & fill', parent_id: 'a', sort_order: 2,
      start_date: '2026-01-05', end_date: '2026-01-09', duration: 5, percent_complete: 50,
      predecessors: [], constraint_data: { type: 'SNET', date: '2026-01-05' },
    },
    {
      id: 'c', project_id: 'p1', mspdi_uid: null, name: 'Pour slab', parent_id: 'a', sort_order: 3,
      start_date: '2026-01-12', end_date: '2026-01-13', duration: 2, percent_complete: 0,
      predecessors: [{ predecessor_id: 'b', type: 'FS', lag_hours: 8, is_elapsed: false }],
      constraint_data: null,
    },
    {
      id: 'd', project_id: 'p1', mspdi_uid: null, name: 'Milestone: slab done', parent_id: 'a', sort_order: 4,
      start_date: '2026-01-13', end_date: '2026-01-13', duration: 0, is_milestone: true, percent_complete: 0,
      predecessors: [{ predecessor_id: 'c', type: 'FF', lag_hours: 0, is_elapsed: false }],
      constraint_data: null,
    },
  ];

  it('outlineOrder walks parents before children in sort order', () => {
    const order = outlineOrder(dbTasks).map(o => o.task.id);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
    expect(outlineOrder(dbTasks)[1].outlineLevel).toBe(2);
  });

  it('export then re-import preserves structure, types, lags, constraints', () => {
    const xml = buildMspdiXml(dbTasks, null, { projectName: 'Roundtrip', holidays: ['2026-01-19'] });

    // UID-0 summary task must be the first task in the <Tasks> block
    const tasksBlock = xml.slice(xml.indexOf('<Tasks>'));
    expect(tasksBlock.indexOf('<UID>0</UID>')).toBeGreaterThan(-1);
    expect(tasksBlock.indexOf('<UID>0</UID>')).toBeLessThan(tasksBlock.indexOf('<UID>1</UID>'));

    const reparsed = parseXML(xml, 'p2');
    expect(reparsed).toHaveLength(4);

    const byName = Object.fromEntries(reparsed.map(t => [t.name, t]));
    expect(byName['Excavate & fill']._parentUid).toBe(byName['Groundworks'].mspdi_uid);
    expect(byName['Excavate & fill'].start_date).toBe('2026-01-05');
    expect(byName['Excavate & fill'].duration).toBe(5);
    expect(byName['Excavate & fill'].percent_complete).toBe(50);
    expect(byName['Excavate & fill'].constraint_data).toEqual({ type: 'SNET', date: '2026-01-05' });

    const pour = byName['Pour slab'];
    expect(pour._predecessorLinks).toHaveLength(1);
    expect(pour._predecessorLinks[0].type).toBe('FS');
    expect(pour._predecessorLinks[0].lag_hours).toBe(8);
    expect(pour._predecessorLinks[0]._predUid).toBe(byName['Excavate & fill'].mspdi_uid);

    const ms = byName['Milestone: slab done'];
    expect(ms.is_milestone).toBe(true);
    expect(ms.duration).toBe(0);
    expect(ms._predecessorLinks[0].type).toBe('FF');

    // Re-importing the exported file over itself = no changes
    const existing = reparsed.map((pt, i) => ({
      id: `db${i}`, project_id: 'p2', mspdi_uid: pt.mspdi_uid, name: pt.name, wbs: pt.wbs,
      parent_id: null, start_date: pt.start_date, end_date: pt.end_date, duration: pt.duration,
      percent_complete: pt.percent_complete, constraint_data: pt.constraint_data, predecessors: [],
    }));
    // wire parents + deps into the fake DB rows so the diff sees identical state
    const uidToDb = new Map(existing.map(e => [e.mspdi_uid, e.id]));
    reparsed.forEach((pt, i) => {
      existing[i].parent_id = pt._parentUid ? uidToDb.get(pt._parentUid) : null;
      existing[i].predecessors = (pt._predecessorLinks || []).map(l => ({
        predecessor_id: uidToDb.get(l._predUid), type: l.type, lag_hours: l.lag_hours,
      }));
    });

    const diff = computeImportDiff(reparsed, existing);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.missing).toHaveLength(0);
    expect(diff.unchangedCount).toBe(4);
  });

  it('type code maps are exact inverses', () => {
    for (const [code, dep] of Object.entries(MSPDI_TYPE_TO_DEP)) {
      expect(DEP_TO_MSPDI_TYPE[dep]).toBe(Number(code));
    }
  });
});
