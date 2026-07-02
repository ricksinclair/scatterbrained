// daybrief.js — the Daily Brief view-model (D3). Pure, DOM-free, tested.
//
// The session-start ritual: on the FIRST open of a calendar day, the dock's resume card
// leads with "Since {when}: N new insights · N due today · N blocked" + jump-back-in
// actions. This module only DECIDES (show?) and COMPOSES (labels + counts) from data the
// client already has — /api/health, /api/pulse, and two localStorage strings
// (scatterbrained.lastBriefDay, scatterbrained.lastFocus). No DOM, no clock: callers pass
// todayISO so it stays deterministic. Dismissing the card stores lastBriefDay = today,
// which is exactly what flips `show` off for the rest of the day.

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dayNum = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000);

// buildBrief({ health?, pulse, lastFocusName?, lastVisitISO?, todayISO }) →
//   { show, sinceLabel, counts: {newInsights, dueToday, blocked, needsReview}, lastFocusName }
export function buildBrief({ health, pulse, lastFocusName, lastVisitISO, todayISO } = {}) {
  void health;   // accepted for symmetry with the dock's data (newest/stale render below the brief)
  const last = isIso(lastVisitISO) ? lastVisitISO : null;
  const show = isIso(todayISO) && last !== todayISO;

  let sinceLabel = 'your last visit';
  if (last && isIso(todayISO)) {
    const d = dayNum(todayISO) - dayNum(last);
    if (d === 1) sinceLabel = 'yesterday';
    else if (d > 1) sinceLabel = `${d} days ago`;
  }

  const p = pulse || {};
  const goals = p.goals || [], due = p.due || [], whatsNew = p.whatsNew || [], rv = p.review || {};
  // insights created on/after the last visit day (day-granular; all of them when unknown)
  const newInsights = whatsNew.filter((w) => {
    const day = String(w.created_at || '').slice(0, 10);
    return !last || (isIso(day) && day >= last);
  }).length;
  // the due lane's sub reads 'overdue · YYYY-MM-DD' | 'due · YYYY-MM-DD' (server QI_DUE)
  const dueToday = due.filter((d) => {
    const sub = String(d.sub || '');
    return /^overdue/.test(sub) || (isIso(todayISO) && sub.endsWith(todayISO));
  }).length;
  const blocked = goals.filter((g) => /blocked/i.test(String(g.status || ''))).length;
  const needsReview = ['superseded', 'lowConfidence', 'orphans', 'aliasDrift', 'protectedFacts', 'notes']
    .reduce((n, k) => n + ((rv[k] || []).length), 0);

  return {
    show,
    sinceLabel,
    counts: { newInsights, dueToday, blocked, needsReview },
    lastFocusName: lastFocusName || null,
  };
}
