// dom.js — tiny shared HTML-string helpers, extracted from app.js (app.js split).
// Pure string functions (no DOM access) so they're unit-testable. app.js imports
// them and keeps threading them into the *-ui modules' deps objects unchanged.

// Escape for BOTH text and quoted-attribute HTML contexts. Quotes are included
// because callers interpolate esc() into quoted attributes (data-*, title, aria-*);
// without &quot; a value containing `"` would break out of the attribute.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
