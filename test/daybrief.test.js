import { describe, it, expect } from 'vitest';
import { buildBrief } from '../public/lib/daybrief.js';

const TODAY = '2026-07-01';
const PULSE = {
  goals: [
    { id: 'g1', name: 'Ship it', status: 'active', target_date: '2026-07-10' },
    { id: 'g2', name: 'Stuck', status: 'blocked', target_date: null },
    { id: 'g3', name: 'Also stuck', status: 'Blocked on review', target_date: null },
  ],
  due: [
    { id: 'd1', name: 'Overdue thing', label: 'Idea', sub: 'overdue · 2026-06-20' },
    { id: 'd2', name: 'Today thing', label: 'Goal', sub: 'due · 2026-07-01' },
    { id: 'd3', name: 'Later thing', label: 'Goal', sub: 'due · 2026-07-09' },
  ],
  whatsNew: [
    { name: 'Fresh insight', created_at: '2026-07-01T09:00:00Z' },
    { name: 'Yesterday insight', created_at: '2026-06-30T22:00:00Z' },
    { name: 'Old insight', created_at: '2026-06-01T10:00:00Z' },
  ],
  review: { superseded: [{}], lowConfidence: [{}, {}], orphans: [], aliasDrift: [], protectedFacts: [{}], notes: [{}] },
};

describe('buildBrief — show logic (first open per calendar day)', () => {
  it('shows when there is no recorded brief day', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: null, todayISO: TODAY }).show).toBe(true);
  });
  it('shows on the first open of a new day', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: '2026-06-30', todayISO: TODAY }).show).toBe(true);
  });
  it('suppresses on a same-day reopen', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: TODAY, todayISO: TODAY }).show).toBe(false);
  });
  it('never shows without a today anchor', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: '2026-06-30' }).show).toBe(false);
  });
});

describe('buildBrief — sinceLabel', () => {
  it('yesterday reads as "yesterday"', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: '2026-06-30', todayISO: TODAY }).sinceLabel).toBe('yesterday');
  });
  it('older gaps read as "N days ago"', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: '2026-06-28', todayISO: TODAY }).sinceLabel).toBe('3 days ago');
  });
  it('no recorded visit reads as "your last visit"', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: null, todayISO: TODAY }).sinceLabel).toBe('your last visit');
  });
});

describe('buildBrief — counts from the pulse', () => {
  const b = buildBrief({ pulse: PULSE, lastVisitISO: '2026-06-30', todayISO: TODAY });
  it('newInsights = insights created since the last visit day (all when no last visit)', () => {
    expect(b.counts.newInsights).toBe(2);   // 07-01 + 06-30, not 06-01
    expect(buildBrief({ pulse: PULSE, lastVisitISO: null, todayISO: TODAY }).counts.newInsights).toBe(3);
  });
  it('dueToday = overdue + due-on-today rows from the due lane', () => {
    expect(b.counts.dueToday).toBe(2);      // the overdue one + the due·today one, not 07-09
  });
  it('blocked = goals whose status says blocked (case-insensitive)', () => {
    expect(b.counts.blocked).toBe(2);
  });
  it('needsReview = every review lane summed', () => {
    expect(b.counts.needsReview).toBe(5);   // 1 superseded + 2 lowConfidence + 1 fact + 1 note
  });
  it('an absent or empty pulse counts zeros (never throws)', () => {
    for (const pulse of [undefined, {}, { goals: null, due: null, whatsNew: null, review: null }]) {
      const z = buildBrief({ pulse, lastVisitISO: null, todayISO: TODAY });
      expect(z.counts).toEqual({ newInsights: 0, dueToday: 0, blocked: 0, needsReview: 0 });
    }
  });
});

describe('buildBrief — last focus', () => {
  it('threads the persisted focus name through', () => {
    expect(buildBrief({ pulse: PULSE, lastFocusName: 'Northwind', lastVisitISO: null, todayISO: TODAY }).lastFocusName).toBe('Northwind');
  });
  it('absent lastFocus → null (the card drops the resume action)', () => {
    expect(buildBrief({ pulse: PULSE, lastVisitISO: null, todayISO: TODAY }).lastFocusName).toBe(null);
    expect(buildBrief({ pulse: PULSE, lastFocusName: '', lastVisitISO: null, todayISO: TODAY }).lastFocusName).toBe(null);
  });
});
