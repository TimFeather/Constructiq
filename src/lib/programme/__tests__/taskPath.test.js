import { describe, it, expect } from 'vitest';
import { groupPathLabels, taskPathLabel } from '../taskPath.js';

const task = (id, name, parent_id = null, project_id = 'p1') => ({ id, name, parent_id, project_id });

// Shaped like the live Kainga Ora programmes: one job-name wrapper, buildings
// under it, stages under those, and site works grouped by unit one level lower.
const KO = [
  task('root', 'Kainga Ora - Template'),
  task('site', 'SITE WORKS - INTERNAL', 'root'),
  task('site-u45', 'UNITS 4 & 5', 'site'),
  task('boxing', 'Boxing to all paths & patios', 'site-u45'),
  task('u45', 'TWO-STOREY, 2 BED DUPLEX, UNITS 4 & 5', 'root'),
  task('u45-struct', 'STRUCTURE', 'u45'),
  task('u45-frame', 'Frame install', 'u45-struct'),
  task('u8', 'TWO-STOREY, 2 BED STAND-ALONE UNIT 8', 'root'),
  task('u8-struct', 'STRUCTURE', 'u8'),
  task('u8-frame', 'Frame install', 'u8-struct'),
  task('handover', 'Handover', 'root'),
];

describe('groupPathLabels', () => {
  it('names the building and stage, leaving out the lone job-name wrapper', () => {
    const labels = groupPathLabels(KO);
    expect(labels.get('u45-frame')).toBe('TWO-STOREY, 2 BED DUPLEX, UNITS 4 & 5 › STRUCTURE');
    expect(labels.get('u8-frame')).toBe('TWO-STOREY, 2 BED STAND-ALONE UNIT 8 › STRUCTURE');
    expect(labels.get('boxing')).toBe('SITE WORKS - INTERNAL › UNITS 4 & 5');
  });

  it('gives no label to tasks that sit straight under the wrapper, or to the wrapper itself', () => {
    const labels = groupPathLabels(KO);
    expect(labels.has('handover')).toBe(false);
    expect(labels.has('u45')).toBe(false);
    expect(labels.has('root')).toBe(false);
  });

  it('still drops the wrapper when a loose milestone sits beside it at the top', () => {
    const labels = groupPathLabels([...KO, task('pc', 'Practical completion')]);
    expect(labels.get('u8-frame')).toBe('TWO-STOREY, 2 BED STAND-ALONE UNIT 8 › STRUCTURE');
    expect(labels.has('pc')).toBe(false);
  });

  it('keeps the top level when a programme has more than one top-level group', () => {
    const labels = groupPathLabels([
      task('k', 'Burrows Kitchen reno'),
      task('k1', 'Demolition', 'k'),
      task('b', 'Burrows bathroom renovations'),
      task('b1', 'Demolition', 'b'),
    ]);
    expect(labels.get('k1')).toBe('Burrows Kitchen reno');
    expect(labels.get('b1')).toBe('Burrows bathroom renovations');
  });

  it('decides the wrapper per project when several projects are listed together', () => {
    const other = [
      task('k', 'Kitchen', null, 'p2'),
      task('k1', 'Demolition', 'k', 'p2'),
      task('b', 'Bathroom', null, 'p2'),
      task('b1', 'Tiling', 'b', 'p2'),
    ];
    const labels = groupPathLabels([...KO, ...other]);
    expect(labels.get('u45-frame')).toBe('TWO-STOREY, 2 BED DUPLEX, UNITS 4 & 5 › STRUCTURE');
    expect(labels.get('k1')).toBe('Kitchen');
    expect(labels.get('b1')).toBe('Bathroom');
  });

  it('keeps what it found when a parent is missing from the list', () => {
    const labels = groupPathLabels([
      task('struct', 'STRUCTURE', 'not-loaded'),
      task('frame', 'Frame install', 'struct'),
    ]);
    expect(labels.get('frame')).toBe('STRUCTURE');
  });
});

describe('taskPathLabel', () => {
  it('lists every group above a task, wrapper included', () => {
    const byId = new Map(KO.map(t => [t.id, t]));
    expect(taskPathLabel(byId.get('u8-frame'), byId))
      .toBe('Kainga Ora - Template › TWO-STOREY, 2 BED STAND-ALONE UNIT 8 › STRUCTURE');
  });
});
