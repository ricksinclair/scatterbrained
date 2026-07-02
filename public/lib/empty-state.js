// empty-state.js — the ONE designed empty/error state (D2). Pure → HTML string, tested.
//
// Every bare "nothing here" / "not found" in the app renders through this: a constellation
// motif (currentColor dots joined by hairlines — the brand, in the theme's ink) above a
// Fraunces one-liner, an optional body, and at most one action. Actions with a `cmd`
// dispatch through the command registry — ONE delegated `.es-action[data-cmd]` listener in
// app.js — so an empty state can do anything the palette can, with no per-state wiring.
// An action without a cmd renders a plain button for the caller to wire (e.g. a retry);
// an `href` action renders a safe external link. Styling: the `.empty-state` block in
// styles.css (theme vars only; compact inside dock sections / inspector components).

import { esc } from './dom.js';

// 6 dots + hairlines, all currentColor — inherits whatever ink the context sets.
const MOTIF = '<svg class="es-motif" viewBox="0 0 120 72" width="96" height="58" aria-hidden="true">' +
  '<g stroke="currentColor" stroke-width="0.8" opacity="0.35" fill="none">' +
  '<path d="M18 46L44 22"/><path d="M44 22L74 34"/><path d="M74 34L102 18"/>' +
  '<path d="M44 22L58 58"/><path d="M74 34L58 58"/><path d="M18 46L58 58"/></g>' +
  '<g fill="currentColor"><circle cx="18" cy="46" r="3.4" opacity="0.8"/><circle cx="44" cy="22" r="4"/>' +
  '<circle cx="74" cy="34" r="3" opacity="0.7"/><circle cx="102" cy="18" r="2.4" opacity="0.5"/>' +
  '<circle cx="58" cy="58" r="4.4" opacity="0.9"/><circle cx="96" cy="56" r="2" opacity="0.4"/></g></svg>';

// emptyState({ icon?, title, body?, action?: {label, cmd? | href?} }) → HTML string.
export function emptyState({ icon, title, body, action } = {}) {
  const mark = icon ? `<span class="es-icon" aria-hidden="true">${esc(icon)}</span>` : MOTIF;
  let act = '';
  if (action && action.label) {
    act = action.href
      ? `<a class="es-action" href="${esc(action.href)}" target="_blank" rel="noopener">${esc(action.label)}</a>`
      : `<button type="button" class="es-action"${action.cmd ? ` data-cmd="${esc(action.cmd)}"` : ''}>${esc(action.label)}</button>`;
  }
  return `<div class="empty-state">${mark}<div class="es-title">${esc(title || '')}</div>` +
    (body ? `<div class="es-body">${esc(body)}</div>` : '') + act + '</div>';
}
