import { describe, it, expect } from 'vitest';
import { digestBucket, relativeLabel, groupDigest, isEmptyDigest, BUCKET_ORDER } from '../public/lib/digest.js';

// The intention-clock digest (#25 P3, PUSH layer). Pure bucketing of dated items.
const NOW = '2026-06-19';

describe('digest — bucketing', () => {
  it('buckets by day distance from now', () => {
    expect(digestBucket('2026-06-17', NOW)).toBe('overdue');
    expect(digestBucket('2026-06-19', NOW)).toBe('today');
    expect(digestBucket('2026-06-23', NOW)).toBe('week');     // +4d
    expect(digestBucket('2026-06-26', NOW)).toBe('week');     // +7d edge
    expect(digestBucket('2026-06-27', NOW)).toBe('soon');     // +8d
    expect(digestBucket('2026-07-19', NOW)).toBe('soon');     // +30d edge
    expect(digestBucket('2026-07-20', NOW)).toBe('later');    // +31d
  });
  it('returns null for missing / malformed dates', () => {
    expect(digestBucket('', NOW)).toBe(null);
    expect(digestBucket(null, NOW)).toBe(null);
    expect(digestBucket('June 19', NOW)).toBe(null);
    expect(digestBucket('2026-06-19', 'bad')).toBe(null);
  });
});

describe('digest — relative label', () => {
  it('formats today / future / overdue', () => {
    expect(relativeLabel('2026-06-19', NOW)).toBe('today');
    expect(relativeLabel('2026-06-24', NOW)).toBe('in 5d');
    expect(relativeLabel('2026-06-16', NOW)).toBe('3d overdue');
    expect(relativeLabel('', NOW)).toBe('');
  });
});

describe('digest — grouping', () => {
  const items = [
    { id: 'a', name: 'Overdue goal', date: '2026-06-10', kind: 'due' },
    { id: 'b', name: 'Today review', date: '2026-06-19', kind: 'review' },
    { id: 'c', name: 'This week', date: '2026-06-22', kind: 'due' },
    { id: 'd', name: 'Earlier overdue', date: '2026-06-05', kind: 'due' },
    { id: 'e', name: 'Far off', date: '2026-12-01', kind: 'due' },   // later → dropped
    { id: 'f', name: 'No date', kind: 'review' },                    // dropped
  ];
  it('routes items into the actionable buckets, dropping later/undated', () => {
    const g = groupDigest(items, NOW);
    expect(g.overdue.map((x) => x.id)).toEqual(['d', 'a']);   // sorted soonest(=oldest)-first
    expect(g.today.map((x) => x.id)).toEqual(['b']);
    expect(g.week.map((x) => x.id)).toEqual(['c']);
    expect(g.soon).toEqual([]);
    expect(BUCKET_ORDER).toEqual(['overdue', 'today', 'week', 'soon']);
  });
  it('isEmptyDigest detects nothing actionable', () => {
    expect(isEmptyDigest(groupDigest([{ name: 'x', date: '2026-12-01' }], NOW))).toBe(true);
    expect(isEmptyDigest(groupDigest(items, NOW))).toBe(false);
    expect(isEmptyDigest(groupDigest([], NOW))).toBe(true);
  });
});
