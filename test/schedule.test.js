import { describe, it, expect } from 'vitest';
import { SCHEDULE_KINDS, KIND_META, isScheduleKind, isIsoDate, soonestDate,
  RECUR_KINDS, RECUR_META, isRecurKind } from '../public/lib/schedule.js';

// The intention-clock vocab (#25 P2). The closed set of schedulable date kinds the
// server validates and the UI offers.
describe('schedule — kind vocab', () => {
  it('exposes the two P2 kinds with meta', () => {
    expect(SCHEDULE_KINDS).toEqual(['due_at', 'review_at']);
    expect(KIND_META.due_at.cal).toBe('due');
    expect(KIND_META.review_at.cal).toBe('review');
  });
  it('isScheduleKind gates the closed set', () => {
    expect(isScheduleKind('due_at')).toBe(true);
    expect(isScheduleKind('review_at')).toBe(true);
    expect(isScheduleKind('scheduled_for')).toBe(false);   // a later kind, not yet enabled
    expect(isScheduleKind('created_at')).toBe(false);        // record time, not settable here
    expect(isScheduleKind('')).toBe(false);
    expect(isScheduleKind(null)).toBe(false);
  });
});

describe('schedule — date validation + ordering', () => {
  it('isIsoDate accepts YYYY-MM-DD only', () => {
    expect(isIsoDate('2026-09-30')).toBe(true);
    expect(isIsoDate('2026-9-3')).toBe(false);
    expect(isIsoDate('Sept 30')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it('soonestDate returns the earliest valid intention date', () => {
    expect(soonestDate({ due_at: '2026-10-01', review_at: '2026-07-15' })).toBe('2026-07-15');
    expect(soonestDate({ due_at: '2026-10-01' })).toBe('2026-10-01');
    expect(soonestDate({ review_at: 'bad', due_at: '2026-10-01' })).toBe('2026-10-01');
    expect(soonestDate({})).toBe(null);
    expect(soonestDate(null)).toBe(null);
  });
  it('soonestDate can be scoped to specific props', () => {
    expect(soonestDate({ due_at: '2026-10-01', review_at: '2026-07-15' }, ['due_at'])).toBe('2026-10-01');
  });
});

// Recurrence cadence vocab (rank 8) — the closed set of repeat rules a due_at/review_at
// anchor may carry (stored as due_every/review_every), parallel to SCHEDULE_KINDS.
describe('schedule — recurrence vocab', () => {
  it('exposes the six cadences with labels', () => {
    expect(RECUR_KINDS).toEqual(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);
    expect(RECUR_META.weekly.label).toBe('weekly');
    expect(RECUR_META.biweekly.label).toBe('every 2 weeks');
  });
  it('isRecurKind gates the closed set', () => {
    expect(isRecurKind('weekly')).toBe(true);
    expect(isRecurKind('yearly')).toBe(true);
    expect(isRecurKind('due_at')).toBe(false);      // a schedule kind, not a cadence
    expect(isRecurKind('fortnightly')).toBe(false);
    expect(isRecurKind('')).toBe(false);
    expect(isRecurKind(null)).toBe(false);
  });
});
