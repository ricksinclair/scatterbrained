// agenda.js — the Agenda view-model (D1). Pure, DOM-free, tested.
//
// Composes /api/calendar items (flat {id, name, label, kind, date} rows) with digest.js's
// tested attention buckets into what the Time lens's Agenda tab renders: four vertical
// buckets (Overdue / Today / This week / Upcoming) of rows, each carrying a kind chip and
// a relative date label. 'created' items are record-time activity (they feed the heatmap
// and sparkline, not the agenda) and anything beyond 30 days is noise — both are dropped,
// exactly as the CLI digest does.

import { groupDigest, relativeLabel, BUCKET_ORDER } from './digest.js';
import { effectiveDate, recurLabel } from './recurrence.js';

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
