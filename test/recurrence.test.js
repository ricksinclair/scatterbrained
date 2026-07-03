import { describe, it, expect } from 'vitest';
import {
  nextOnOrAfter, occurrencesInRange, effectiveDate, recurLabel, MAX_OCCURRENCES,
} from '../public/lib/recurrence.js';

// Recurrence engine (rank 8). Pure, day-granular ISO date math over the closed cadence
// vocab in schedule.js. Occurrences are anchor + k·period, k ≥ 0 — no completion state,
// so a recurring item's "relevant" occurrence is simply the next one on-or-after the
// reference date (why a recurring review is never permanently overdue and the Brief never
// runs dry). All UTC, deterministic (callers pass every date), 2026 is NOT a leap year.

describe('recurrence — nextOnOrAfter (day-based cadences)', () => {
  it('returns the anchor when ref is on or before it', () => {
    expect(nextOnOrAfter('2026-06-01', 'weekly', '2026-06-01')).toBe('2026-06-01');
    expect(nextOnOrAfter('2026-06-01', 'weekly', '2026-05-15')).toBe('2026-06-01');
  });
  it('rolls weekly forward to the next occurrence', () => {
    expect(nextOnOrAfter('2026-06-01', 'weekly', '2026-06-02')).toBe('2026-06-08');
    expect(nextOnOrAfter('2026-06-01', 'weekly', '2026-06-08')).toBe('2026-06-08');  // lands on one
    expect(nextOnOrAfter('2026-06-01', 'weekly', '2026-06-09')).toBe('2026-06-15');
  });
  it('handles daily and biweekly', () => {
    expect(nextOnOrAfter('2026-06-01', 'daily', '2026-06-10')).toBe('2026-06-10');
    expect(nextOnOrAfter('2026-06-01', 'biweekly', '2026-06-02')).toBe('2026-06-15');
    expect(nextOnOrAfter('2026-06-01', 'biweekly', '2026-06-15')).toBe('2026-06-15');
  });
});

describe('recurrence — nextOnOrAfter (month-based cadences, end-of-month clamp)', () => {
  it('clamps a month-end anchor into shorter months, anchor-relative', () => {
    expect(nextOnOrAfter('2026-01-31', 'monthly', '2026-02-01')).toBe('2026-02-28');  // Feb 2026 = 28d
    expect(nextOnOrAfter('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');  // anchor-relative, not chained
    expect(nextOnOrAfter('2026-01-31', 'monthly', '2026-04-01')).toBe('2026-04-30');
  });
  it('handles a mid-month monthly/quarterly/yearly', () => {
    expect(nextOnOrAfter('2026-01-15', 'monthly', '2026-04-10')).toBe('2026-04-15');
    expect(nextOnOrAfter('2026-01-15', 'quarterly', '2026-02-01')).toBe('2026-04-15');
    expect(nextOnOrAfter('2026-02-28', 'yearly', '2027-01-01')).toBe('2027-02-28');
  });
  it('anchor-relative yearly re-lands on Feb 29 in a later leap year (no chained drift)', () => {
    // anchor 2028-02-29 (leap). +1yr clamps to 2029-02-28; +4yr lands back on 2032-02-29.
    expect(nextOnOrAfter('2028-02-29', 'yearly', '2029-01-01')).toBe('2029-02-28');
    expect(nextOnOrAfter('2028-02-29', 'yearly', '2032-02-01')).toBe('2032-02-29');
  });
});

describe('recurrence — invalid inputs return null', () => {
  it('rejects a bad rule or bad date', () => {
    expect(nextOnOrAfter('2026-06-01', 'fortnightly', '2026-06-05')).toBe(null);
    expect(nextOnOrAfter('2026-06-01', 'due_at', '2026-06-05')).toBe(null);   // a schedule kind, not a cadence
    expect(nextOnOrAfter('bad', 'weekly', '2026-06-05')).toBe(null);
    expect(nextOnOrAfter('2026-06-01', 'weekly', 'bad')).toBe(null);
    expect(nextOnOrAfter('2026-06-01', null, '2026-06-05')).toBe(null);
  });
});

describe('recurrence — occurrencesInRange', () => {
  it('lists weekly occurrences within the window (inclusive)', () => {
    expect(occurrencesInRange('2026-06-01', 'weekly', '2026-06-01', '2026-06-30'))
      .toEqual(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']);
  });
  it('starts at the first occurrence on-or-after `from` when the anchor precedes the window', () => {
    expect(occurrencesInRange('2026-06-10', 'weekly', '2026-06-01', '2026-06-30'))
      .toEqual(['2026-06-10', '2026-06-17', '2026-06-24']);
  });
  it('is empty when the whole window precedes the anchor, or is inverted', () => {
    expect(occurrencesInRange('2026-06-10', 'weekly', '2026-05-01', '2026-05-31')).toEqual([]);
    expect(occurrencesInRange('2026-06-01', 'weekly', '2026-06-30', '2026-06-01')).toEqual([]);
  });
  it('clamps month-ends across a monthly span', () => {
    expect(occurrencesInRange('2026-01-31', 'monthly', '2026-01-01', '2026-04-30'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('caps a dense cadence over a huge range (never runs away)', () => {
    const out = occurrencesInRange('2026-01-01', 'daily', '2026-01-01', '2100-01-01');
    expect(out.length).toBe(MAX_OCCURRENCES);
    expect(out[0]).toBe('2026-01-01');
  });
  it('returns [] on a bad rule', () => {
    expect(occurrencesInRange('2026-06-01', 'nope', '2026-06-01', '2026-06-30')).toEqual([]);
  });
});

describe('recurrence — effectiveDate (the lens projection helper)', () => {
  it('rolls a recurring anchor to its next occurrence ≥ now', () => {
    expect(effectiveDate('2026-06-01', 'weekly', '2026-06-10')).toBe('2026-06-15');
  });
  it('passes a non-recurring date through unchanged', () => {
    expect(effectiveDate('2026-06-01', null, '2026-06-10')).toBe('2026-06-01');
    expect(effectiveDate('2026-06-01', '', '2026-06-10')).toBe('2026-06-01');
  });
  it('returns null for an invalid anchor', () => {
    expect(effectiveDate('bad', 'weekly', '2026-06-10')).toBe(null);
    expect(effectiveDate('bad', null, '2026-06-10')).toBe(null);
  });
});

describe('recurrence — recurLabel', () => {
  it('labels known cadences and blanks unknown ones', () => {
    expect(recurLabel('weekly')).toBe('weekly');
    expect(recurLabel('biweekly')).toBe('every 2 weeks');
    expect(recurLabel('quarterly')).toBe('quarterly');
    expect(recurLabel('nope')).toBe('');
    expect(recurLabel(null)).toBe('');
  });
});
