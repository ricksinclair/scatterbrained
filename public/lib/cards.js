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

// Spacing scheduler — real FSRS (vendored ts-fsrs; ~20-30% fewer reviews than SM-2
// at equal retention, benchmarked on 500M+ Anki reviews — don't hand-roll what the
// settled algorithm does better). grade ∈ {again, hard, good, easy}. `prev` is the
// previous return value (JSON-round-tripped via localStorage) | a legacy SM-2-lite
// state { interval, ease, reps } | undefined. Returns { interval, reps, dueInDays,
// fsrs } — same caller contract as before, with the FSRS card riding along.
import { fsrs, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.mjs';

const DAY_MS = 86400000;
const RATING = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };
const scheduler = fsrs();   // default params, fuzz off — deterministic

// prev → an FSRS card. Three shapes: our own serialized card (dates as epoch-ms),
// a legacy SM-2-lite state (seed stability from its interval so existing review
// history keeps its spacing instead of restarting), or nothing (a new card).
function reviveCard(prev, now) {
  if (prev && prev.fsrs) {
    const c = { ...prev.fsrs, due: new Date(prev.fsrs.due), last_review: prev.fsrs.last_review ? new Date(prev.fsrs.last_review) : undefined };
    return c;
  }
  if (prev && (prev.interval || prev.reps)) {                    // legacy SM-2-lite state
    const interval = Math.max(prev.interval || 0, 0);
    const last = new Date(now - interval * DAY_MS);
    return {
      ...createEmptyCard(last),
      stability: Math.max(interval, 0.5),
      difficulty: 5,
      reps: prev.reps || 1,
      state: State.Review,
      scheduled_days: interval,
      elapsed_days: interval,
      last_review: last,
      due: new Date(now),
    };
  }
  return createEmptyCard(new Date(now));
}

export function nextReview(grade, prev = {}, now = Date.now()) {
  const rating = RATING[grade] ?? Rating.Good;
  const { card } = scheduler.next(reviveCard(prev, now), new Date(now), rating);
  const interval = card.scheduled_days;                          // whole days; 0 = again today (learning step / lapse)
  return {
    interval,
    reps: card.reps,
    dueInDays: interval,
    fsrs: { ...card, due: card.due.getTime(), last_review: card.last_review ? card.last_review.getTime() : undefined },
  };
}

// Is a card due now? `state.dueAt` is an epoch-ms timestamp; no state → due (new).
export function isDue(state, now = 0) { return !state || !state.dueAt || state.dueAt <= now; }
