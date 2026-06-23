// collapse.js — pure collapse state for inspector sections (UX: stop sections bleeding
// together; the editable attribute section starts collapsed). DOM-free, tested; app.js
// wraps localStorage around it.
//
// The stored value is a flat array of tokens: `id` = explicitly collapsed, `!id` =
// explicitly expanded. A section with neither token falls back to its default — so a
// default-collapsed section (the attribute editor) can be remembered as opened, and a
// default-open section remembered as collapsed, without enumerating every section up front.

export function isCollapsed(stored, id, defaultCollapsed) {
  const s = stored instanceof Set ? stored : new Set(stored || []);
  if (s.has(id)) return true;
  if (s.has('!' + id)) return false;
  return !!defaultCollapsed;
}

// Returns the NEW stored array after flipping `id`'s effective state.
export function toggleCollapsed(stored, id, defaultCollapsed) {
  const willCollapse = !isCollapsed(stored, id, defaultCollapsed);
  const s = new Set(stored || []);
  s.delete(id); s.delete('!' + id);
  s.add(willCollapse ? id : '!' + id);
  return [...s];
}
