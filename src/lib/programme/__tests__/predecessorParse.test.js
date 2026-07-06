import { describe, it, expect } from 'vitest';
import { parsePredecessorInput } from '../predecessorParse.js';

function makeWbsMap() {
  return new Map([
    ['1', 'task-1'],
    ['1.1', 'task-1-1'],
    ['1.2', 'task-1-2'],
    ['2.3', 'task-2-3'],
  ]);
}

describe('parsePredecessorInput', () => {
  it('parses a single WBS with type and lag', () => {
    const { preds, errors } = parsePredecessorInput('1.2FS+2d', makeWbsMap());
    expect(errors).toEqual([]);
    expect(preds).toEqual([
      { predecessor_id: 'task-1-2', type: 'FS', lag_days: 2, lag_hours: 16, is_elapsed: false },
    ]);
  });

  it('parses multiple comma-separated entries', () => {
    const { preds, errors } = parsePredecessorInput('1.1FS, 2.3SS-1d', makeWbsMap());
    expect(errors).toEqual([]);
    expect(preds).toEqual([
      { predecessor_id: 'task-1-1', type: 'FS', lag_days: 0, lag_hours: 0, is_elapsed: false },
      { predecessor_id: 'task-2-3', type: 'SS', lag_days: -1, lag_hours: -8, is_elapsed: false },
    ]);
  });

  it('defaults to FS and zero lag when omitted', () => {
    const { preds, errors } = parsePredecessorInput('1', makeWbsMap());
    expect(errors).toEqual([]);
    expect(preds).toEqual([
      { predecessor_id: 'task-1', type: 'FS', lag_days: 0, lag_hours: 0, is_elapsed: false },
    ]);
  });

  it('accepts lowercase dependency types', () => {
    const { preds, errors } = parsePredecessorInput('1.2ff', makeWbsMap());
    expect(errors).toEqual([]);
    expect(preds[0].type).toBe('FF');
  });

  it('accepts negative lag', () => {
    const { preds, errors } = parsePredecessorInput('1.2SS-3d', makeWbsMap());
    expect(errors).toEqual([]);
    expect(preds[0].lag_days).toBe(-3);
  });

  it('tolerates whitespace around entries and the lag sign', () => {
    const { preds, errors } = parsePredecessorInput(' 1.1 FS + 2 d , 2.3 SS ', makeWbsMap());
    expect(errors).toEqual([]);
    expect(preds).toEqual([
      { predecessor_id: 'task-1-1', type: 'FS', lag_days: 2, lag_hours: 16, is_elapsed: false },
      { predecessor_id: 'task-2-3', type: 'SS', lag_days: 0, lag_hours: 0, is_elapsed: false },
    ]);
  });

  it('reports an error for an unknown WBS and skips it', () => {
    const { preds, errors } = parsePredecessorInput('9.9FS', makeWbsMap());
    expect(preds).toEqual([]);
    expect(errors).toEqual(['No task with WBS "9.9"']);
  });

  it('reports an error for a garbage token and skips it', () => {
    const { preds, errors } = parsePredecessorInput('not-a-wbs', makeWbsMap());
    expect(preds).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it('parses valid entries while reporting errors for invalid ones', () => {
    const { preds, errors } = parsePredecessorInput('1.1FS, garbage, 9.9SS', makeWbsMap());
    expect(preds).toEqual([
      { predecessor_id: 'task-1-1', type: 'FS', lag_days: 0, lag_hours: 0, is_elapsed: false },
    ]);
    expect(errors.length).toBe(2);
  });

  it('returns empty preds and no errors for an empty string', () => {
    expect(parsePredecessorInput('', makeWbsMap())).toEqual({ preds: [], errors: [] });
    expect(parsePredecessorInput('   ', makeWbsMap())).toEqual({ preds: [], errors: [] });
    expect(parsePredecessorInput(null, makeWbsMap())).toEqual({ preds: [], errors: [] });
  });

  it('splits entries on semicolons as well as commas', () => {
    const { preds, errors } = parsePredecessorInput('1.1FS; 2.3SS', makeWbsMap());
    expect(errors).toEqual([]);
    expect(preds.length).toBe(2);
  });
});
