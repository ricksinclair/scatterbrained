// agenda.js — the Agenda view-model (D1). Pure, DOM-free, tested.
//
// Composes /api/calendar items (flat {id, name, label, kind, date} rows) with digest.js's
// tested attention buckets into what the Time lens's Agenda tab renders: four vertical
// buckets (Overdue / Today / This week / Upcoming) of rows, each carrying a kind chip and
// a relative date label. 'created' items are record-time activity (they feed the heatmap
// and sparkline, not the agenda) and anything beyond 30 days is noise — both are dropped,
// exactly as the CLI digest does.

import { groupDigest, relativeLabel, BUCKET_ORDER } from './digest.js';
import { effectiveDate, recurLabel, occurrencesInRange } from './recurrence.js';
import { isHhMm } from './schedule.js';

// calendar kind → the chip the row wears. Closed set = the agenda's intention kinds;
// anything else (created) is filtered out before bucketing.
export const KIND_CHIP = { due: 'due', review: 'review', target: 'goal', expiry: 'expires' };

// Display meta for the four buckets, in order. `warn` accents Overdue.
export const AGENDA_BUCKETS = [
  { key: 'overdue', label: 'Overdue', warn: true },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'soon', label: 'Upcoming' },
];

// itemsOnDay(items, dayISO) → the calendar items whose date falls on dayISO.
// The mini-month day-click filter: any row (due/review/goal/expiry AND created activity)
// dated to that day. Pure; date compared on its YYYY-MM-DD prefix so a full timestamp
// still matches its calendar day.
export function itemsOnDay(items = [], dayISO) {
  if (!dayISO) return items || [];
  return (items || []).filter((it) => it && String(it.date).slice(0, 10) === dayISO);
}

// buildAgenda(items, nowISO) → { buckets: {overdue|today|week|soon: rows[]}, count, empty }
// row = { id, name, label, kind, chip, date, dateLabel, bucket, recur? }; soonest-first.
// `nowISO` is the temporal playhead's date — pass a past date and you get the agenda AS OF
// then (the design's keystone flow). Recurring items (rank 8: it.recur is a cadence token)
// are projected to their NEXT occurrence on-or-after nowISO before bucketing, so a recurring
// review rolls forward instead of sitting permanently overdue. Its cadence label rides along
// on the row (present only when it recurs, so plain rows keep their shape).
export function buildAgenda(items = [], nowISO) {
  const projected = (items || [])
    .filter((it) => it && KIND_CHIP[it.kind])
    .map((it) => {
      const eff = effectiveDate(it.date, it.recur, nowISO);
      return eff ? { ...it, date: eff } : null;   // unparseable anchor → drop (same as before)
    })
    .filter(Boolean);
  const grouped = groupDigest(projected, nowISO);
  const buckets = {};
  let count = 0;
  for (const b of BUCKET_ORDER) {
    buckets[b] = (grouped[b] || []).map((it) => {
      const row = {
        id: it.id, name: it.name || '', label: it.label || '',
        kind: it.kind, chip: KIND_CHIP[it.kind],
        date: it.date, dateLabel: relativeLabel(it.date, nowISO), bucket: b,
      };
      const rl = recurLabel(it.recur);
      if (rl) row.recur = rl;
      return row;
    });
    count += buckets[b].length;
  }
  return { buckets, count, empty: count === 0 };
}

// ── Day view (the hour-scoped zoom of Agenda) ──────────────────────────────────
// A plain-English hour label for a 0–23 hour: 0→'12 AM', 9→'9 AM', 12→'12 PM', 19→'7 PM'.
export function hourLabel(h) {
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
}

// dayView(items, dateISO, nowISO) → the one-day hour rail.
//   { date, isToday, slots: [{ hour, label, rows[] }], untimed: rows[], count, empty }
// `items` are /api/calendar rows ({id, name, label, kind, date, recur?, time?}). Only intention
// kinds (KIND_CHIP: due/review/goal/expiry) are placed — 'created' record-time activity is noise,
// dropped exactly as the buckets do. An item lands on `dateISO` if its date is that day, OR — for a
// recurring anchor (it.recur) — an occurrence falls on that day (expanded by the pure recurrence
// engine, so a weekly review shows on its occurrence day, not just its anchor day).
// Timed items (due_time/review_time, an 'HH:MM') group under their hour, soonest-first; untimed
// items sink into a "sometime today" tray (they don't pretend to be due at midnight). `nowISO` is
// the playhead's date — it only sets `isToday`, so the rail can mark the current day.
export function dayView(items = [], dateISO, nowISO) {
  const day = String(dateISO || '').slice(0, 10);
  const onDay = (items || []).filter((it) => {
    if (!it || !KIND_CHIP[it.kind]) return false;
    if (it.recur) return occurrencesInRange(it.date, it.recur, day, day).length > 0;
    return String(it.date).slice(0, 10) === day;
  });
  const slotsByHour = new Map();     // hour → rows[]
  const untimed = [];
  for (const it of onDay) {
    const time = isHhMm(it.time) ? it.time : null;
    const row = {
      id: it.id, name: it.name || '', label: it.label || '',
      kind: it.kind, chip: KIND_CHIP[it.kind], time,
    };
    if (time) {
      const hour = Number(time.slice(0, 2));
      if (!slotsByHour.has(hour)) slotsByHour.set(hour, []);
      slotsByHour.get(hour).push(row);
    } else {
      untimed.push(row);
    }
  }
  const slots = [...slotsByHour.keys()].sort((a, z) => a - z).map((hour) => ({
    hour, label: hourLabel(hour),
    rows: slotsByHour.get(hour).sort((a, z) => a.time.localeCompare(z.time)),
  }));
  const timedCount = slots.reduce((n, s) => n + s.rows.length, 0);
  const count = timedCount + untimed.length;
  return {
    date: day,
    isToday: !!day && day === String(nowISO || '').slice(0, 10),
    slots, untimed, count, empty: count === 0,
  };
}
