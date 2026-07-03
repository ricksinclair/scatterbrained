// schedule.js — the intention-clock vocab (#25 P2). Pure, DOM-free, tested. The single
// source for the schedulable date kinds, shared by the server (validation), the inspector
// Schedule section, the calendar, and the agenda — same closed-vocab discipline as vocab.js.
//
// Intention time = when a node is DUE or due to be REVIEWED (distinct from record time:
// created_at/valid_until). Day-granular ISO dates (YYYY-MM-DD), like Goal.target_date.

export const KIND_META = {
  due_at:    { label: 'Due',    cal: 'due',    verb: 'due' },        // a deadline
  review_at: { label: 'Review', cal: 'review', verb: 'review' },     // revisit / spaced recall
};
export const SCHEDULE_KINDS = Object.keys(KIND_META);

export function isScheduleKind(k) {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(KIND_META, k);
}

// Recurrence cadences (rank 8) — the closed set of repeat rules a due_at/review_at anchor
// may carry, stored beside it as due_every / review_every (additive, optional). A closed
// vocab, same discipline as SCHEDULE_KINDS and vocab.js's source_kind — deliberately NOT
// an RRULE parser (a handful of cadences cover "review monthly / weekly check-in"). Each
// carries { label, unit, n } for the pure recurrence engine: day-based cadences advance by
// `n` days, month-based by `n` calendar months (recurrence.js does the clamping).
export const RECUR_META = {
  daily:     { label: 'daily',         unit: 'day',   n: 1 },
  weekly:    { label: 'weekly',        unit: 'day',   n: 7 },
  biweekly:  { label: 'every 2 weeks', unit: 'day',   n: 14 },
  monthly:   { label: 'monthly',       unit: 'month', n: 1 },
  quarterly: { label: 'quarterly',     unit: 'month', n: 3 },
  yearly:    { label: 'yearly',        unit: 'month', n: 12 },
};
export const RECUR_KINDS = Object.keys(RECUR_META);

export function isRecurKind(r) {
  return typeof r === 'string' && Object.prototype.hasOwnProperty.call(RECUR_META, r);
}

// A YYYY-MM-DD string (the only format the setter accepts; '' clears).
export function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// The soonest intention date on a node (for agenda ordering), considering the given props.
// `node` carries date strings; returns the earliest 'YYYY-MM-DD' or null.
export function soonestDate(node, props = SCHEDULE_KINDS) {
  if (!node) return null;
  const ds = props.map((p) => node[p]).filter(isIsoDate).sort();
  return ds.length ? ds[0] : null;
}
