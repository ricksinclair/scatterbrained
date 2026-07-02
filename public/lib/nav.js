// nav.js — the navigation state machine (Stage C2). Pure: reducer + hash codec + the
// Esc-unwind order. app.js owns the side effects (which overlay opens/closes, the rail,
// location.hash); this module owns WHAT the states and transitions are, so "where am I"
// is one testable value {lens, tab} instead of six overlays' hidden flags.

export const LENSES = ['graph', 'time', 'code', 'agents'];
export const TABS = { time: ['agenda', 'roadmap'], code: ['map', 'review'] };
const DEFAULT_TAB = { time: 'agenda', code: 'map' };

export const initialState = Object.freeze({ lens: 'graph', tab: null });

const openState = (lens, tab) => {
  if (!LENSES.includes(lens) || lens === 'graph') return { lens: 'graph', tab: null };
  const tabs = TABS[lens] || [];
  return { lens, tab: tabs.includes(tab) ? tab : (DEFAULT_TAB[lens] || null) };
};

// reduce(state, action) → next state. Actions:
//   { type: 'open', lens, tab? }  — switch to a lens (tab optional; validated)
//   { type: 'tab', tab }          — switch tab within the open lens
//   { type: 'close' }             — back to the graph
// Unknown anything is a safe no-op / home, never a throw.
export function reduce(state, action = {}) {
  switch (action.type) {
    case 'open': return openState(action.lens, action.tab);
    case 'tab': {
      const tabs = TABS[state.lens] || [];
      return tabs.includes(action.tab) ? { lens: state.lens, tab: action.tab } : state;
    }
    case 'close': return { lens: 'graph', tab: null };
    default: return state;
  }
}

// location.hash codec: '#time/agenda', '#code/review', '#agents'; graph = no hash.
// Unknown fragments (e.g. '#tour', Slipway '#term:…') parse as the graph so foreign
// deep-links never crash navigation.
export function parseHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  if (!h) return { lens: 'graph', tab: null };
  const [lens, tab] = h.split('/');
  if (!LENSES.includes(lens) || lens === 'graph') return { lens: 'graph', tab: null };
  return openState(lens, tab);
}
export function serializeHash(state) {
  if (!state || state.lens === 'graph' || !LENSES.includes(state.lens)) return '';
  const tabs = TABS[state.lens] || [];
  return '#' + state.lens + (state.tab && tabs.includes(state.tab) ? '/' + state.tab : '');
}
export const sameState = (a, b) => !!a && !!b && a.lens === b.lens && (a.tab || null) === (b.tab || null);

// The ONE Esc-unwind order (replaces six scattered handlers). Topmost layer first:
// the file reader is a modal that can sit above a lens (open a file from the code map),
// so it unwinds before the lens — Esc steps back exactly one visual layer at a time.
// (The plan sketch listed lens first; file-reader-first preserves the shipped behavior
// where Esc closes the file back to the map, then the map.) 'search' is handled at the
// event target (blurring the bar) before the stack is consulted.
export const ESC_ORDER = ['file-reader', 'lens', 'report', 'inspector', 'focus', 'search'];
export function escTarget(flags = {}) {
  return ESC_ORDER.find((k) => flags[k]) || null;
}
