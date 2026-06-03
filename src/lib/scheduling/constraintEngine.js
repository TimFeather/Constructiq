/**
 * Constraint Engine
 * Applies MS Project-compatible scheduling constraints
 */

import { parseDate, nextWorkingDay, prevWorkingDay, isWorkingDay } from './calendarEngine.js';

export const CONSTRAINT_TYPES = {
  ASAP:  'ASAP',
  ALAP:  'ALAP',
  MSO:   'MSO',
  MFO:   'MFO',
  SNET:  'SNET',
  SNLT:  'SNLT',
  FNET:  'FNET',
  FNLT:  'FNLT',
};

function addWorkDays(startDate, days, calendar) {
  if (days <= 0) return new Date(startDate);
  let d = new Date(startDate);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, calendar)) added++;
  }
  return d;
}

function subtractWorkDays(endDate, days, calendar) {
  if (days <= 0) return new Date(endDate);
  let d = new Date(endDate);
  let subtracted = 0;
  while (subtracted < days) {
    d.setDate(d.getDate() - 1);
    if (isWorkingDay(d, calendar)) subtracted++;
  }
  return d;
}

/**
 * Apply a forward-pass constraint to an early start/finish pair.
 * Returns adjusted { earlyStart, earlyFinish } or null if no adjustment needed.
 */
export function applyConstraint(constraint, earlyStart, earlyFinish, durationDays, calendar) {
  if (!constraint || !constraint.type || constraint.type === CONSTRAINT_TYPES.ASAP) {
    return null;
  }

  const constraintDate = parseDate(constraint.date);

  switch (constraint.type) {
    case CONSTRAINT_TYPES.MSO: {
      if (!constraintDate) return null;
      const start = nextWorkingDay(constraintDate, calendar);
      const finish = addWorkDays(start, durationDays - 1, calendar);
      return { earlyStart: start, earlyFinish: finish };
    }
    case CONSTRAINT_TYPES.MFO: {
      if (!constraintDate) return null;
      const finish = prevWorkingDay(constraintDate, calendar);
      const start = subtractWorkDays(finish, durationDays - 1, calendar);
      return { earlyStart: start, earlyFinish: finish };
    }
    case CONSTRAINT_TYPES.SNET: {
      if (!constraintDate) return null;
      if (earlyStart < constraintDate) {
        const start = nextWorkingDay(constraintDate, calendar);
        const finish = addWorkDays(start, durationDays - 1, calendar);
        return { earlyStart: start, earlyFinish: finish };
      }
      return null;
    }
    case CONSTRAINT_TYPES.FNET: {
      if (!constraintDate) return null;
      if (earlyFinish < constraintDate) {
        const finish = nextWorkingDay(constraintDate, calendar);
        const start = subtractWorkDays(finish, durationDays - 1, calendar);
        return { earlyStart: start, earlyFinish: finish };
      }
      return null;
    }
    case CONSTRAINT_TYPES.SNLT:
    case CONSTRAINT_TYPES.FNLT:
    case CONSTRAINT_TYPES.ALAP:
    default:
      return null;
  }
}

/**
 * Apply a backward-pass constraint adjustment.
 */
export function applyBackwardConstraint(constraint, lateStart, lateFinish, durationDays, calendar) {
  if (!constraint || !constraint.type) return null;

  const constraintDate = parseDate(constraint.date);

  switch (constraint.type) {
    case CONSTRAINT_TYPES.FNLT: {
      if (!constraintDate || lateFinish <= constraintDate) return null;
      const finish = prevWorkingDay(constraintDate, calendar);
      const start = subtractWorkDays(finish, durationDays - 1, calendar);
      return { lateStart: start, lateFinish: finish };
    }
    case CONSTRAINT_TYPES.SNLT: {
      if (!constraintDate || lateStart <= constraintDate) return null;
      const start = prevWorkingDay(constraintDate, calendar);
      const finish = addWorkDays(start, durationDays - 1, calendar);
      return { lateStart: start, lateFinish: finish };
    }
    case CONSTRAINT_TYPES.MSO: {
      if (!constraintDate) return null;
      const start = nextWorkingDay(constraintDate, calendar);
      const finish = addWorkDays(start, durationDays - 1, calendar);
      return { lateStart: start, lateFinish: finish };
    }
    case CONSTRAINT_TYPES.MFO: {
      if (!constraintDate) return null;
      const finish = prevWorkingDay(constraintDate, calendar);
      const start = subtractWorkDays(finish, durationDays - 1, calendar);
      return { lateStart: start, lateFinish: finish };
    }
    default:
      return null;
  }
}