import { describe, it, expect } from 'vitest';
import { validateChartSpec, rowsToTable, CHART_KINDS } from '../public/lib/chart-spec.js';

describe('validateChartSpec — kinds', () => {
  it('rejects an unknown kind and echoes the allowed set', () => {
    const r = validateChartSpec({ kind: 'pie', bars: [] });
    expect(r.error.code).toBe('unknown_kind');
    expect(r.error.allowed).toEqual(CHART_KINDS);
  });
  it('rejects a non-object spec', () => {
    expect(validateChartSpec(null).error.code).toBe('bad_spec');
    expect(validateChartSpec([]).error.code).toBe('bad_spec');
  });
});

describe('validateChartSpec — bar/histogram', () => {
  it('accepts a well-formed bar spec and clips the title', () => {
    const r = validateChartSpec({ kind: 'bar', title: 'x'.repeat(200), bars: [{ label: 'a', value: 3 }] });
    expect(r.spec.kind).toBe('bar');
    expect(r.spec.title.length).toBe(120);
    expect(r.spec.bars).toEqual([{ label: 'a', value: 3 }]);
  });
  it('rejects a non-finite bar value', () => {
    expect(validateChartSpec({ kind: 'bar', bars: [{ label: 'a', value: 'x' }] }).error.code).toBe('bad_params');
    expect(validateChartSpec({ kind: 'bar', bars: [{ label: 'a', value: Infinity }] }).error.code).toBe('bad_params');
  });
  it('caps bar count', () => {
    const bars = Array.from({ length: 61 }, (_, i) => ({ label: String(i), value: i }));
    expect(validateChartSpec({ kind: 'bar', bars }).error.code).toBe('too_many');
  });
  it('rejects an unknown field', () => {
    expect(validateChartSpec({ kind: 'bar', bars: [{ label: 'a', value: 1 }], color: 'red' }).error.code).toBe('bad_params');
  });
});

describe('validateChartSpec — line', () => {
  it('accepts aligned series', () => {
    const r = validateChartSpec({ kind: 'line', x: ['w1', 'w2'], series: [{ name: 's', values: [1, 2] }] });
    expect(r.spec.series[0].values).toEqual([1, 2]);
  });
  it('rejects a series whose length mismatches x', () => {
    expect(validateChartSpec({ kind: 'line', x: ['a', 'b'], series: [{ name: 's', values: [1] }] }).error.code).toBe('bad_params');
  });
  it('caps series count', () => {
    const series = Array.from({ length: 5 }, (_, i) => ({ name: 's' + i, values: [1] }));
    expect(validateChartSpec({ kind: 'line', x: ['a'], series }).error.code).toBe('too_many');
  });
});

describe('validateChartSpec — scatter', () => {
  it('accepts finite points and preserves labels', () => {
    const r = validateChartSpec({ kind: 'scatter', points: [{ x: 1, y: 2, label: 'p' }], xLabel: 'age' });
    expect(r.spec.points[0]).toEqual({ x: 1, y: 2, label: 'p' });
    expect(r.spec.xLabel).toBe('age');
  });
  it('rejects a non-numeric coordinate', () => {
    expect(validateChartSpec({ kind: 'scatter', points: [{ x: 1, y: 'b' }] }).error.code).toBe('bad_params');
  });
});

describe('rowsToTable', () => {
  it('turns result objects into a header + body table', () => {
    const t = rowsToTable([{ status: 'active', n: 3 }, { status: 'done', n: 7 }]);
    expect(t).toEqual([['status', 'n'], ['active', 3], ['done', 7]]);
  });
  it('is empty-safe and stringifies nested values', () => {
    expect(rowsToTable([])).toEqual([]);
    expect(rowsToTable([{ a: { x: 1 } }])).toEqual([['a'], ['{"x":1}']]);
  });
});
