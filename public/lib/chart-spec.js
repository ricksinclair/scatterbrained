// chart-spec.js — the CLOSED, validated chart-spec contract (VOICE Phase B). The voice agent (and
// a saved Lens) composes a SPEC, never HTML — the same injection-safety posture as validatePanel:
// unknown kinds/fields are rejected and the error echoes the legal values so the agent self-corrects.
// Pure: no IO. The `chart` registry component + the SVG renderers in dataviz.js consume the output.
//
//   bar / histogram : { kind, title?, bars:[{label, value}] }        (existing renderer shape)
//   line            : { kind, title?, x:[…], series:[{name, values:[…]}] }   (≤4 series, aligned to x)
//   scatter         : { kind, title?, points:[{x, y, label?}], xLabel?, yLabel? }  (≤MAX_POINTS)

export const CHART_KINDS = ['bar', 'histogram', 'line', 'scatter'];
const MAX_BARS = 60, MAX_SERIES = 4, MAX_POINTS = 500, MAX_TITLE = 120, MAX_LABEL = 80;

const err = (code, message, allowed) => ({ error: { code, message, ...(allowed ? { allowed } : {}) } });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

// validateChartSpec(raw) → { spec: normalized } | { error: {code, message, allowed?} }
export function validateChartSpec(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err('bad_spec', 'chart spec must be an object');
  const kind = raw.kind;
  if (!CHART_KINDS.includes(kind)) return err('unknown_kind', `chart kind must be one of: ${CHART_KINDS.join(', ')}`, CHART_KINDS);
  const spec = { kind };
  if (raw.title != null) {
    if (typeof raw.title !== 'string') return err('bad_params', 'title must be a string');
    spec.title = clip(raw.title, MAX_TITLE);
  }

  let legal;
  if (kind === 'bar' || kind === 'histogram') {
    if (!Array.isArray(raw.bars) || !raw.bars.length) return err('bad_params', `${kind} needs a non-empty bars:[{label,value}]`);
    if (raw.bars.length > MAX_BARS) return err('too_many', `bars capped at ${MAX_BARS}`);
    const bars = [];
    for (const b of raw.bars) {
      if (!b || typeof b !== 'object' || !isNum(b.value)) return err('bad_params', 'each bar needs a finite numeric value');
      bars.push({ label: clip(b.label, MAX_LABEL), value: b.value });
    }
    spec.bars = bars;
    legal = ['kind', 'title', 'bars'];
  } else if (kind === 'line') {
    if (!Array.isArray(raw.x) || !raw.x.length) return err('bad_params', 'line needs an x:[…] axis');
    if (!Array.isArray(raw.series) || !raw.series.length) return err('bad_params', 'line needs series:[{name,values:[…]}]');
    if (raw.series.length > MAX_SERIES) return err('too_many', `series capped at ${MAX_SERIES}`);
    const series = [];
    for (const s of raw.series) {
      if (!s || typeof s !== 'object' || !Array.isArray(s.values)) return err('bad_params', 'each series needs values:[…]');
      if (s.values.length !== raw.x.length) return err('bad_params', 'each series values length must match x length');
      if (!s.values.every(isNum)) return err('bad_params', 'series values must be finite numbers');
      series.push({ name: clip(s.name, MAX_LABEL), values: s.values.slice() });
    }
    spec.x = raw.x.map((v) => clip(v, MAX_LABEL));
    spec.series = series;
    legal = ['kind', 'title', 'x', 'series'];
  } else { // scatter
    if (!Array.isArray(raw.points) || !raw.points.length) return err('bad_params', 'scatter needs points:[{x,y}]');
    if (raw.points.length > MAX_POINTS) return err('too_many', `points capped at ${MAX_POINTS}`);
    const points = [];
    for (const p of raw.points) {
      if (!p || typeof p !== 'object' || !isNum(p.x) || !isNum(p.y)) return err('bad_params', 'each point needs finite numeric x and y');
      points.push({ x: p.x, y: p.y, ...(p.label != null ? { label: clip(p.label, MAX_LABEL) } : {}) });
    }
    spec.points = points;
    if (raw.xLabel != null) spec.xLabel = clip(raw.xLabel, MAX_LABEL);
    if (raw.yLabel != null) spec.yLabel = clip(raw.yLabel, MAX_LABEL);
    legal = ['kind', 'title', 'points', 'xLabel', 'yLabel'];
  }

  const allowed = new Set(legal);
  const unknown = Object.keys(raw).filter((k) => !allowed.has(k));
  if (unknown.length) return err('bad_params', `unknown field(s) for ${kind}: ${unknown.join(', ')}`);
  return { spec };
}

// rowsToTable(objRows) → [[header],[…body]] — Cypher/query result objects into the header+rows
// shape dataviz.js expects (recommendChart, columnValues). Keys of the first row define columns.
export function rowsToTable(objRows = []) {
  if (!Array.isArray(objRows) || !objRows.length) return [];
  const header = Object.keys(objRows[0]);
  const body = objRows.map((r) => header.map((k) => {
    const v = r == null ? '' : r[k];
    return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v);
  }));
  return [header, ...body];
}
