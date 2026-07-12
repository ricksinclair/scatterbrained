// timestate.js — the shared playhead (temporal-coherence pass, build step 4). Pure, DOM-free,
// tested. THE one date-valued position the whole app "stands on" (DESIGN-temporal §1.1): the
// constellation slider, the Agenda, the Day view and Quarters all read the SAME playhead and each
// can jump it. This module is only the math — app.js keeps the #timebar rendering and the Time
// lens keeps its UI; both compute against these functions so there is one source of "when".
//
//   timeState = { atISO: string|null }   // null = "live" / now; a 'YYYY-MM-DD' = parked in the past
//
// It is deliberately valid_until-unaware here: today's slider is record-time (bornTime) only. L4's
// second axis grows on this seam without re-plumbing the readers (DESIGN-temporal §5).

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// The ISO date every surface reads AS OF: the parked date, or today when live.
export function playheadISO(timeState, todayISO) {
  return timeState && isIso(timeState.atISO) ? timeState.atISO : todayISO;
}

// True when the playhead is at "now" (atISO null/absent) — the timebar's live state.
export function isLive(timeState) {
  return !timeState || timeState.atISO == null;
}

// The constellation slider's tv (0..100) → the ISO date it points at, or null at/above 100 (= live).
// Mirrors app.js's existing selT() linear map in epoch-ms, then takes the UTC calendar day — so the
// published playhead date is exactly the label the timebar already shows. tMax<=tMin (no dated
// nodes yet) → null (nothing to rewind to).
export function sliderToISO(tv, tMin, tMax) {
  if (tv >= 100 || !(tMax > tMin)) return null;
  const ms = tMin + (Math.max(0, tv) / 100) * (tMax - tMin);
  return new Date(ms).toISOString().slice(0, 10);
}

// Inverse: an ISO date → the tv (0..100) that lands the slider on it, clamped. Lets a lens push the
// slider to a named stop (a quarter start, a history version). A date at/after tMax → 100 (live edge);
// before tMin → 0. tMax<=tMin → 100 (nothing to place against).
export function isoToSlider(iso, tMin, tMax) {
  if (!isIso(iso) || !(tMax > tMin)) return 100;
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (!Number.isFinite(ms)) return 100;
  const pct = ((ms - tMin) / (tMax - tMin)) * 100;
  return Math.max(0, Math.min(100, pct));
}
