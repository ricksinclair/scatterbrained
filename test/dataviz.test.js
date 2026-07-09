import { describe, it, expect } from 'vitest';
import { columnValues, histogramSpec, barSpecByCategory, profileColumns, recommendChart, recommendChartFromObjects, lineSvg, scatterSvg } from '../public/lib/dataviz.js';
import { REGISTRY } from '../public/lib/registry.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

describe('columnValues', () => {
  it('extracts finite numbers, tolerating separators and blanks', () => {
    const rows = [['n'], ['1,200'], ['$3'], [''], ['x']];
    expect(columnValues(rows, 0)).toEqual([1200, 3]);
  });
});

describe('histogramSpec', () => {
  it('bins values into a histogram spec', () => {
    const spec = histogramSpec([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5);
    expect(spec.kind).toBe('histogram');
    expect(spec.bars).toHaveLength(5);
    expect(spec.bars.reduce((s, b) => s + b.value, 0)).toBe(10);   // every value counted
  });
  it('handles all-equal values and empties', () => {
    expect(histogramSpec([4, 4, 4]).bars[0].value).toBe(3);
    expect(histogramSpec([])).toBe(null);
  });
});

describe('barSpecByCategory', () => {
  it('sums a numeric column per category, biggest first', () => {
    const rows = [['city', 'n'], ['Durham', '2'], ['Raleigh', '6'], ['Durham', '3']];
    const spec = barSpecByCategory(rows, 0, 1);
    expect(spec.kind).toBe('bar');
    expect(spec.bars).toEqual([{ label: 'Raleigh', value: 6 }, { label: 'Durham', value: 5 }]);
  });
});

describe('profileColumns / recommendChart', () => {
  it('profiles numeric vs categorical columns', () => {
    const rows = [['state', 'coops'], ['NC', '12'], ['CA', '88']];
    expect(profileColumns(rows).map((c) => c.numeric)).toEqual([false, true]);
  });
  it('recommends a bar for category+numeric', () => {
    const rows = [['state', 'coops'], ['NC', '12'], ['CA', '88']];
    const spec = recommendChart(rows);
    expect(spec.kind).toBe('bar');
    expect(spec.bars[0]).toEqual({ label: 'CA', value: 88 });
  });
  it('recommends a histogram when only numeric columns exist', () => {
    const rows = [['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']];
    expect(recommendChart(rows).kind).toBe('histogram');
  });
  it('returns null when nothing is chartable', () => {
    expect(recommendChart([['name'], ['a'], ['b']])).toBe(null);
    expect(recommendChart([['x']])).toBe(null);
  });
});

describe('recommendChartFromObjects', () => {
  it('recommends a bar directly from query-result objects', () => {
    const spec = recommendChartFromObjects([{ status: 'active', n: 5 }, { status: 'done', n: 9 }]);
    expect(spec.kind).toBe('bar');
    expect(spec.bars[0]).toEqual({ label: 'done', value: 9 });
  });
  it('is empty-safe', () => {
    expect(recommendChartFromObjects([])).toBe(null);
  });
});

describe('lineSvg / scatterSvg', () => {
  it('draws a polyline per series with a themed stroke', () => {
    const svg = lineSvg({ title: 'growth', x: ['w1', 'w2', 'w3'], series: [{ name: 'nodes', values: [1, 4, 9] }] });
    expect(svg).toContain('<polyline');
    expect(svg).toContain('stroke="var(--accent)"');
    expect(svg).toContain('ch-title');            // title rendered
  });
  it('handles a flat series without dividing by zero', () => {
    const svg = lineSvg({ x: ['a', 'b'], series: [{ name: 's', values: [5, 5] }] });
    expect(svg).toContain('<polyline');
    expect(svg).not.toContain('NaN');
  });
  it('draws a circle per scatter point with a tooltip', () => {
    const svg = scatterSvg({ points: [{ x: 1, y: 2, label: 'p1' }, { x: 3, y: 4 }] });
    expect((svg.match(/<circle/g) || []).length).toBe(2);
    expect(svg).toContain('p1');
    expect(svg).not.toContain('NaN');
  });
  it('returns empty string for no data', () => {
    expect(lineSvg({ x: [], series: [] })).toBe('');
    expect(scatterSvg({ points: [] })).toBe('');
  });
});

describe('chart component — kind dispatch', () => {
  it('renders vertical columns for kind:histogram', () => {
    const html = REGISTRY.chart.render({}, { chart: { kind: 'histogram', title: 'dist', bars: [{ label: '0–1', value: 3 }, { label: '1–2', value: 5 }] } }, { esc });
    expect(html).toContain('c-histogram');
    expect(html).toContain('hg-col');
    expect(html).toContain('height:');
  });
  it('still renders horizontal bars by default (back-compat)', () => {
    const html = REGISTRY.chart.render({}, { chart: { bars: [{ label: 'ABOUT', value: 10 }] } }, { esc });
    expect(html).toContain('ch-bar');
    expect(html).not.toContain('c-histogram');
  });
  it('dispatches line/scatter to the SVG renderers', () => {
    const line = REGISTRY.chart.render({}, { chart: { kind: 'line', x: ['a', 'b'], series: [{ name: 's', values: [1, 2] }] } }, { esc });
    expect(line).toContain('c-chart-svg');
    expect(line).toContain('<polyline');
    const sc = REGISTRY.chart.render({}, { chart: { kind: 'scatter', points: [{ x: 1, y: 2 }] } }, { esc });
    expect(sc).toContain('<circle');
  });
  it('renders an honest error strip for a failed lens query', () => {
    const html = REGISTRY.chart.render({}, { chart: { error: 'query failed: SyntaxError', title: 'Projects by status' } }, { esc });
    expect(html).toContain('c-chart-err');
    expect(html).toContain('query failed');
    expect(html).toContain('Projects by status');
  });
});
