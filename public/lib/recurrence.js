// recurrence.js — the recurrence engine (rank 8). Pure, DOM-free, tested.
//
// Expands a recurring intention date (due_at / review_at + a cadence rule from schedule.js's
// RECUR_META) into occurrences, day-granular ISO (YYYY-MM-DD), UTC, deterministic. Occurrences
// are anchor + k·period, k ≥ 0 — ALWAYS anchor-relative (never chained), so a month-end anchor
// re-lands correctly (Feb clamps to 28/29, then March returns to 31).
//
// There is no completion state, so a recurring item's "relevant" occurrence is simply the
// NEXT one on-or-after the reference date (`nextOnOrAfter`). That is why a recurring review is
// never permanently overdue and the Daily Brief never runs dry — the next occurrence always
// exists. Read lenses (agenda/digest/calendar) project against the temporal playhead's date.

import { RECUR_META, isRecurKind, isIsoDate } from './schedule.js';

// Safety cap so a dense cadence over a huge window can never run away.
export const MAX_OCCURRENCES = 500;

const DAY_MS = 86400000;
const dayNum = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY_MS);
const isoFromDayNum = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();  // m0 = 0-based

function addDaysISO(iso, days) { return isoFromDayNum(dayNum(iso) + days); }

// Add whole calendar months to an ISO date, clamping the day into the target month
// (Jan 31 + 1mo → Feb 28). Computed from the ORIGINAL anchor by the caller, so no drift.
function addMonthsClampISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm0 = ((total % 12) + 12) % 12;
  return isoDate(ny, nm0 + 1, Math.min(d, daysInMonth(ny, nm0)));
}

// The k-th occurrence (k ≥ 0) of `anchor` under `rule`, anchor-relative.
function occurrenceAt(anchorISO, meta, k) {
  return meta.unit === 'day'
    ? addDaysISO(anchorISO, k * meta.n)
    : addMonthsClampISO(anchorISO, k * meta.n);
}

// The first occurrence of (anchor, rule) that is on-or-after refISO. null on bad input.
// ISO 'YYYY-MM-DD' strings compare lexicographically = chronologically, so we compare directly.
export function nextOnOrAfter(anchorISO, rule, refISO) {
  if (!isIsoDate(anchorISO) || !isIsoDate(refISO) || !isRecurKind(rule)) return null;
  if (refISO <= anchorISO) return anchorISO;
  const meta = RECUR_META[rule];
  if (meta.unit === 'day') {                       // exact: closed-form k
    const k = Math.ceil((dayNum(refISO) - dayNum(anchorISO)) / meta.n);
    return addDaysISO(anchorISO, k * meta.n);
  }
  let k = 0, occ = anchorISO, guard = 0;           // month: scan up (occurrences monotonic)
  while (occ < refISO && guard++ < 4000) { k++; occ = occurrenceAt(anchorISO, meta, k); }
  return occ;
}

// All occurrences of (anchor, rule) within [fromISO, toISO] inclusive, soonest-first.
// [] on bad input, an inverted range, or a window entirely before the anchor. Capped.
export function occurrencesInRange(anchorISO, rule, fromISO, toISO) {
  if (!isIsoDate(anchorISO) || !isIsoDate(fromISO) || !isIsoDate(toISO) || !isRecurKind(rule)) return [];
  if (toISO < fromISO) return [];
  const out = [];
  let occ = nextOnOrAfter(anchorISO, rule, fromISO);
  let guard = 0;
  while (occ && occ <= toISO && guard++ < MAX_OCCURRENCES) {
    out.push(occ);
    occ = nextOnOrAfter(anchorISO, rule, addDaysISO(occ, 1));   // strictly after the last one
  }
  return out;
}

// The date a lens should read for a scheduled item, given the playhead's `nowISO`:
// a recurring anchor rolls to its next occurrence ≥ now; a plain date passes through.
// null when the anchor isn't a valid date. `rule` may be null/'' (no recurrence).
export function effectiveDate(anchorISO, rule, nowISO) {
  if (!isIsoDate(anchorISO)) return null;
  if (!isRecurKind(rule)) return anchorISO;
  return nextOnOrAfter(anchorISO, rule, isIsoDate(nowISO) ? nowISO : anchorISO);
}

// Human label for a cadence ('' for unknown), reusing schedule.js's single source.
export function recurLabel(rule) {
  return isRecurKind(rule) ? RECUR_META[rule].label : '';
}
