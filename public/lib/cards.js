// Study cards (M-H) — pure card extraction + a tiny spacing scheduler. The two
// best-verified findings in research/cognitive-foundations.md: the testing effect
// (retrieve before revealing) and spacing (interval grows with successful recall).
// Notes ARE the cards — no separate app — via a lightweight convention. Pure +
// tested; review state lives in the browser (localStorage), never the graph.

// parseCards(text) → [{ front, back, cloze? }]. Conventions, in priority:
//   1. Q:/A: blocks   — `Q: ...` then `A: ...` (A may span lines until the next Q:)
//   2. cloze          — a line with `{{hidden}}` → front masks it, back reveals it
// Returns only complete cards (both sides present).
export function parseCards(text) {
  const lines = String(text || '').split(/\r?\n/);
  const cards = [];
  let cur = null;
  const flush = () => { if (cur && cur.front && cur.back) cards.push(cur); cur = null; };
  for (const ln of lines) {
    const q = ln.match(/^\s*Q:\s*(.+)/i);
    const a = ln.match(/^\s*A:\s*(.+)/i);
    if (q) { flush(); cur = { front: q[1].trim(), back: '' }; }
    else if (a && cur) { cur.back = (cur.back ? cur.back + ' ' : '') + a[1].trim(); }
    else if (cur && cur.back && ln.trim()) { cur.back += ' ' + ln.trim(); }   // A: continuation
  }
  flush();
  if (cards.length) return cards;
  // cloze fallback (only when there are no Q/A cards)
  for (const ln of lines) {
    if (/\{\{.+?\}\}/.test(ln)) {
      cards.push({
        front: ln.replace(/\{\{(.+?)\}\}/g, '[…]').trim(),
        back: ln.replace(/\{\{(.+?)\}\}/g, '$1').trim(),
        cloze: true,
      });
    }
  }
  return cards.filter((c) => c.front && c.back);
}

export function hasCards(text) { return parseCards(text).length > 0; }

// Spacing scheduler — an SM-2-lite/Leitner hybrid. grade ∈ {again, hard, good, easy}.
// `prev` = { interval(days), ease, reps } | undefined. Returns the next state +
// `dueInDays`. Spacing scales with success (Cepeda: no fixed interval). Pure.
const GRADES = { again: 0, hard: 1, good: 2, easy: 3 };
export function nextReview(grade, prev = {}) {
  const g = GRADES[grade] != null ? GRADES[grade] : 2;
  let ease = prev.ease || 2.5;
  let reps = prev.reps || 0;
  let interval = prev.interval || 0;
  ease = Math.max(1.3, ease + (g === 0 ? -0.2 : g === 1 ? -0.05 : g === 3 ? 0.1 : 0));
  if (g === 0) { reps = 0; interval = 0; }                       // lapse → relearn today
  else {
    reps += 1;
    if (reps === 1) interval = g === 3 ? 4 : 1;
    else if (reps === 2) interval = g === 1 ? 3 : 6;
    else interval = Math.round((prev.interval || 1) * (g === 1 ? 1.2 : ease));
  }
  return { interval, ease: Math.round(ease * 100) / 100, reps, dueInDays: interval };
}

// Is a card due now? `state.dueAt` is an epoch-ms timestamp; no state → due (new).
export function isDue(state, now = 0) { return !state || !state.dueAt || state.dueAt <= now; }
