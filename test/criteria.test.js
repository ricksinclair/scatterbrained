import { describe, it, expect } from 'vitest';
import {
  CRITERION_STATES, VERIFY_STATES, isCriterionState, STALE_DAYS,
  splitCriteria, criterionStatus, criteriaSummary, shapeCriteriaLane, groupCriteriaByAnchor,
} from '../public/lib/criteria.js';
import { STATE_LABEL, NOTE_CYCLE_STATES } from '../public/lib/docnotes.js';

const DAY = 86400000;
const NOW = Date.parse('2026-07-03T12:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

describe('criterion state vocabulary (criterion 2 — closed tokens, one source)', () => {
  it('extends the shared Note.state vocab — every criterion state is a real note state', () => {
    for (const s of CRITERION_STATES) expect(STATE_LABEL[s], s).toBeTruthy();
    expect(CRITERION_STATES).toEqual(['unverified', 'pass', 'fail']);
  });
  it('is disjoint from the inbox cycle — a criterion can never be cycled silently', () => {
    for (const s of CRITERION_STATES) expect(NOTE_CYCLE_STATES).not.toContain(s);
  });
  it('isCriterionState accepts only the closed set', () => {
    expect(isCriterionState('pass')).toBe(true);
    expect(isCriterionState('fail')).toBe(true);
    expect(isCriterionState('unverified')).toBe(true);
    expect(isCriterionState('raw')).toBe(false);
    expect(isCriterionState('verified')).toBe(false);
  });
  it('a verification event may only record pass or fail (unverified is the birth state)', () => {
    expect(VERIFY_STATES).toEqual(['pass', 'fail']);
  });
});

describe('splitCriteria (notes vs criteria — never double-listed)', () => {
  it('routes criterion notes out of the inbox', () => {
    const notes = [
      { id: 'a', anchor_kind: 'node', text: 'todo' },
      { id: 'b', anchor_kind: 'criterion', text: 'export < 2s' },
      { id: 'c', text: 'bare' },
    ];
    const { criteria, rest } = splitCriteria(notes);
    expect(criteria.map((n) => n.id)).toEqual(['b']);
    expect(rest.map((n) => n.id)).toEqual(['a', 'c']);
  });
  it('tolerates empty / missing input', () => {
    expect(splitCriteria()).toEqual({ criteria: [], rest: [] });
    expect(splitCriteria(null)).toEqual({ criteria: [], rest: [] });
  });
});

describe('criterionStatus — staleness math (criterion 4)', () => {
  it('fail and unverified pass through', () => {
    expect(criterionStatus({ state: 'fail' }, NOW)).toBe('fail');
    expect(criterionStatus({ state: 'unverified' }, NOW)).toBe('unverified');
  });
  it('an unknown/missing state reads as unverified (never invents a verdict)', () => {
    expect(criterionStatus({ state: 'raw' }, NOW)).toBe('unverified');
    expect(criterionStatus({}, NOW)).toBe('unverified');
  });
  it(`a fresh pass is pass; older than STALE_DAYS (${STALE_DAYS}d) is stale`, () => {
    expect(criterionStatus({ state: 'pass', last_verified_at: iso(1) }, NOW)).toBe('pass');
    expect(criterionStatus({ state: 'pass', last_verified_at: iso(STALE_DAYS - 1) }, NOW)).toBe('pass');
    expect(criterionStatus({ state: 'pass', last_verified_at: iso(STALE_DAYS + 1) }, NOW)).toBe('stale');
  });
  it('a pass with no parseable last_verified_at is stale (never trust an undated verdict)', () => {
    expect(criterionStatus({ state: 'pass' }, NOW)).toBe('stale');
    expect(criterionStatus({ state: 'pass', last_verified_at: 'garbage' }, NOW)).toBe('stale');
  });
});

describe('criteriaSummary', () => {
  it('counts by effective status', () => {
    const s = criteriaSummary([
      { state: 'pass', last_verified_at: iso(2) },
      { state: 'pass', last_verified_at: iso(30) },
      { state: 'fail', last_verified_at: iso(1) },
      { state: 'unverified' },
    ], NOW);
    expect(s).toEqual({ total: 4, pass: 1, stale: 1, fail: 1, unverified: 1 });
  });
});

describe('shapeCriteriaLane — the needs-review dock lane (criterion 4)', () => {
  const rowsIn = [
    { id: 'p-fresh', state: 'pass', last_verified_at: iso(2), anchor_name: 'A' },
    { id: 'p-stale', state: 'pass', last_verified_at: iso(40), anchor_name: 'B' },
    { id: 'f1', state: 'fail', last_verified_at: iso(1), anchor_name: 'C' },
    { id: 'u1', state: 'unverified', anchor_name: 'D' },
  ];
  it('keeps only regressed (fail) and stale (pass beyond the threshold)', () => {
    const out = shapeCriteriaLane(rowsIn, NOW);
    expect(out.map((r) => r.id).sort()).toEqual(['f1', 'p-stale']);
  });
  it('fail leads, then stalest-first; annotates each row with its status', () => {
    const out = shapeCriteriaLane(rowsIn, NOW);
    expect(out[0].id).toBe('f1');
    expect(out[0].status).toBe('fail');
    expect(out[1].status).toBe('stale');
  });
  it('caps the lane', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: 'f' + i, state: 'fail' }));
    expect(shapeCriteriaLane(many, NOW, 20)).toHaveLength(20);
  });
});

describe('groupCriteriaByAnchor — the review-lens checklist shaping (criterion 5)', () => {
  it('groups by anchor and orders each group fail → stale → unverified → pass', () => {
    const rows = [
      { id: '1', anchor_id: 'i1', anchor_name: 'Idea One', state: 'pass', last_verified_at: iso(1) },
      { id: '2', anchor_id: 'i1', anchor_name: 'Idea One', state: 'fail' },
      { id: '3', anchor_id: 'i1', anchor_name: 'Idea One', state: 'unverified' },
      { id: '4', anchor_id: 'i2', anchor_name: 'Another Idea', state: 'pass', last_verified_at: iso(60) },
    ];
    const groups = groupCriteriaByAnchor(rows, NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0].anchor_name).toBe('Another Idea');           // alphabetical groups
    expect(groups[0].items[0].status).toBe('stale');
    expect(groups[1].items.map((c) => c.status)).toEqual(['fail', 'unverified', 'pass']);
  });
  it('empty in, empty out', () => {
    expect(groupCriteriaByAnchor([], NOW)).toEqual([]);
  });
});
