// Data-viz — pure helpers that turn parsed tabular rows into chart *specs* the generalized
// `chart` registry component renders (Phase 0 of RESEARCH-dataviz.md: hand-rolled SVG/DOM,
// no chart library). A spec is { kind:'bar'|'histogram', title, bars:[{label,value}] }.
import { isNumericColumn } from './csv.js';
import { rowsToTable } from './chart-spec.js';

const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(1)).toString());
const svgEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// series palette — CSS vars so both modes theme correctly (mirrors registry.js LABEL_HUE intent).
const SERIES_COLORS = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--ink-dim)'];

// Finite numeric values from a column's body rows (tolerates thousands/currency/percent).
export function columnValues(rows, col) {
  return rows.slice(1)
    .map((r) => String(r[col] ?? '').replace(/[,$%\s]/g, ''))
    .filter((s) => s !== '')                         // skip blanks (don't coerce '' → 0)
    .map(Number)
    .filter((v) => Number.isFinite(v));
}

// Bin numeric values into a histogram spec (vertical-column chart of counts).
export function histogramSpec(values, binCount = 10, title = '') {
  if (!values.length) return null;
  const min = Math.min(...values), max = Math.max(...values);
  if (min === max) return { kind: 'histogram', title, bars: [{ label: fmt(min), value: values.length }] };
  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, () => 0);
  for (const v of values) { let i = Math.floor((v - min) / width); if (i >= binCount) i = binCount - 1; if (i < 0) i = 0; bins[i]++; }
  const bars = bins.map((c, i) => ({ label: `${fmt(min + i * width)}–${fmt(min + (i + 1) * width)}`, value: c }));
  return { kind: 'histogram', title, bars };
}

// Aggregate (sum) a numeric column by a category column → bar spec, biggest first.
export function barSpecByCategory(rows, catCol, valCol, title = '') {
  const agg = new Map();
  for (const r of rows.slice(1)) {
    const k = String(r[catCol] ?? '');
    const v = Number(String(r[valCol] ?? '').replace(/[,$%\s]/g, '')) || 0;
    agg.set(k, (agg.get(k) || 0) + v);
  }
  const bars = [...agg].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  return { kind: 'bar', title, bars };
}

// Profile columns: which are numeric, by header. Drives the picker + recommendation.
export function profileColumns(rows) {
  const header = rows[0] || [];
  return header.map((name, i) => ({ index: i, name, numeric: isNumericColumn(rows, i) }));
}

// Pick a sensible default chart from parsed rows (header + body):
//   category + numeric → bar (first numeric summed by first category)
//   numeric only        → histogram of the first numeric column
//   otherwise           → null (nothing chartable)
export function recommendChart(rows) {
  if (!rows || rows.length < 2) return null;
  const cols = profileColumns(rows);
  const numCols = cols.filter((c) => c.numeric);
  const catCols = cols.filter((c) => !c.numeric);
  if (catCols.length && numCols.length) {
    return barSpecByCategory(rows, catCols[0].index, numCols[0].index, `${numCols[0].name} by ${catCols[0].name}`);
  }
  if (numCols.length) {
    return histogramSpec(columnValues(rows, numCols[0].index), 10, `distribution of ${numCols[0].name}`);
  }
  return null;
}

// Recommend a chart directly from query-result OBJECTS (the voice agent's query_graph rows) —
// rowsToTable + the existing heuristic. The deterministic default when the agent gives no spec.
export function recommendChartFromObjects(objRows) {
  return recommendChart(rowsToTable(objRows));
}

// ── pure SVG renderers (spec) -> svgString — the line/scatter kinds the DOM bar/histogram
// path can't express. Fixed viewBox, width:100% via CSS; CSS-var themed so light+dark both work. ──
const VB_W = 320, VB_H = 180, PAD_L = 34, PAD_R = 8, PAD_T = 10, PAD_B = 22;
const plotW = VB_W - PAD_L - PAD_R, plotH = VB_H - PAD_T - PAD_B;
const round2 = (n) => Math.round(n * 100) / 100;

// line: { x:[…labels], series:[{name, values:[…]}] } — one polyline per series over a shared x.
export function lineSvg(spec = {}) {
  const x = spec.x || [], series = spec.series || [];
  if (!x.length || !series.length) return '';
  const all = series.flatMap((s) => s.values || []).filter((v) => Number.isFinite(v));
  if (!all.length) return '';
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { max = min + 1; min = min - 1; }                 // flat series → padded band
  const px = (i) => PAD_L + (x.length === 1 ? plotW / 2 : (i / (x.length - 1)) * plotW);
  const py = (v) => PAD_T + (1 - (v - min) / (max - min)) * plotH;
  const lines = series.map((s, si) => {
    const color = SERIES_COLORS[si % SERIES_COLORS.length];
    const pts = (s.values || []).map((v, i) => `${round2(px(i))},${round2(py(v))}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const legend = series.length > 1
    ? series.map((s, si) => `<tspan fill="${SERIES_COLORS[si % SERIES_COLORS.length]}">■ ${svgEsc(s.name || 's' + (si + 1))}  </tspan>`).join('')
    : '';
  return baseSvg(spec.title, min, max, x, lines, legend);
}

// scatter: { points:[{x,y,label?}], xLabel?, yLabel? }
export function scatterSvg(spec = {}) {
  const pts = (spec.points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!pts.length) return '';
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  let xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (xmin === xmax) { xmax = xmin + 1; xmin -= 1; }
  if (ymin === ymax) { ymax = ymin + 1; ymin -= 1; }
  const px = (v) => PAD_L + ((v - xmin) / (xmax - xmin)) * plotW;
  const py = (v) => PAD_T + (1 - (v - ymin) / (ymax - ymin)) * plotH;
  const dots = pts.map((p) => `<circle cx="${round2(px(p.x))}" cy="${round2(py(p.y))}" r="2.4" fill="var(--accent)"><title>${svgEsc(p.label != null ? p.label + ': ' : '')}${fmt(p.x)}, ${fmt(p.y)}</title></circle>`).join('');
  const axes = `<text x="${PAD_L}" y="${VB_H - 6}" class="dv-ax">${svgEsc(spec.xLabel || fmt(xmin))}</text>` +
    `<text x="${VB_W - PAD_R}" y="${VB_H - 6}" text-anchor="end" class="dv-ax">${svgEsc(spec.xLabel ? fmt(xmax) : fmt(xmax))}</text>`;
  return baseSvg(spec.title, ymin, ymax, null, dots, '', axes);
}

// Shared frame: baseline + y min/max ticks + optional x tick labels + a title/legend line.
function baseSvg(title, ymin, ymax, xLabels, body, legend = '', extra = '') {
  const yTick = (v, y) => `<text x="${PAD_L - 4}" y="${round2(y) + 3}" text-anchor="end" class="dv-ax">${fmt(v)}</text>`;
  const xticks = xLabels ? xLabels.map((l, i) => {
    if (xLabels.length > 8 && i % Math.ceil(xLabels.length / 8) !== 0 && i !== xLabels.length - 1) return '';
    const xp = PAD_L + (xLabels.length === 1 ? plotW / 2 : (i / (xLabels.length - 1)) * plotW);
    return `<text x="${round2(xp)}" y="${VB_H - 8}" text-anchor="middle" class="dv-ax">${svgEsc(l)}</text>`;
  }).join('') : '';
  const titleHtml = title ? `<div class="ch-title">${svgEsc(title)}</div>` : '';
  const legendHtml = legend ? `<div class="dv-legend"><svg viewBox="0 0 320 14" class="dv-legend-svg"><text x="0" y="11" class="dv-ax">${legend}</text></svg></div>` : '';
  return `${titleHtml}<svg class="dv-svg" viewBox="0 0 ${VB_W} ${VB_H}" role="img" preserveAspectRatio="xMidYMid meet">` +
    `<line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${PAD_T + plotH}" class="dv-axis"/>` +
    `<line x1="${PAD_L}" y1="${PAD_T + plotH}" x2="${VB_W - PAD_R}" y2="${PAD_T + plotH}" class="dv-axis"/>` +
    `${yTick(ymax, PAD_T)}${yTick(ymin, PAD_T + plotH)}${xticks}${extra}${body}</svg>${legendHtml}`;
}
