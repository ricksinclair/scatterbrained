// tour.js — the guided auto-play tour (#14). Pure data + a validator; the runner lives in
// app.js (it needs app internals: __focus, the toolbar buttons, search). Modeled on the
// Northwind tour: a linear, auto-advancing walk that drives the REAL Studio with warm
// captions and a stop button. It's the showcase AND first-run onboarding — best over the
// demo graph (examples/seed-demo.cypher), where the named nodes exist; on any other graph a
// step that can't find its node simply narrates (the runner try/catches every action).
//
// A step is declarative so it stays testable. Recognized fields (all optional but `caption`):
//   focus     : node name to __focus, or null to clear focus (back to the full constellation)
//   click     : a selector (or array of selectors, clicked in order) — e.g. toolbar toggles
//   type      : text to put in the search bar (#q) and fire
//   scrollTo  : a selector to scroll into view (e.g. a specific inspector component)
//   escape    : true → dispatch Escape first, to dismiss any open overlay/popover
//   caption   : the narration (supports <b> for emphasis)
//   wait      : ms before advancing
//
// Captions can name protected facts / code review / etc. because the demo graph contains
// them; keep copy warm and benefit-first, like Northwind.

export const TOUR = [
  { focus: null, escape: true,
    caption: "<b>Scatterbrained</b> — your whole second brain, one living map.", wait: 4500 },
  { focus: "Shipment Tracking Platform",
    caption: "Click anything. The panel builds itself from what the node <b>actually is</b> — its sources, its relations, its history.", wait: 7000 },
  { focus: "Use Confluent Cloud for the event pipeline",
    caption: "A decision carries its evidence — and the figures that matter are pinned as <b>protected facts</b>.", wait: 6500 },
  { scrollTo: ".c-protected-facts",
    caption: "Pin a number, amount, or citation and a later rewrite can't silently change it — the change lands here for your <b>approval</b>.", wait: 7000 },
  { focus: "Run self-managed Kafka for ingestion",
    caption: "Nothing is lost. <b>Superseded</b> decisions stay in the timeline, with why they changed.", wait: 6500 },
  { click: "#dock-toggle",
    caption: "Everything that needs you — a rewrite that touched a protected fact, things to revisit — collects in one <b>dock</b>.", wait: 7000 },
  { click: ["#dock-toggle", "#set-calendar"],
    caption: "A sense of time: what's <b>due</b>, and what's worth <b>revisiting</b>.", wait: 6000 },
  { click: ["#set-calendar"], type: "kafka",
    caption: "Ask the graph — search, or ask what's blocked, due, or needs review.", wait: 5500 },
  { escape: true, click: "#set-review",
    caption: "Review a repo <b>frozen at a commit</b> — comments live in the graph, right on the code.", wait: 7000 },
  { escape: true, focus: null,
    caption: "A second brain you can actually <b>look at</b>. Welcome to Scatterbrained. 🧠", wait: 5500 },
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
