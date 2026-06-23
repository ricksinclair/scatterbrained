import { describe, it, expect } from 'vitest';
import { monthGrid, gridRange, bucketByDay, heatIntensity, stepMonth, monthLabel, isoDate } from '../public/lib/calendar.js';

// Pure date math for the read-only calendar lens (#25 P1).
describe('calendar — month grid', () => {
  it('builds a 6×7 grid aligned to Sunday', () => {
    const g = monthGrid(2026, 6);   // June 2026 — the 1st is a Monday
    expect(g.length).toBe(6);
    expect(g.every((w) => w.length === 7)).toBe(true);
    // June 1 2026 is a Monday → row 0 starts on Sunday May 31
    expect(g[0][0].date).toBe('2026-05-31');
    expect(g[0][0].inMonth).toBe(false);
    expect(g[0][1].date).toBe('2026-06-01');
    expect(g[0][1].inMonth).toBe(true);
  });
  it('marks in-month vs spill-over days', () => {
    const g = monthGrid(2026, 6).flat();
    expect(g.find((c) => c.date === '2026-06-30').inMonth).toBe(true);
    expect(g.find((c) => c.date === '2026-07-01').inMonth).toBe(false);
  });
  it('handles a February correctly (leap + non-leap)', () => {
    expect(monthGrid(2024, 2).flat().some((c) => c.date === '2024-02-29')).toBe(true);   // leap
    expect(monthGrid(2026, 2).flat().some((c) => c.date === '2026-02-29')).toBe(false);  // not
  });
  it('gridRange returns the grid first/last dates', () => {
    expect(gridRange(2026, 6)).toEqual({ from: '2026-05-31', to: '2026-07-11' });
  });
});

describe('calendar — bucketing + heat', () => {
  it('buckets items by day, tolerating full timestamps', () => {
    const b = bucketByDay([
      { date: '2026-06-01', id: 'a' },
      { date: '2026-06-01T09:30:00Z', id: 'b' },
      { date: '2026-06-02', id: 'c' },
      { date: null, id: 'skip' },
    ]);
    expect(b['2026-06-01'].map((x) => x.id)).toEqual(['a', 'b']);
    expect(b['2026-06-02'].map((x) => x.id)).toEqual(['c']);
    expect(Object.keys(b)).toHaveLength(2);
  });
  it('scales heat to 0..4 against the month max', () => {
    expect(heatIntensity(0, 10)).toBe(0);
    expect(heatIntensity(1, 10)).toBe(1);
    expect(heatIntensity(10, 10)).toBe(4);
    expect(heatIntensity(5, 10)).toBe(2);
    expect(heatIntensity(3, 0)).toBe(0);   // no max → no heat
  });
});

describe('calendar — navigation + labels', () => {
  it('steps months and rolls the year', () => {
    expect(stepMonth(2026, 6, 1)).toEqual({ year: 2026, month: 7 });
    expect(stepMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(stepMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(stepMonth(2026, 6, -8)).toEqual({ year: 2025, month: 10 });
  });
  it('labels a month and pads ISO dates', () => {
    expect(monthLabel(2026, 6)).toBe('June 2026');
    expect(isoDate(2026, 3, 5)).toBe('2026-03-05');
  });
});
