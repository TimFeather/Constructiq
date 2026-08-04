import { describe, it, expect } from 'vitest';
import { buildSubmissionPayload, validateManualSubmission, isAfterClose } from '../manualSubmission.js';

describe('buildSubmissionPayload', () => {
  it('drops lines with zero, blank, or negative amounts', () => {
    const { priceLines, lumpSum } = buildSubmissionPayload({
      priceLines: [
        { description: 'Good', amount: 100 },
        { description: 'Zero', amount: 0 },
        { description: 'Blank', amount: '' },
        { description: 'Negative', amount: -5 },
      ],
      files: [],
    });
    expect(priceLines).toEqual([{ description: 'Good', amount: 100 }]);
    expect(lumpSum).toBe(100);
  });

  it('sums totals including decimals', () => {
    const { lumpSum } = buildSubmissionPayload({
      priceLines: [
        { description: 'A', amount: 100.25 },
        { description: 'B', amount: 49.75 },
      ],
      files: [],
    });
    expect(lumpSum).toBe(150);
  });

  it('defaults a blank description to "Item"', () => {
    const { priceLines } = buildSubmissionPayload({
      priceLines: [{ description: '   ', amount: 50 }],
      files: [],
    });
    expect(priceLines[0].description).toBe('Item');
  });

  it('dedupes files by storage_path, keeping the last one', () => {
    const { files } = buildSubmissionPayload({
      priceLines: [],
      files: [
        { storage_path: 'a/1.pdf', file_name: 'first.pdf' },
        { storage_path: 'a/2.pdf', file_name: 'second.pdf' },
        { storage_path: 'a/1.pdf', file_name: 'first-retry.pdf' },
      ],
    });
    expect(files).toHaveLength(2);
    expect(files.find(f => f.storage_path === 'a/1.pdf').file_name).toBe('first-retry.pdf');
  });

  it('defaults receivedAt to today when not supplied', () => {
    const { receivedAt } = buildSubmissionPayload({ priceLines: [], files: [] });
    expect(receivedAt).toBe(new Date().toISOString().split('T')[0]);
  });

  it('carries notifySubcontractor through as a boolean', () => {
    expect(buildSubmissionPayload({ priceLines: [], files: [], notifySubcontractor: true }).notifySubcontractor).toBe(true);
    expect(buildSubmissionPayload({ priceLines: [], files: [] }).notifySubcontractor).toBe(false);
  });
});

describe('validateManualSubmission', () => {
  it('requires a subcontractor', () => {
    expect(validateManualSubmission({ inviteeId: null, priceLines: [{ amount: 100 }] }))
      .toBe('Please select a subcontractor.');
  });

  it('requires a positive total', () => {
    expect(validateManualSubmission({ inviteeId: 'x', priceLines: [{ amount: 0 }] }))
      .toBe('Please enter at least one price.');
    expect(validateManualSubmission({ inviteeId: 'x', priceLines: [] }))
      .toBe('Please enter at least one price.');
  });

  it('blocks save while a file is uploading', () => {
    expect(validateManualSubmission({
      inviteeId: 'x',
      priceLines: [{ amount: 100 }],
      files: [{ status: 'uploading' }],
    })).toBe('Please wait for files to finish uploading.');
  });

  it('blocks save when a file errored', () => {
    expect(validateManualSubmission({
      inviteeId: 'x',
      priceLines: [{ amount: 100 }],
      files: [{ status: 'error' }],
    })).toBe('Some files failed to upload. Retry or remove them before saving.');
  });

  it('passes with a valid subcontractor, price and no bad files', () => {
    expect(validateManualSubmission({
      inviteeId: 'x',
      priceLines: [{ amount: 100 }],
      files: [{ status: 'done' }],
    })).toBeNull();
  });
});

describe('isAfterClose', () => {
  it('is true once received after the +12:00 end-of-day boundary', () => {
    const tender = { status: 'Issued', closing_date: '2026-01-10' };
    expect(isAfterClose(tender, '2026-01-11T00:00:00Z')).toBe(true);
  });

  it('is false right up to the +12:00 end-of-day boundary', () => {
    const tender = { status: 'Issued', closing_date: '2026-01-10' };
    // 2026-01-10T23:59:59+12:00 == 2026-01-10T11:59:59Z
    expect(isAfterClose(tender, '2026-01-10T11:59:00Z')).toBe(false);
  });

  it('is true regardless of closing_date once status is Closed or Cancelled', () => {
    expect(isAfterClose({ status: 'Closed', closing_date: '2099-01-01' })).toBe(true);
    expect(isAfterClose({ status: 'Cancelled', closing_date: '2099-01-01' })).toBe(true);
  });

  it('is false with no closing_date and an open status', () => {
    expect(isAfterClose({ status: 'Issued', closing_date: null })).toBe(false);
  });
});
