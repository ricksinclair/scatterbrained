import { describe, it, expect } from 'vitest';
import { buildOptions, nextIndex, optionAt } from '../public/lib/typeahead.js';

describe('typeahead — buildOptions', () => {
  const results = [
    { id: 'a', name: 'Northwind', label: 'Project', superseded: false },
    { id: 'b', name: 'Ship Northwind MVP', label: 'Goal', superseded: false },
    { id: 'c', name: 'Old fact', label: 'Insight', superseded: true },
  ];

  it('maps search results to pick options, preserving server order', () => {
    const opts = buildOptions(results, 'coop');
    expect(opts.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(opts.every((o) => o.kind === 'pick')).toBe(true);
    expect(opts[0]).toMatchObject({ id: 'a', name: 'Northwind', label: 'Project' });
    expect(opts[2].superseded).toBe(true);
  });

  it('de-dupes by id and drops blank/nameless rows', () => {
    const dupes = [...results, { id: 'a', name: 'Northwind' }, { id: 'd', name: '  ' }, null];
    const opts = buildOptions(dupes, 'x');
    expect(opts.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('excludes already-picked ids (multi-select) — array or Set', () => {
    expect(buildOptions(results, 'x', { exclude: ['a'] }).map((o) => o.id)).toEqual(['b', 'c']);
    expect(buildOptions(results, 'x', { exclude: new Set(['a', 'c']) }).map((o) => o.id)).toEqual(['b']);
  });

  it('caps the list at max', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: 'n' + i, name: 'Node ' + i }));
    expect(buildOptions(many, 'node', { max: 5 })).toHaveLength(5);
  });

  it('handles empty / non-array input', () => {
    expect(buildOptions(null, 'q')).toEqual([]);
    expect(buildOptions(undefined, '')).toEqual([]);
    expect(buildOptions([], 'q')).toEqual([]);
  });

  it('appends a create row only when allowCreate and no exact name match', () => {
    const novel = buildOptions(results, 'Brand new thing', { allowCreate: true });
    expect(novel[novel.length - 1]).toEqual({ kind: 'create', name: 'Brand new thing' });

    const exact = buildOptions(results, 'northwind', { allowCreate: true }); // case-insensitive match → no create row
    expect(exact.some((o) => o.kind === 'create')).toBe(false);

    const blank = buildOptions(results, '   ', { allowCreate: true }); // empty query → no create row
    expect(blank.some((o) => o.kind === 'create')).toBe(false);
  });
});

describe('typeahead — nextIndex (wrap-around ↑/↓)', () => {
  it('moves down from inactive (-1) to first, up to last', () => {
    expect(nextIndex(3, -1, 1)).toBe(0);
    expect(nextIndex(3, -1, -1)).toBe(2);
  });

  it('wraps at the ends', () => {
    expect(nextIndex(3, 2, 1)).toBe(0);
    expect(nextIndex(3, 0, -1)).toBe(2);
    expect(nextIndex(3, 1, 1)).toBe(2);
  });

  it('returns -1 for an empty list', () => {
    expect(nextIndex(0, -1, 1)).toBe(-1);
    expect(nextIndex(0, 0, -1)).toBe(-1);
  });
});

describe('typeahead — optionAt', () => {
  const opts = [{ kind: 'pick', id: 'a' }, { kind: 'pick', id: 'b' }];
  it('resolves an in-range index', () => {
    expect(optionAt(opts, 1)).toEqual({ kind: 'pick', id: 'b' });
  });
  it('returns null when nothing active or out of range', () => {
    expect(optionAt(opts, -1)).toBeNull();
    expect(optionAt(opts, 5)).toBeNull();
    expect(optionAt(opts, null)).toBeNull();
    expect(optionAt(null, 0)).toBeNull();
  });
});
