import { describe, it, expect } from 'vitest';
import { quarterAxis, parseTimeframe, placeItem, classifyStatus, STATUS_CLASSES } from '../public/lib/roadmap.js';

// Placement + classification for the roadmap/timeline lens (#28). Pure date/status math.
describe('roadmap — quarter axis', () => {
  it('builds the current quarter + N forward', () => {
    const ax = quarterAxis(2026, 6, { fwd: 4 });   // June 2026 → Q2
    expect(ax.length).toBe(5);
    expect(ax[0]).toMatchObject({ key: '2026-Q2', label: 'Q2 2026', isCurrent: true });
    expect(ax[0].startISO).toBe('2026-04-01');
    expect(ax[0].endISO).toBe('2026-06-30');
    expect(ax.map((c) => c.key)).toEqual(['2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1', '2027-Q2']);
  });
  it('rolls the year and supports a past column', () => {
    const ax = quarterAxis(2026, 1, { back: 1, fwd: 1 });   // Jan → Q1
    expect(ax.map((c) => c.key)).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
    expect(ax.find((c) => c.isCurrent).key).toBe('2026-Q1');
  });
});

describe('roadmap — timeframe parsing', () => {
  it('buckets the closed vocab to months', () => {
    expect(parseTimeframe('90_days')).toEqual({ months: 3 });
    expect(parseTimeframe('long_term')).toEqual({ months: 24 });
    expect(parseTimeframe('short_term')).toEqual({ months: 2 });
  });
  it('reads year / year-range strings', () => {
    expect(parseTimeframe('2026')).toEqual({ year: 2026 });
    expect(parseTimeframe('2026-2027')).toEqual({ year: 2026 });
  });
  it('returns null for unparseable / empty', () => {
    expect(parseTimeframe('someday')).toBe(null);
    expect(parseTimeframe('')).toBe(null);
    expect(parseTimeframe(null)).toBe(null);
  });
});

describe('roadmap — placement (date > timeframe > none)', () => {
  const ax = quarterAxis(2026, 6, { fwd: 4 });   // Q2 2026 … Q2 2027
  it('places a real date EXACTLY in its column', () => {
    expect(placeItem({ target_date: '2026-08-15' }, ax, '2026-06-18')).toEqual({ colKey: '2026-Q3', precision: 'exact' });
    expect(placeItem({ due_at: '2026-11-01' }, ax, '2026-06-18')).toEqual({ colKey: '2026-Q4', precision: 'exact' });
  });
  it('target_date wins over due_at', () => {
    expect(placeItem({ target_date: '2026-08-15', due_at: '2027-01-01' }, ax, '2026-06-18').colKey).toBe('2026-Q3');
  });
  it('places an undated item TENTATIVELY by timeframe', () => {
    const p = placeItem({ timeframe: '90_days' }, ax, '2026-06-18');   // +3mo ≈ Sep → Q3
    expect(p).toEqual({ colKey: '2026-Q3', precision: 'tentative' });
  });
  it('clamps a far-future estimate to the last column', () => {
    expect(placeItem({ timeframe: 'long_term' }, ax, '2026-06-18')).toEqual({ colKey: '2027-Q2', precision: 'tentative' });
  });
  it('clamps a past date to the first column', () => {
    expect(placeItem({ target_date: '2020-01-01' }, ax, '2026-06-18')).toEqual({ colKey: '2026-Q2', precision: 'exact' });
  });
  it('UNSCHEDULED when no date and no timeframe', () => {
    expect(placeItem({}, ax, '2026-06-18')).toEqual({ colKey: null, precision: 'unscheduled' });
    expect(placeItem({ timeframe: 'whenever' }, ax, '2026-06-18')).toEqual({ colKey: null, precision: 'unscheduled' });
  });
});

describe('roadmap — status classification', () => {
  it('maps the real free-text statuses onto the closed set', () => {
    expect(classifyStatus('active')).toBe('active');
    expect(classifyStatus('exploring')).toBe('active');
    expect(classifyStatus('implemented')).toBe('done');
    expect(classifyStatus('validated')).toBe('done');
    expect(classifyStatus('deferred')).toBe('blocked');
    expect(classifyStatus('next_up')).toBe('next');
    expect(classifyStatus('planned')).toBe('next');
    expect(classifyStatus('proposed')).toBe('next');
    expect(classifyStatus('open_question')).toBe('idea');
    expect(classifyStatus('')).toBe('idea');
    expect(STATUS_CLASSES).toContain(classifyStatus('whatever'));
  });
});
