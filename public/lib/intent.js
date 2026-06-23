// Intent parser for the command/search bar — turns a typed phrase into a known
// INTENT (a curated graph query) or falls back to plain node search. Closed set,
// pure, tested. The 2026 "intent-based navigation" pattern: the bar answers
// questions ("what's blocked", "what changed", "what's due") as result sets, not
// just name matches. Keyword rules, first match wins; order = specificity.
const RULES = [
  { kind: 'blocked', re: /\b(blocked|stuck|waiting|stalled|can'?t (start|proceed))\b/i, label: 'Blocked' },
  { kind: 'review',  re: /\b(needs? review|review|superseded|stale|outdated|low.?conf(idence)?|orphan|untrusted)\b/i, label: 'Needs review' },
  { kind: 'due',     re: /\b(due|revisit|resurface|aging|forgot(ten)?|remind|haven'?t touched|cold)\b/i, label: 'Due to revisit' },
  { kind: 'new',     re: /\b(what'?s new|changed|recent(ly)?|latest|new\b|fresh|this week)\b/i, label: 'Recently changed' },
  { kind: 'next',    re: /\b(next|to.?do|queued|backlog|what should i (work on|do)|planned|upcoming)\b/i, label: 'Next up' },
  { kind: 'goals',   re: /\b(goals?|objectives?|targets?|what am i working toward)\b/i, label: 'Goals' },
];

// The intents the bar advertises (for hint chips / help).
export const INTENTS = RULES.map((r) => ({ kind: r.kind, label: r.label }));

// parseIntent(query) → { kind, term, label }. kind 'search' = fall back to node
// search (term carries the query). A recognized intent strips to kind only.
export function parseIntent(query) {
  const q = String(query || '').trim();
  if (!q) return { kind: 'search', term: '', label: '' };
  for (const r of RULES) {
    if (r.re.test(q)) return { kind: r.kind, term: '', label: r.label };
  }
  return { kind: 'search', term: q, label: 'Search' };
}

export const INTENT_KINDS = RULES.map((r) => r.kind).concat('search');
export function isIntentKind(k) { return INTENT_KINDS.includes(k); }
