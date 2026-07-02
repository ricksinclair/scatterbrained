// agenda.js — the Agenda view-model (D1). Pure, DOM-free, tested.
//
// Composes /api/calendar items (flat {id, name, label, kind, date} rows) with digest.js's
// tested attention buckets into what the Time lens's Agenda tab renders: four vertical
// buckets (Overdue / Today / This week / Upcoming) of rows, each carrying a kind chip and
// a relative date label. 'created' items are record-time activity (they feed the heatmap
// and sparkline, not the agenda) and anything beyond 30 days is noise — both are dropped,
// exactly as the CLI digest does.

import { groupDigest, relativeLabel, BUCKET_ORDER } from './digest.js';

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
// row = { id, name, label, kind, chip, date, dateLabel, bucket }; soonest-first per bucket.
export function buildAgenda(items = [], nowISO) {
  const dated = (items || []).filter((it) => it && KIND_CHIP[it.kind]);
  const grouped = groupDigest(dated, nowISO);
  const buckets = {};
  let count = 0;
  for (const b of BUCKET_ORDER) {
    buckets[b] = (grouped[b] || []).map((it) => ({
      id: it.id, name: it.name || '', label: it.label || '',
      kind: it.kind, chip: KIND_CHIP[it.kind],
      date: it.date, dateLabel: relativeLabel(it.date, nowISO), bucket: b,
    }));
    count += buckets[b].length;
  }
  return { buckets, count, empty: count === 0 };
}
