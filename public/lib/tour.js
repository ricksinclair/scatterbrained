// tour.js — the guided auto-play tour (#14), rewritten for the rail + palette + lens
// IA (D7). Pure data + a validator; the runner (tour-ui.js) interprets each beat over
// the live app. Modeled on the Casey taxi tour: linear, auto-advancing, warm captions,
// a stop button. It's the showcase AND first-run onboarding — best over the demo graph
// (examples/seed-demo.cypher), where the named nodes exist; on any other graph a step
// that can't find its node simply narrates (the runner try/catches every action).
//
// A step is declarative so it stays testable. Recognized fields (all optional but `caption`):
//   focus     : node name to __focus, or null to clear focus (back to the full constellation)
//   click     : a selector (or array of selectors, clicked in order) — rail buttons, tabs
//   type      : text to put in the ask-bar (#q) and fire (opens the palette)
//   scrollTo  : a selector to scroll into view (e.g. a specific inspector component)
//   escape    : true → dispatch Escape first (one Esc-stack unwind), before other actions
//   caption   : the narration (supports <b> for emphasis)
//   wait      : ms before advancing
//
// The walk mirrors the product loop — See (constellation, brief, palette) → Understand
// (inspector, report, Time) → Act (Code review, Agents, Capture). Captions stay
// benefit-first, never a feature list.

export const TOUR = [
  { focus: null, escape: true,
    caption: "<b>Scatterbrained</b> — your whole second brain, one living map.", wait: 4500 },
  { click: "#rail-graph",
    caption: "The <b>rail</b> is home. Four lenses — Graph, Time, Code, Agents — always labeled, always one click (or <b>G T C A</b>) away.", wait: 5500 },
  { scrollTo: ".dock-resume",
    caption: "Each day opens with a <b>Daily Brief</b>: what's new, what's due, where you left off — one click back into flow.", wait: 6000 },
  { type: "what's blocked",
    caption: "Don't hunt — <b>ask</b>. <b>⌘K</b> puts commands, answers and memories under one bar.", wait: 5500 },
  { escape: true, scrollTo: "#lenses",
    caption: "Dock <b>lenses</b> tune the constellation — projects, goals, needs-review — with type filters right below.", wait: 5500 },
  { focus: "Shipment Tracking Platform",
    caption: "Click anything. The panel builds itself from what the node <b>actually is</b> — its sources, its relations, its history.", wait: 6500 },
  { focus: "Use Confluent Cloud for the event pipeline", scrollTo: ".c-protected-facts",
    caption: "The figures that matter are pinned as <b>protected facts</b> — a later rewrite can't silently change them.", wait: 6500 },
  { click: "#i-expand",
    caption: "One click and the peek becomes a <b>report</b>: the same evidence with room to think, exportable as Markdown.", wait: 6000 },
  { escape: true, click: "#rail-time",
    caption: "The <b>Time</b> lens leads with your agenda — overdue, today, this week. The graph as a clock, not a museum.", wait: 6000 },
  { escape: true, click: ["#rail-code", '#code-tabs [data-tab="review"]'],
    caption: "The <b>Code</b> lens: map a repo, or review it <b>frozen at a commit</b> — comments live in the graph, not in a PR tab.", wait: 6500 },
  { escape: true, click: "#rail-agents",
    caption: "<b>Agents</b> is the Act loop: the graph <b>briefs</b> the agent, the session runs, and Capture files the transcript back as a cited Source.", wait: 7000 },
  { escape: true, click: "#rail-capture",
    caption: "<b>Capture</b> saves a link or a talk and attaches it to the nodes it informs — evidence first, always.", wait: 5500 },
  { escape: true, click: "#rail-settings",
    caption: "Make it yours: six themes × light/dark, calm mode, and a <b>UI size</b> the embedded terminal follows too.", wait: 6000 },
  { escape: true, focus: null,
    caption: "See it. Understand it. Act on it. Welcome to <b>Scatterbrained</b>. 🧠", wait: 5500 },
];

// Lightweight validator (used by tests): each step has a caption + positive wait and only
// uses recognized action keys.
const STEP_KEYS = new Set(["focus", "click", "type", "scrollTo", "escape", "caption", "wait"]);
export function isValidTour(steps = TOUR) {
  if (!Array.isArray(steps) || !steps.length) return false;
  return steps.every((s) =>
    s && typeof s.caption === "string" && s.caption.length > 0 &&
    typeof s.wait === "number" && s.wait > 0 &&
    Object.keys(s).every((k) => STEP_KEYS.has(k)));
}
