// tour.js — guided tours (schema v2). Pure data + pure helpers; the runner (tour-ui.js)
// interprets each step over the live app. Two shapes share ONE schema:
//   • the SHOWCASE — the auto-advancing full walk (each step carries `wait`), the #tour deep-link
//     and first-run offer both land here;
//   • per-SURFACE tours — short, detailed, MANUALLY advanced (no `wait`): one per lens/surface, each
//     opening what it describes, product-onboarding-style (title + benefit-first body, spotlight, Back/Next).
// Every step keeps the state-coupling actions the old tour had (focus/click/type/scrollTo/escape) —
// that real-UI driving is what a generic tour library can't do; we add the presentation layer.
//
// Step fields (all optional except `title` + `caption`):
//   title    : the popover heading (short)
//   caption  : the body narration (supports <b>)
//   target   : a CSS selector to spotlight + anchor the popover to (omitted → centered popover)
//   focus    : node name to __focus, or null to clear focus
//   click    : a selector (or array) to click, in order — rail buttons, tabs
//   type     : text to put in the ask-bar (#q) and fire
//   scrollTo : a selector to scroll into view
//   escape   : true → dispatch one Escape (unwind a layer) before other actions
//   wait     : ms before auto-advancing (SHOWCASE only; absent → wait for Next)

// ── the showcase: the full auto-play walk (See → Understand → Act) ────────────
export const TOUR = [
  { focus: null, escape: true, title: 'Welcome',
    caption: '<b>Scatterbrained</b> — your whole second brain, one living map.', wait: 4500 },
  { click: '#rail-graph', target: '#rail-graph', title: 'The rail is home',
    caption: 'Four lenses — Graph, Time, Code, Agents — always labeled, always one click (or <b>G T C A</b>) away.', wait: 5500 },
  { scrollTo: '.dock-resume', target: '#dock-resume', title: 'Your Daily Brief',
    caption: "Each day opens with what's new, what's due, and where you left off — one click back into flow.", wait: 6000 },
  { type: "what's blocked", target: '#q', title: "Ask, don't hunt",
    caption: '<b>⌘K</b> puts commands, answers and memories under one bar.', wait: 5500 },
  { escape: true, scrollTo: '#lenses', target: '#lenses', title: 'Lenses tune the map',
    caption: 'Projects, goals, needs-review — with type filters right below.', wait: 5500 },
  { focus: 'Shipment Tracking Platform', target: '#insp', title: 'The panel builds itself',
    caption: 'Click anything. The panel is composed from what the node <b>actually is</b> — its sources, relations, history.', wait: 6500 },
  { focus: 'Use Confluent Cloud for the event pipeline', scrollTo: '.c-protected-facts', target: '#insp', title: 'Protected facts',
    caption: "The figures that matter are pinned — a later rewrite can't silently change them.", wait: 6500 },
  { click: '#i-expand', target: '#report', title: 'Peek becomes report',
    caption: 'The same evidence with room to think — exportable as Markdown, HTML, PDF, or JSON.', wait: 6000 },
  { escape: true, click: '#rail-time', target: '#rail-time', title: 'The Time lens',
    caption: 'Leads with your agenda — overdue, today, this week. The graph as a clock, not a museum.', wait: 6000 },
  { escape: true, click: ['#rail-code', '#code-tabs [data-tab="review"]'], target: '#code-tabs', title: 'The Code lens',
    caption: 'Map a repo, or review it <b>frozen at a commit</b> — comments live in the graph, not a PR tab.', wait: 6500 },
  { escape: true, click: '#rail-agents', target: '#rail-agents', title: 'Agents — the Act loop',
    caption: 'The graph <b>briefs</b> the agent, the session runs, and Capture files the transcript back as a cited Source.', wait: 7000 },
  { escape: true, click: '#rail-capture', target: '#rail-capture', title: 'Capture',
    caption: 'Save a link or a talk and attach it to the nodes it informs — evidence first, always.', wait: 5500 },
  { escape: true, click: '#rail-settings', target: '#rail-settings', title: 'Make it yours',
    caption: 'Six themes × light/dark, calm mode, and a <b>UI size</b> the embedded terminal follows too.', wait: 6000 },
  { escape: true, focus: null, title: 'Welcome to Scatterbrained',
    caption: 'See it. Understand it. Act on it. 🧠', wait: 5500 },
];

// ── per-surface tours: short, detailed, manually advanced ─────────────────────
const GRAPH_TOUR = [
  { click: '#rail-graph', target: '#rail-graph', title: 'The constellation',
    caption: 'Your knowledge as a living map. Every node is a project, idea, person, source, or insight — edges are the relationships between them.' },
  { target: '#lenses', scrollTo: '#lenses', title: 'Lenses & filters',
    caption: 'Tune what the constellation shows — projects, goals, needs-review — with node-type filters right below. The map answers a question instead of showing everything.' },
  { target: '#dock-resume', scrollTo: '.dock-resume', title: 'Daily Brief',
    caption: "The dock opens each day with what's new, what's due, and where you left off — a one-click way back into flow." },
  { type: 'what', target: '#q', title: 'Ask anything',
    caption: 'Press <b>⌘K</b> (or click here) for one bar over commands, answers, and your own memories. Don’t hunt the map — ask it.' },
];

const INSPECTOR_TOUR = [
  { focus: 'Shipment Tracking Platform', target: '#insp', title: 'The self-building panel',
    caption: 'Click any node and this panel composes itself from what the node <b>actually is</b> — no fixed template. A source shows its file; a goal shows its progress.' },
  { target: '#insp', scrollTo: '.c-relations', title: 'Relations that mean something',
    caption: 'Connections are grouped by what they <b>do</b> — what this needs, blocks, or delivers — ranked, not dumped as a flat edge list.' },
  { click: '#i-expand', target: '#report', title: 'Promote to the report',
    caption: 'One click lifts the peek to a full <b>report</b>: the same composition with room to think, and a live relationship map beside it.' },
  { target: '#report .report-export', scrollTo: '.report-export', title: 'The report IS the export',
    caption: 'Export the exact view you see — Markdown, self-contained HTML, PDF, or JSON. Composed once, serialized to whichever you pick.' },
];

const TIME_TOUR = [
  { click: '#rail-time', target: '#rail-time', title: 'The Time lens',
    caption: 'Your knowledge on a clock. It leads with the agenda — overdue, today, this week — from the intention dates you set on nodes.' },
  { target: '#dock-resume', scrollTo: '.dock-resume', title: 'What needs you',
    caption: 'Due and review dates surface here so nothing important goes quiet. Recurring reviews roll forward instead of sitting overdue.' },
];

const CODE_TOUR = [
  { click: '#rail-code', target: '#rail-code', title: 'The Code lens',
    caption: 'Point it at a repo and it ranks the structure — hubs to read first, unreferenced code, and import cycles — instead of a force-graph hairball.' },
  { target: '#code-tabs', scrollTo: '#code-tabs', title: 'Map or Review',
    caption: 'Two tabs, one repo picker. <b>Map</b> is the structural read; <b>Review</b> pins the repo frozen at a commit so comments live in the graph, not a PR tab.' },
  { target: '#code-map-body', title: 'Drill into impact',
    caption: 'On any file, the <b>⇄ impact</b> button opens what breaks if you change it (its callers, method by method) and what it pulls in.' },
];

const AGENTS_TOUR = [
  { click: '#rail-agents', target: '#rail-agents', title: 'Agents — the Act loop',
    caption: 'The graph <b>briefs</b> a coding agent with exactly the context it needs, the session runs in an embedded terminal, and you watch it work.' },
  { target: '#rail-capture', title: 'Close the loop',
    caption: 'When the session ends, <b>Capture</b> files the transcript back into the graph as a cited Source — so what the agent did becomes durable knowledge.' },
];

const CAPTURE_TOUR = [
  { click: '#rail-capture', target: '#rail-capture', title: 'Capture',
    caption: 'Save a link, a talk, or a document and attach it to the nodes it informs. Evidence first — everything in the graph can point back to where it came from.' },
  { target: '#q', title: 'Or just ask to capture',
    caption: 'The assistant can capture on your behalf mid-conversation — a note, a source, a schedule — without leaving the flow.' },
];

const VOICE_TOUR = [
  { click: '#rail-assistant', target: '#rail-assistant', title: 'The assistant',
    caption: 'A voice- and text-native assistant over your graph. The orb is its presence; hold <b>Space</b> to talk to it even with the panel closed.' },
  { target: '#voice', title: 'It shows while it tells',
    caption: 'Ask for a chart, an agenda, or a node and it renders a live card right in the conversation — then you can save a chart as a reusable lens.' },
];

// The registry — one entry per surface, plus the showcase. Titles double as the menu labels.
export const TOURS = {
  showcase: TOUR,
  graph: GRAPH_TOUR,
  inspector: INSPECTOR_TOUR,
  time: TIME_TOUR,
  code: CODE_TOUR,
  agents: AGENTS_TOUR,
  capture: CAPTURE_TOUR,
  voice: VOICE_TOUR,
};

// Human labels for the menu / commands (kept beside the registry so they can't drift).
export const TOUR_LABELS = {
  showcase: 'Full tour (auto-play)',
  graph: 'Graph lens',
  inspector: 'Inspector & report',
  time: 'Time lens',
  code: 'Code lens',
  agents: 'Agents & Act loop',
  capture: 'Capture',
  voice: 'The assistant',
};

// ── validators (pure, tested) ────────────────────────────────────────────────
const STEP_KEYS = new Set(['title', 'caption', 'target', 'focus', 'click', 'type', 'scrollTo', 'escape', 'wait']);
export function isValidTour(steps = TOUR) {
  if (!Array.isArray(steps) || !steps.length) return false;
  return steps.every((s) =>
    s && typeof s.title === 'string' && s.title.length > 0 &&
    typeof s.caption === 'string' && s.caption.length > 0 &&
    (s.wait === undefined || (typeof s.wait === 'number' && s.wait > 0)) &&
    (s.target === undefined || (typeof s.target === 'string' && s.target.length > 0)) &&
    Object.keys(s).every((k) => STEP_KEYS.has(k)));
}
// Every registered tour is well-formed; surface tours (all but showcase) stay a digestible 2–11 steps.
export function isValidTourRegistry(tours = TOURS) {
  return Object.entries(tours).every(([id, steps]) =>
    isValidTour(steps) && (id === 'showcase' || (steps.length >= 2 && steps.length <= 11)));
}

// ── pure presentation helpers ────────────────────────────────────────────────
// Anchor the popover to a target rect, preferring below → above → right → left by fit, then clamp
// into the viewport. `target` null → centered. All inputs plain numbers so it's unit-testable.
export function popoverPosition(target, viewport, pop = { w: 320, h: 160 }, gap = 12, margin = 8) {
  if (!target) return { left: Math.round((viewport.w - pop.w) / 2), top: Math.round((viewport.h - pop.h) / 2), placement: 'center' };
  const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
  let placement, left, top;
  if (target.bottom + gap + pop.h <= viewport.h) { placement = 'bottom'; top = target.bottom + gap; left = cx - pop.w / 2; }
  else if (target.top - gap - pop.h >= 0) { placement = 'top'; top = target.top - gap - pop.h; left = cx - pop.w / 2; }
  else if (target.right + gap + pop.w <= viewport.w) { placement = 'right'; left = target.right + gap; top = cy - pop.h / 2; }
  else { placement = 'left'; left = target.left - gap - pop.w; top = cy - pop.h / 2; }
  left = Math.max(margin, Math.min(left, viewport.w - pop.w - margin));
  top = Math.max(margin, Math.min(top, viewport.h - pop.h - margin));
  return { left: Math.round(left), top: Math.round(top), placement };
}

// Persistence is a plain store object { seen:{id:true}, snoozeUntil:number } so it's testable
// without localStorage; tour-ui serializes it to localStorage.
export function tourSeen(store, id) { return !!(store && store.seen && store.seen[id]); }
export function markTourSeen(store, id) { const s = store || {}; s.seen = { ...(s.seen || {}), [id]: true }; return s; }
export function snoozeTours(store, untilMs) { const s = store || {}; s.snoozeUntil = untilMs; return s; }
// Offer the first-run tour only when nothing has been seen and we're not inside a snooze window.
export function shouldOfferTour(store, now) {
  if (!store) return true;
  if (store.snoozeUntil && store.snoozeUntil > now) return false;
  return !(store.seen && Object.keys(store.seen).length);
}
