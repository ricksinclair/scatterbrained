// Identity signals — the single source of truth for "these two nodes are the
// same real-world entity, even if their natural keys differ."
//
// The natural key (name/title) is what MERGE dedupes on. But two sessions can
// pick *different* names for the same thing — "ulrictodman.com" vs
// "Personal Site (ulrictodman.com)" — and MERGE-by-name then guarantees a
// duplicate instead of preventing one. A node's *identity signals* are the
// strong, externally-grounded properties that should be unique to one entity:
// a repo URL, a file path, a Notion id. If two same-label nodes share one of
// these under different keys, that's almost certainly an accidental duplicate.
//
// Used by:
//   • lint-graph.js  — the `likely-duplicate-entity` backstop (graph-wide scan)
//   • add-node.js     — the creation-time guard (does this new node collide?)

// label -> ordered list of properties that strongly identify one real entity.
// Order is cosmetic (it drives report wording, most-specific first).
export const IDENTITY_SIGNALS = {
  Project: ['repo_url', 'notion_url', 'file_path'],
  Source: ['url', 'file_path', 'notion_id'],
  Resource: ['url'],
  Organization: ['url'],
  Person: ['contact_info'],
};

// Every distinct signal property across all labels — handy for query building.
export const ALL_SIGNAL_PROPS = [
  ...new Set(Object.values(IDENTITY_SIGNALS).flat()),
];

// The identity-signal props for a label (empty array if the label has none).
export function signalsFor(label) {
  return IDENTITY_SIGNALS[label] || [];
}

// Given a candidate node's props, return the {prop, value} pairs that are
// usable identity signals for its label (non-empty values only).
export function candidateSignals(label, props = {}) {
  return signalsFor(label)
    .map((prop) => ({ prop, value: props[prop] }))
    .filter(({ value }) => value != null && String(value).trim() !== '');
}

// Normalize a key/alias for loose comparison: trim, lowercase, collapse
// whitespace. Deliberately conservative — we only use this to *warn*, never to
// auto-merge, so a false positive costs a confirmation prompt, not data.
export function normalizeKey(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Do two natural keys look like the same entity? True when one normalized key
// contains the other (e.g. "ulrictodman.com" ⊂ "personal site (ulrictodman.com)")
// and the shorter is non-trivial (guards against everything matching "a").
export function keysLookAlike(a, b, minLen = 4) {
  const x = normalizeKey(a);
  const y = normalizeKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= minLen && long.includes(short);
}
