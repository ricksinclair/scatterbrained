// typeahead.js — pure, DOM-free model for an async fuzzy-association picker (#29).
//
// The foundational graph-editing affordance: each field of a node becomes a
// fuzzy-search typeahead that finds an existing node (or "create new") and wires
// the edge inline. First consumer is the add-link "attach to…" field; designed to
// be reused by the future per-field association editor. No DOM, no network — it
// just shapes /api/search results into a navigable option model. Fully unit-tested.

// Build the option list from raw /api/search results + the current query.
//   results: [{ id, name, label, superseded? }]  (server already ranks by degree)
//   query:   the current input text
//   opts: { max = 8, allowCreate = false, exclude = [] }
// Returns options in display order:
//   { kind:'pick',   id, name, label, superseded }  — attach to an existing node
//   { kind:'create', name }                          — create-new / use-as-typed (when allowCreate + non-empty query)
// De-dupes by id, drops blank names, skips any id in `exclude` (already-picked, for
// multi-select), and (when allowCreate) appends a create row only if no existing pick
// is an exact (case-insensitive) name match for the query.
export function buildOptions(results, query, opts = {}) {
  const { max = 8, allowCreate = false, exclude = [] } = opts;
  const q = (query || '').trim();
  const skip = exclude instanceof Set ? exclude : new Set(exclude);
  const seen = new Set();
  const picks = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r) continue;
    const id = r.id;
    const name = (r.name || '').trim();
    if (!id || !name || seen.has(id) || skip.has(id)) continue;
    seen.add(id);
    // Alias hint: surface "was <former_name>" only when the OLD name is WHY this result
    // matched (query is in former_name but not the current name) — so a search for a
    // renamed node's old name explains itself instead of looking like a fuzzy mismatch.
    const former = (r.former_name || '').trim();
    const ql = q.toLowerCase();
    const alias = !!former && !!ql && former.toLowerCase().includes(ql) && !name.toLowerCase().includes(ql);
    picks.push({ kind: 'pick', id, name, label: r.label || '', superseded: !!r.superseded, ...(alias ? { former } : {}) });
    if (picks.length >= max) break;
  }
  const options = picks;
  if (allowCreate && q) {
    const exact = picks.some((p) => p.name.toLowerCase() === q.toLowerCase());
    if (!exact) options.push({ kind: 'create', name: q });
  }
  return options;
}

// Wrap-around active-index movement for ↑/↓ keys. A length of 0 yields -1 (no
// active row); delta moves and wraps within [0, len). Starting from -1 with +1
// lands on 0 (first), with -1 lands on the last row.
export function nextIndex(len, current, delta) {
  if (!len || len < 1) return -1;
  if (current < 0) return delta > 0 ? 0 : len - 1;
  return ((current + delta) % len + len) % len;
}

// Resolve the option at an index, or null when out of range (e.g. nothing active).
export function optionAt(options, index) {
  if (!Array.isArray(options) || index == null || index < 0 || index >= options.length) return null;
  return options[index];
}
