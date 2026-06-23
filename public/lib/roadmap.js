// roadmap.js — placement + classification for the roadmap/timeline lens (#28). Pure, tested.
//
// The roadmap is the quarters × goals zoom of the graph. Most goals are UNDATED (no
// target_date, messy free-text timeframe), so placement degrades gracefully: a real date →
// exact column; a parseable timeframe → a TENTATIVE column (ghosted, never written back); else
// the UNSCHEDULED gutter. Honors the "don't fabricate dates" boundary — estimates stay visual.

import { isoDate } from './calendar.js';

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const QEND_DAY = { 3: 31, 6: 30, 9: 30, 12: 31 };   // quarter-end months only

// The current quarter + `fwd` forward (+ optional `back` past). month is 1-indexed.
// Each column: { key:'2026-Q3', label:'Q3 2026', startISO, endISO, isCurrent }.
export function quarterAxis(year, month, { back = 0, fwd = 4 } = {}) {
  const curQ = Math.floor((month - 1) / 3);   // 0..3
  const cols = [];
  for (let i = -back; i <= fwd; i++) {
    const qIdx = curQ + i;
    const y = year + Math.floor(qIdx / 4);
    const q = ((qIdx % 4) + 4) % 4;            // 0..3
    const startM = q * 3 + 1, endM = q * 3 + 3;
    cols.push({
      key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y}`,
      startISO: isoDate(y, startM, 1), endISO: isoDate(y, endM, QEND_DAY[endM]),
      isCurrent: i === 0,
    });
  }
  return cols;
}

// A coarse horizon for an UNDATED item from its free-text timeframe → { months } or { year },
// else null. Buckets the closed vocab + tolerates year / year-range strings ("2026", "2026-2027").
const TF_MONTHS = { '30_days': 1, short_term: 2, '90_days': 3, '1_year': 12, long_term: 24 };
export function parseTimeframe(tf) {
  if (!tf || typeof tf !== 'string') return null;
  const t = tf.trim().toLowerCase();
  if (TF_MONTHS[t] != null) return { months: TF_MONTHS[t] };
  const ym = t.match(/^(20\d{2})/);            // a year or the first year of a range
  return ym ? { year: parseInt(ym[1], 10) } : null;
}

function columnFor(dateISO, axis) {
  return axis.find((c) => dateISO >= c.startISO && dateISO <= c.endISO) || null;
}
// Clamp a date into the visible axis: before → first column, after → last column.
function clampColumn(dateISO, axis) {
  if (!axis.length) return null;
  if (dateISO < axis[0].startISO) return axis[0];
  if (dateISO > axis[axis.length - 1].endISO) return axis[axis.length - 1];
  return columnFor(dateISO, axis) || axis[axis.length - 1];
}
function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// Where an item lands on the axis + how confident: a real target_date/due_at = 'exact',
// a timeframe-derived estimate = 'tentative', nothing = 'unscheduled' (colKey null → gutter).
export function placeItem(item, axis, nowISO) {
  const d = item && (isIso(item.target_date) ? item.target_date : isIso(item.due_at) ? item.due_at : null);
  if (d) { const c = clampColumn(d, axis); return { colKey: c ? c.key : null, precision: 'exact' }; }
  const tf = parseTimeframe(item && item.timeframe);
  if (tf) {
    const approx = tf.year ? `${tf.year}-06-30` : addMonthsISO(nowISO, tf.months);
    const c = clampColumn(approx, axis);
    return { colKey: c ? c.key : null, precision: 'tentative' };
  }
  return { colKey: null, precision: 'unscheduled' };
}

// Map the graph's messy free-text statuses onto a small closed set (→ card colors).
export function classifyStatus(status) {
  const s = String(status || '').toLowerCase();
  if (/(done|complete|achieved|shipped|closed|live|publish|implemented|validated)/.test(s)) return 'done';
  if (/(block|stuck|waiting|stalled|deferred)/.test(s)) return 'blocked';
  if (/(active|in.?progress|exploring|building|wip)/.test(s)) return 'active';
  if (/(next|queued|planned|backlog|todo|proposed|upcoming)/.test(s)) return 'next';
  return 'idea';
}
export const STATUS_CLASSES = ['done', 'active', 'next', 'blocked', 'idea'];
