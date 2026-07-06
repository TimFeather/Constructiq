import { describe, it, expect } from 'vitest';
import { predecessorLabel, wbsLabelMap } from '../scheduleExport.js';

describe('predecessorLabel', () => {
  it('formats a WBS lookup with type and lag', () => {
    const idToLabel = new Map([['a', '1.2']]);
    const label = predecessorLabel([{ predecessor_id: 'a', type: 'FS', lag_days: 2 }], idToLabel);
    expect(label).toBe('1.2FS+2d');
  });

  it('formats negative lag without a plus sign', () => {
    const idToLabel = new Map([['a', '2.1']]);
    const label = predecessorLabel([{ predecessor_id: 'a', type: 'SS', lag_days: -1 }], idToLabel);
    expect(label).toBe('2.1SS-1d');
  });

  it('omits the lag suffix when lag is zero', () => {
    const idToLabel = new Map([['a', '3']]);
    const label = predecessorLabel([{ predecessor_id: 'a', type: 'FF', lag_days: 0 }], idToLabel);
    expect(label).toBe('3FF');
  });

  it('derives lag from lag_hours when lag_days is absent', () => {
    const idToLabel = new Map([['a', '1']]);
    const label = predecessorLabel([{ predecessor_id: 'a', type: 'FS', lag_hours: 16 }], idToLabel);
    expect(label).toBe('1FS+2d');
  });

  it('defaults to FS when type is missing', () => {
    const idToLabel = new Map([['a', '1']]);
    const label = predecessorLabel([{ predecessor_id: 'a' }], idToLabel);
    expect(label).toBe('1FS');
  });

  it('joins multiple predecessors with a comma', () => {
    const idToLabel = new Map([['a', '1'], ['b', '2.3']]);
    const label = predecessorLabel([
      { predecessor_id: 'a', type: 'FS', lag_days: 0 },
      { predecessor_id: 'b', type: 'SS', lag_days: 1 },
    ], idToLabel);
    expect(label).toBe('1FS, 2.3SS+1d');
  });

  it('filters out predecessors missing from the label map', () => {
    const idToLabel = new Map([['a', '1']]);
    const label = predecessorLabel([
      { predecessor_id: 'a', type: 'FS', lag_days: 0 },
      { predecessor_id: 'missing', type: 'FS', lag_days: 0 },
    ], idToLabel);
    expect(label).toBe('1FS');
  });

  it('returns empty string for no predecessors', () => {
    expect(predecessorLabel([], new Map())).toBe('');
    expect(predecessorLabel(null, new Map())).toBe('');
  });

  it('supports the legacy task_id field name', () => {
    const idToLabel = new Map([['a', '1']]);
    const label = predecessorLabel([{ task_id: 'a', type: 'FS', lag_days: 0 }], idToLabel);
    expect(label).toBe('1FS');
  });
});

describe('wbsLabelMap', () => {
  it('uses task.wbs when present', () => {
    const tasks = [
      { id: '1', name: 'Root', parent_id: null, sort_order: 1, wbs: '1' },
      { id: '2', name: 'Child', parent_id: '1', sort_order: 1, wbs: '1.1' },
    ];
    const map = wbsLabelMap(tasks);
    expect(map.get('1')).toBe('1');
    expect(map.get('2')).toBe('1.1');
  });

  it('falls back to outline row number when wbs is missing', () => {
    const tasks = [
      { id: '1', name: 'Root', parent_id: null, sort_order: 1, wbs: null },
      { id: '2', name: 'Child', parent_id: '1', sort_order: 1, wbs: null },
    ];
    const map = wbsLabelMap(tasks);
    expect(map.get('1')).toBe('1');
    expect(map.get('2')).toBe('2');
  });

  it('mixes wbs and fallback numbering independently per task', () => {
    const tasks = [
      { id: '1', name: 'Root', parent_id: null, sort_order: 1, wbs: '1' },
      { id: '2', name: 'Child', parent_id: '1', sort_order: 1, wbs: null },
    ];
    const map = wbsLabelMap(tasks);
    expect(map.get('1')).toBe('1');
    expect(map.get('2')).toBe('2'); // outline row 2 (depth-first), not '1.1'
  });
});
