import { describe, it, expect } from 'vitest';
import { SCHEDULE_KINDS, KIND_META, isScheduleKind, isIsoDate, soonestDate,
  RECUR_KINDS, RECUR_META, isRecurKind,
  TIME_FIELDS, isHhMm, scheduleSortKey } from '../public/lib/schedule.js';

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

// Time-of-day companions (day view). Additive/optional 'HH:MM' beside each schedule kind,
// closed-set like the cadences — the day view's only new schema.
describe('schedule — time-of-day companions', () => {
  it('TIME_FIELDS maps each schedule kind to its *_time companion', () => {
    expect(TIME_FIELDS).toEqual({ due_at: 'due_time', review_at: 'review_time' });
    // every schedule kind has exactly one companion, and no stray keys
    expect(Object.keys(TIME_FIELDS).sort()).toEqual([...SCHEDULE_KINDS].sort());
  });
  it('isHhMm accepts a strict 24h HH:MM only', () => {
    expect(isHhMm('00:00')).toBe(true);
    expect(isHhMm('09:05')).toBe(true);
    expect(isHhMm('19:00')).toBe(true);
    expect(isHhMm('23:59')).toBe(true);
    expect(isHhMm('24:00')).toBe(false);    // no 24:00
    expect(isHhMm('9:05')).toBe(false);     // needs the leading zero
    expect(isHhMm('19:60')).toBe(false);    // minutes out of range
    expect(isHhMm('19:00:00')).toBe(false); // no seconds
    expect(isHhMm('7pm')).toBe(false);
    expect(isHhMm('')).toBe(false);
    expect(isHhMm(null)).toBe(false);
  });
  it('scheduleSortKey sinks an untimed item to the END of its day', () => {
    // a 9am timed item precedes an untimed one on the SAME day (the whole point — not '00:00')
    expect(scheduleSortKey('2026-07-10', '09:00') < scheduleSortKey('2026-07-10', null)).toBe(true);
    // times order chronologically within the day
    expect(scheduleSortKey('2026-07-10', '09:00') < scheduleSortKey('2026-07-10', '19:00')).toBe(true);
    // a next-day untimed item still sorts after everything today
    expect(scheduleSortKey('2026-07-10', null) < scheduleSortKey('2026-07-11', '00:00')).toBe(true);
    // an invalid time is treated as untimed (end of day)
    expect(scheduleSortKey('2026-07-10', 'garbage')).toBe('2026-07-10T23:59');
    expect(scheduleSortKey('2026-07-10', '19:00')).toBe('2026-07-10T19:00');
  });
});
