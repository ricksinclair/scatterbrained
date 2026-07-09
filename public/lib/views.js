// Closed vocabulary of VIEWS — the surfaces the same composable components render
// into, each at a different altitude (SPEC §10.7). A component reads `ctx.view` and
// renders compact or large accordingly. Closed + lintable like `source_kind`: a
// render hint may only target a view in this set. (ROADMAP M-D.)
//
//   inspector — the slim peek panel (single click): identity, key facts, one action.
//   report    — the large working canvas (expand): components render full-size.
//   panel     — an assistant-composed card inline in the voice thread (VOICE Phase 5):
//               compact like inspector, but scrolls inside its own ~40vh card.
// Future (reserved, not yet built): study, pinboard, glyph.
export const VIEWS = ['inspector', 'report', 'panel'];
export const DEFAULT_VIEW = 'inspector';

export function isView(v) { return VIEWS.includes(v); }
export function coerceView(v) { return VIEWS.includes(v) ? v : DEFAULT_VIEW; }
