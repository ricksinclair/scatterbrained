import { describe, it, expect } from 'vitest';
import { statusText, lensActive, computeDoi, placeLabels, neighborhoodLayout, smartLabel } from '../public/lib/graph.js';

describe('smartLabel', () => {
  it('shows the basename for path-like names so siblings stop colliding', () => {
    expect(smartLabel('Open Organization/states/alabama.md', 26)).toBe('alabama.md');
    expect(smartLabel('Open Organization/states/alabama.md', 26))
      .not.toBe(smartLabel('Open Organization/states/wyoming.md', 26));   // distinguishable now
  });
  it('keeps both ends (middle ellipsis) for long tail-distinguished names', () => {
    const a = smartLabel('Northwind — Partner Code Issue with the union', 22);
    const b = smartLabel('Northwind — Research: Regulation', 22);
    expect(a).toContain('…');
    expect(a).not.toBe(b);
    expect(a.startsWith('Northwind')).toBe(true);
    expect(a.length).toBeLessThanOrEqual(22);
  });
  it('passes short names through untouched', () => {
    expect(smartLabel('Northwind', 26)).toBe('Northwind');
    expect(smartLabel('', 26)).toBe('');
  });
});

describe('neighborhoodLayout — radial 1-hop placement', () => {
  it('places n items evenly on the circle starting at 12 o\'clock', () => {
    const out = neighborhoodLayout([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], { cx: 0, cy: 0, radius: 10 });
    expect(out.length).toBe(4);
    expect(out[0].x).toBeCloseTo(0, 5);     // top
    expect(out[0].y).toBeCloseTo(-10, 5);
    expect(out[1].x).toBeCloseTo(10, 5);    // right (quarter turn)
    expect(out[0].id).toBe('a');            // originals preserved
  });
  it('returns empty for no items', () => {
    expect(neighborhoodLayout([])).toEqual([]);
  });
});

describe('placeLabels — overlap-free label declutter', () => {
  const box = (id, x, y, extra = {}) => ({ id, x, y, w: 10, h: 4, priority: 0, ...extra });
  it('drops a label that overlaps a higher-priority one', () => {
    const shown = placeLabels([
      box('a', 0, 0, { priority: 10 }),
      box('b', 2, 1, { priority: 5 }),   // overlaps a's box
    ]);
    expect(shown.has('a')).toBe(true);
    expect(shown.has('b')).toBe(false);
  });
  it('keeps non-overlapping labels', () => {
    const shown = placeLabels([box('a', 0, 0), box('b', 100, 100)]);
    expect(shown.has('a')).toBe(true);
    expect(shown.has('b')).toBe(true);
  });
  it('forced labels always render even when overlapping', () => {
    const shown = placeLabels([
      box('a', 0, 0, { priority: 10 }),
      box('b', 1, 0, { priority: 1, forced: true }),
    ]);
    expect(shown.has('a')).toBe(true);
    expect(shown.has('b')).toBe(true);
  });
  it('respects maxLabels for non-forced labels', () => {
    const cand = Array.from({ length: 10 }, (_, i) => box('n' + i, i * 100, 0, { priority: -i }));
    const shown = placeLabels(cand, { maxLabels: 3 });
    expect(shown.size).toBe(3);
    expect(shown.has('n0')).toBe(true);   // highest priority kept
  });
});

describe('statusText', () => {
  it('reports superseded with the successor', () => {
    expect(statusText({ superseded: true, superseded_by: 'X' })).toBe('superseded → X');
    expect(statusText({ superseded: true })).toBe('superseded → newer memory');
  });
  it('reports orphan when degree is 0', () => {
    expect(statusText({ degree: 0 })).toBe('orphan — no edges');
  });
  it('reports indexed vs plain valid', () => {
    expect(statusText({ degree: 3, embeddable: true })).toBe('valid · indexed');
    expect(statusText({ degree: 3 })).toBe('valid');
  });
});

describe('lensActive', () => {
  const n = { label: 'Insight', stale: false };
  it('passes everything under the "all" lens', () => {
    expect(lensActive(n, 'all')).toBe(true);
  });
  it('matches by label', () => {
    expect(lensActive(n, 'Insight')).toBe(true);
    expect(lensActive(n, 'Rule')).toBe(false);
  });
  it('matches stale under the needs-review lens', () => {
    expect(lensActive({ stale: true }, 'stale')).toBe(true);
    expect(lensActive({ stale: false }, 'stale')).toBe(false);
  });
});

describe('computeDoi (degree-of-interest focus)', () => {
  // a — b — c ;  a — d
  const adj = { a: ['b', 'd'], b: ['a', 'c'], c: ['b'], d: ['a'] };
  const get = (id) => adj[id] || [];
  const doi = computeDoi('a', get);
  it('weights the focus node 1', () => { expect(doi.a).toBe(1); });
  it('weights 1-hop neighbors 0.95', () => { expect(doi.b).toBe(0.95); expect(doi.d).toBe(0.95); });
  it('weights 2-hop neighbors 0.3', () => { expect(doi.c).toBe(0.3); });
  it('does not downgrade a 1-hop that is also reachable at 2 hops', () => {
    // a is 2-hop-reachable from itself via b→a, but must stay 1 (focus)
    expect(doi.a).toBe(1);
  });
});
