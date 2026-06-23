// Composable-card layout — the pure, tested core behind drag-to-reorder and resize in
// the report workspace. The app persists one layout per node *type* (label) so that,
// say, every Insight report remembers how you arranged its cards. This module only
// computes the new arrangement; app.js owns the DOM, drag events, and localStorage.

// Parse a stored layout blob defensively → { order: string[], spans: {id: 'wide'|'normal'} }.
export function parseLayout(raw) {
  let o = {};
  try { o = raw ? JSON.parse(raw) : {}; } catch { o = {}; }
  return { order: Array.isArray(o.order) ? o.order : [], spans: o.spans && typeof o.spans === 'object' ? o.spans : {} };
}

// Reorder `parts` (each has an `id`) by the saved `order`. Saved ids that no longer
// exist are skipped; freshly-appearing components (not in `order`) keep their original
// relative position, appended after the known ones — so a new card never vanishes.
export function orderParts(parts, order) {
  if (!Array.isArray(order) || !order.length) return parts.slice();
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out = [];
  for (const id of order) { if (byId.has(id)) { out.push(byId.get(id)); byId.delete(id); } }
  for (const p of parts) { if (byId.has(p.id)) out.push(p); }
  return out;
}

// Move `fromId` to sit immediately before `toId` (or to the end when toId is null/unknown).
// Returns a new id-order array; a no-op move returns an equivalent order.
export function moveBefore(order, fromId, toId) {
  const o = order.filter((id) => id !== fromId);
  if (toId == null) { o.push(fromId); return o; }
  const i = o.indexOf(toId);
  o.splice(i < 0 ? o.length : i, 0, fromId);
  return o;
}

// Flip a card between full-width ('wide') and its grid-default ('normal').
export function toggleSpan(spans, id) {
  const next = { ...spans };
  next[id] = next[id] === 'wide' ? 'normal' : 'wide';
  return next;
}

// Serialize the current visual order + spans for storage.
export function serializeLayout(order, spans) {
  return JSON.stringify({ order, spans: spans || {} });
}
