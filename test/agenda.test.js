import { describe, it, expect } from 'vitest';
import { buildAgenda, itemsOnDay, KIND_CHIP, AGENDA_BUCKETS } from '../public/lib/agenda.js';

const NOW = '2026-07-01';
const item = (date, kind, name = 'n', label = 'Goal', id = 'id-' + date + kind) =>
  ({ id, name, label, kind, date });

describe('buildAgenda — bucketing (via groupDigest)', () => {
  it('routes items into overdue / today / week / soon by date', () => {
    const a = buildAgenda([
      item('2026-06-20', 'due'),      // overdue
      item('2026-07-01', 'review'),   // today
      item('2026-07-05', 'target'),   // week (≤7d)
      item('2026-07-20', 'expiry'),   // soon (≤30d)
    ], NOW);
    expect(a.buckets.overdue.map((r) => r.date)).toEqual(['2026-06-20']);
    expect(a.buckets.today.map((r) => r.date)).toEqual(['2026-07-01']);
    expect(a.buckets.week.map((r) => r.date)).toEqual(['2026-07-05']);
    expect(a.buckets.soon.map((r) => r.date)).toEqual(['2026-07-20']);
    expect(a.count).toBe(4);
    expect(a.empty).toBe(false);
  });
  it('drops activity (created) and far-future items — the agenda is intention, now', () => {
    const a = buildAgenda([
      item('2026-07-01', 'created'),   // record time, not intention
      item('2026-12-25', 'due'),       // >30d → later → dropped
    ], NOW);
    expect(a.empty).toBe(true);
    expect(a.count).toBe(0);
  });
  it('sorts each bucket soonest-first (groupDigest ordering preserved)', () => {
    const a = buildAgenda([item('2026-07-06', 'due'), item('2026-07-03', 'due')], NOW);
    expect(a.buckets.week.map((r) => r.date)).toEqual(['2026-07-03', '2026-07-06']);
  });
});

describe('buildAgenda — row building', () => {
  it('maps every calendar kind to its chip', () => {
    expect(KIND_CHIP).toEqual({ due: 'due', review: 'review', target: 'goal', expiry: 'expires' });
    const a = buildAgenda([
      item('2026-07-02', 'due'), item('2026-07-02', 'review'),
      item('2026-07-02', 'target'), item('2026-07-02', 'expiry'),
    ], NOW);
    expect(a.buckets.week.map((r) => r.chip).sort()).toEqual(['due', 'expires', 'goal', 'review']);
  });
  it('carries identity + a relative date label on each row', () => {
    const a = buildAgenda([item('2026-06-28', 'due', 'Ship it', 'Project', 'x1')], NOW);
    const r = a.buckets.overdue[0];
    expect(r).toEqual({
      id: 'x1', name: 'Ship it', label: 'Project', kind: 'due', chip: 'due',
      date: '2026-06-28', dateLabel: '3d overdue', bucket: 'overdue',
    });
    const t = buildAgenda([item('2026-07-01', 'review')], NOW).buckets.today[0];
    expect(t.dateLabel).toBe('today');
  });
  it('tolerates missing name/label without throwing', () => {
    const a = buildAgenda([{ id: 'x', kind: 'due', date: '2026-07-01' }], NOW);
    expect(a.buckets.today[0].name).toBe('');
    expect(a.buckets.today[0].label).toBe('');
  });
});

describe('buildAgenda — empty case', () => {
  it('no items → all buckets empty, empty flag set', () => {
    const a = buildAgenda([], NOW);
    for (const b of AGENDA_BUCKETS) expect(a.buckets[b.key]).toEqual([]);
    expect(a.empty).toBe(true);
  });
  it('undefined items → same safe empty shape', () => {
    expect(buildAgenda(undefined, NOW).empty).toBe(true);
  });
});

describe('itemsOnDay — the mini-month day filter', () => {
  const items = [
    item('2026-07-02', 'due'),
    item('2026-07-02', 'created'),        // activity counts too, unlike the buckets
    item('2026-07-02T14:30:00Z', 'review'), // full timestamp still matches its day
    item('2026-07-03', 'due'),
  ];
  it('keeps every kind (incl. created) dated to that day', () => {
    const day = itemsOnDay(items, '2026-07-02');
    expect(day.map((r) => r.kind).sort()).toEqual(['created', 'due', 'review']);
  });
  it('matches on the YYYY-MM-DD prefix, so timestamps land on their calendar day', () => {
    expect(itemsOnDay(items, '2026-07-02').some((r) => r.kind === 'review')).toBe(true);
  });
  it('a day with nothing → empty', () => {
    expect(itemsOnDay(items, '2026-07-09')).toEqual([]);
  });
  it('no day (cleared filter) → the items unchanged; missing input → safe empty', () => {
    expect(itemsOnDay(items, null)).toBe(items);
    expect(itemsOnDay(undefined, '2026-07-02')).toEqual([]);
  });
});

describe('AGENDA_BUCKETS display meta', () => {
  it('is the four attention buckets in display order, overdue accented', () => {
    expect(AGENDA_BUCKETS.map((b) => b.key)).toEqual(['overdue', 'today', 'week', 'soon']);
    expect(AGENDA_BUCKETS[0].warn).toBe(true);
    for (const b of AGENDA_BUCKETS) expect(typeof b.label).toBe('string');
  });
});
