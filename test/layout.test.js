import { describe, it, expect } from 'vitest';
import { parseLayout, orderParts, moveBefore, toggleSpan, serializeLayout } from '../public/lib/layout.js';

const parts = (ids) => ids.map((id) => ({ id, html: id }));

describe('parseLayout', () => {
  it('returns a normalized shape, tolerating junk', () => {
    expect(parseLayout('')).toEqual({ order: [], spans: {} });
    expect(parseLayout('not json')).toEqual({ order: [], spans: {} });
    expect(parseLayout('{"order":["a"],"spans":{"a":"wide"}}')).toEqual({ order: ['a'], spans: { a: 'wide' } });
    expect(parseLayout('{"order":"bad"}')).toEqual({ order: [], spans: {} });
  });
});

describe('orderParts', () => {
  it('reorders by saved order', () => {
    expect(orderParts(parts(['a', 'b', 'c']), ['c', 'a', 'b']).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
  it('appends new (unsaved) components after the known ones, in original order', () => {
    expect(orderParts(parts(['a', 'b', 'newX', 'newY']), ['b', 'a']).map((p) => p.id)).toEqual(['b', 'a', 'newX', 'newY']);
  });
  it('skips saved ids that no longer exist', () => {
    expect(orderParts(parts(['a', 'b']), ['gone', 'b', 'a']).map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('no saved order → original order', () => {
    expect(orderParts(parts(['a', 'b']), []).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('moveBefore', () => {
  it('moves a card before another', () => {
    expect(moveBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveBefore(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']);
  });
  it('moves to end when target is null', () => {
    expect(moveBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
  });
  it('unknown target → appended at end', () => {
    expect(moveBefore(['a', 'b'], 'a', 'zzz')).toEqual(['b', 'a']);
  });
});

describe('toggleSpan', () => {
  it('flips between wide and normal, immutably', () => {
    const s0 = {};
    const s1 = toggleSpan(s0, 'a');
    expect(s1.a).toBe('wide');
    expect(s0).toEqual({});               // original untouched
    expect(toggleSpan(s1, 'a').a).toBe('normal');
  });
});

describe('serializeLayout', () => {
  it('round-trips through parseLayout', () => {
    const blob = serializeLayout(['b', 'a'], { a: 'wide' });
    expect(parseLayout(blob)).toEqual({ order: ['b', 'a'], spans: { a: 'wide' } });
  });
});
