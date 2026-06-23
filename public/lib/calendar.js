// calendar.js — pure date math for the read-only calendar lens (#25 P1). DOM-free, tested.
//
// The calendar is a READ lens over the graph's record time (created_at / valid_until) plus
// the new intention date (Goal.target_date). This module only shapes dates into a month
// grid + buckets items by day + scales an activity heatmap — no DOM, no network, no clock
// (callers pass explicit year/month so it stays deterministic).

const pad = (n) => String(n).padStart(2, '0');
export function isoDate(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

// A 6×7 month grid (rows = weeks Sun→Sat), each cell { date:'YYYY-MM-DD', day, inMonth }.
// month is 1-indexed (1 = January). Always 6 rows so the grid height never jumps. Uses UTC
// throughout so a cell's date never drifts by a timezone offset.
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startDow = first.getUTCDay();                 // 0 = Sunday
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - startDow));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(gridStart);
      cur.setUTCDate(gridStart.getUTCDate() + w * 7 + d);
      const y = cur.getUTCFullYear(), m = cur.getUTCMonth() + 1, day = cur.getUTCDate();
      row.push({ date: isoDate(y, m, day), day, inMonth: m === month && y === year });
    }
    weeks.push(row);
  }
  return weeks;
}

// First/last 'YYYY-MM-DD' of a month's grid — the range the server query is scoped to.
export function gridRange(year, month) {
  const g = monthGrid(year, month);
  return { from: g[0][0].date, to: g[5][6].date };
}

// Group dated items by their 'YYYY-MM-DD' day → { date: items[] }. Tolerates a full ISO
// timestamp (slices to the date).
export function bucketByDay(items = []) {
  const out = {};
  for (const it of items) {
    if (!it || !it.date) continue;
    const k = String(it.date).slice(0, 10);
    (out[k] = out[k] || []).push(it);
  }
  return out;
}

// Heat bucket 0..4 for a day's activity count vs the month's busiest day (heatmap shading).
export function heatIntensity(count, max) {
  if (!count || count <= 0 || !max || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

// Step a {year, month} (month 1-indexed) by ±N months, rolling the year correctly.
export function stepMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(year, month) { return `${MONTH_NAMES[month - 1]} ${year}`; }
