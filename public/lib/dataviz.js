// Data-viz — pure helpers that turn parsed tabular rows into chart *specs* the generalized
// `chart` registry component renders (Phase 0 of RESEARCH-dataviz.md: hand-rolled SVG/DOM,
// no chart library). A spec is { kind:'bar'|'histogram', title, bars:[{label,value}] }.
import { isNumericColumn } from './csv.js';

const fmt = (n) => (Number.isInteger(n) ? String(n) : Number(n.toFixed(1)).toString());

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
