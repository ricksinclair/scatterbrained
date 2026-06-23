// digest.js — the intention-clock digest (#25 P3, the PUSH layer). Pure, DOM-free, tested.
//
// Buckets dated items (due_at / review_at / Goal.target_date) into what-needs-attention
// groups so the CLI digest + the resume brief can ping "what's due / overdue / to review"
// out-of-app. Day-granular ISO dates; an explicit `nowISO` keeps it deterministic.

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayNum = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);

// Which attention bucket a date falls in, relative to `nowISO`. null = no/invalid date.
//   overdue (<today) · today (==today) · week (≤7d) · soon (≤30d) · later (>30d)
export function digestBucket(dateISO, nowISO) {
  if (!isIso(dateISO) || !isIso(nowISO)) return null;
  const d = dayNum(dateISO) - dayNum(nowISO);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'week';
  if (d <= 30) return 'soon';
  return 'later';
}

// Relative day label: 'today' / 'in 5d' / '3d overdue' (ISO sibling of registry's dueLabel).
export function relativeLabel(dateISO, nowISO) {
  if (!isIso(dateISO) || !isIso(nowISO)) return '';
  const d = dayNum(dateISO) - dayNum(nowISO);
  if (d === 0) return 'today';
  return d < 0 ? `${-d}d overdue` : `in ${d}d`;
}

// The digest's actionable buckets, in display order (drops 'later').
export const BUCKET_ORDER = ['overdue', 'today', 'week', 'soon'];
export const BUCKET_META = {
  overdue: { label: 'Overdue', emoji: '⚠️' },
  today: { label: 'Due today', emoji: '📌' },
  week: { label: 'Due this week', emoji: '📅' },
  soon: { label: 'Upcoming', emoji: '🗓' },
};

// Group dated items → { overdue, today, week, soon }, each sorted soonest-first. Items beyond
// 30 days (or undated) are dropped — the digest is what needs attention now, not everything.
// Each item keeps its shape (expects at least { date }); typically { id, name, label, kind, date }.
export function groupDigest(items = [], nowISO) {
  const out = { overdue: [], today: [], week: [], soon: [] };
  for (const it of items) {
    const b = it && digestBucket(it.date, nowISO);
    if (b && out[b]) out[b].push(it);
  }
  for (const b of BUCKET_ORDER) out[b].sort((a, z) => String(a.date).localeCompare(z.date));
  return out;
}

// True when a grouped digest has nothing actionable.
export function isEmptyDigest(grouped) {
  return BUCKET_ORDER.every((b) => !grouped[b] || grouped[b].length === 0);
}
