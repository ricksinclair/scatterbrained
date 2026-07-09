// commands.js — the command registry behind the palette (Stage C1). Pure data + a pure
// matcher, no DOM: app.js renders matches into the intent panel and dispatches the chosen
// id through its one dispatch() switch. The registry is CLOSED — every launchable feature
// is a declared command here (tests enforce the set), so "can I do X from the keyboard?"
// is always yes. Dynamic families (one per theme, one per node type present in the graph)
// come in through the buildRegistry factory args, not ad-hoc pushes.

// Shape: { id, title, hint?, keywords[], shortcut?, group, gated? }
//   gated — name of a boolean in the ctx passed to matchCommands; the command is hidden
//           until that flag is true (e.g. study-selected needs a selected node).
const BASE = [
  { id: 'open-graph', title: 'Go to Graph', hint: 'the constellation', keywords: ['home', 'constellation', 'nodes'], shortcut: 'G', group: 'lens' },
  { id: 'open-time-agenda', title: 'Open Time lens', hint: 'activity & agenda', keywords: ['calendar', 'agenda', 'activity', 'heatmap', 'due'], shortcut: 'T', group: 'lens' },
  { id: 'open-roadmap', title: 'Open Roadmap', hint: 'goals across quarters', keywords: ['quarters', 'goals', 'plan', 'milestones', 'time'], group: 'lens' },
  { id: 'open-code-map', title: 'Open Codebase map', hint: 'module & import graph', keywords: ['code', 'repo', 'dev', 'modules', 'imports'], shortcut: 'C', group: 'lens' },
  { id: 'open-code-review', title: 'Open Code review', hint: 'review a repo at a commit', keywords: ['code', 'review', 'diff', 'pr', 'commit', 'comments'], group: 'lens' },
  { id: 'open-agents', title: 'Open Agents', hint: 'Slipway runtime', keywords: ['slipway', 'terminal', 'llm', 'claude', 'act'], shortcut: 'A', group: 'lens' },
  { id: 'agent-archive-selected', title: 'Archive / Unarchive session', hint: 'the selected agent session', keywords: ['slipway', 'agent', 'session', 'archive', 'unarchive', 'rail', 'hide'], group: 'action', gated: 'agentSession' },
  { id: 'agent-archive-ended', title: 'Archive all ended sessions', hint: 'clear the agent rail', keywords: ['slipway', 'agent', 'session', 'archive', 'ended', 'rail', 'clean', 'bulk'], group: 'action' },
  { id: 'open-assistant', title: 'Open Assistant', hint: 'talk to your graph', keywords: ['voice', 'chat', 'ask', 'assistant', 'talk', 'speak'], shortcut: 'V', group: 'action' },
  { id: 'capture-link', title: 'Capture a link', hint: 'save a web or YouTube page', keywords: ['add', 'save', 'url', 'bookmark', 'resource'], group: 'capture' },
  { id: 'add-criterion', title: 'Add acceptance criterion', hint: 'pin a testable expectation on this node', keywords: ['acceptance', 'criteria', 'criterion', 'test', 'regression', 'guardrail', 'verify'], group: 'capture', gated: 'selection' },
  { id: 'needs-review', title: 'Show needs review', hint: 'stale · superseded · orphans', keywords: ['stale', 'orphans', 'superseded', 'filter', 'queue'], group: 'filter' },
  { id: 'focus-clear', title: 'Clear focus', hint: 'show the whole graph', keywords: ['unfocus', 'show all', 'reset'], group: 'action', gated: 'focus' },
  { id: 'study-selected', title: 'Study this node', hint: 'flashcards · active recall', keywords: ['flashcards', 'recall', 'cards', 'learn'], group: 'action', gated: 'selection' },
  { id: 'export-report', title: 'Export briefing', hint: 'selected node as Markdown', keywords: ['markdown', 'download', 'report', 'briefing'], group: 'action', gated: 'selection' },
  { id: 'diagram-neighborhood', title: 'Diagram: map this node\'s neighborhood', hint: 'PlantUML mindmap of its connections', keywords: ['diagram', 'plantuml', 'mindmap', 'map', 'visualize', 'cluster', 'export'], group: 'action', gated: 'selection' },
  { id: 'toggle-mode', title: 'Toggle light / dark', keywords: ['dark', 'light', 'mode', 'appearance'], group: 'appearance' },
  { id: 'toggle-calm', title: 'Toggle calm mode', hint: 'less motion', keywords: ['motion', 'reduce', 'animation', 'still'], group: 'appearance' },
  { id: 'ui-size-s', title: 'UI size · Small', keywords: ['scale', 'small', 'compact', 'text size'], group: 'appearance' },
  { id: 'ui-size-m', title: 'UI size · Medium', keywords: ['scale', 'medium', 'default', 'text size'], group: 'appearance' },
  { id: 'ui-size-l', title: 'UI size · Large', keywords: ['scale', 'large', 'bigger', 'text size'], group: 'appearance' },
  { id: 'start-tour', title: 'Start the tour', hint: 'guided walkthrough', keywords: ['guide', 'walkthrough', 'help', 'demo'], group: 'help' },
  { id: 'open-settings', title: 'Open Settings', hint: 'appearance & system status', keywords: ['preferences', 'theme', 'appearance', 'status'], group: 'help' },
  { id: 'manage-folders', title: 'Manage folders', hint: 'read-sandbox permissions', keywords: ['permissions', 'allowlist', 'repos', 'grant'], group: 'help' },
];

// The declared base ids — tests assert the registry never grows outside this set + the
// two factory families (set-theme-*, filter-*).
export const BASE_COMMAND_IDS = BASE.map((c) => c.id);

const labelPlural = (d) => (d === 'Person' ? 'People' : d + 's');

// buildRegistry({ themes, types }) → the closed registry.
//   themes: [{ name, label }] — one 'set-theme-<name>' per app theme.
//   types:  ['Project', …]    — node labels present in the graph → 'filter-<Type>' each.
//   tours:  [{ id, label }]    — per-surface tours → 'start-tour-<id>' each (showcase is the BASE
//                                'start-tour'; skip it here so it isn't listed twice).
export function buildRegistry({ themes = [], types = [], tours = [] } = {}) {
  return [
    ...BASE,
    ...themes.map((t) => ({
      id: 'set-theme-' + t.name, title: 'Theme · ' + (t.label || t.name),
      keywords: ['theme', 'palette', String(t.name)], group: 'appearance',
    })),
    ...types.map((t) => ({
      id: 'filter-' + t, title: 'Filter · ' + labelPlural(t), hint: 'toggle this type on the graph',
      keywords: ['filter', 'type', 'lens', t.toLowerCase()], group: 'filter',
    })),
    ...tours.filter((t) => t.id !== 'showcase').map((t) => ({
      id: 'start-tour-' + t.id, title: 'Tour · ' + t.label, hint: 'guided walkthrough',
      keywords: ['tour', 'guide', 'walkthrough', String(t.id)], group: 'help',
    })),
  ];
}

// matchCommands(query, registry, ctx) → ranked matches (best first).
// Rank: title prefix > title word-start > title substring > keyword. Gated commands are
// dropped unless ctx[<gate>] is truthy. Pure; ties break alphabetically for stability.
export function matchCommands(query, registry, ctx = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const c of registry) {
    if (c.gated && !ctx[c.gated]) continue;
    const title = c.title.toLowerCase();
    let score = 0;
    if (title.startsWith(q)) score = 4;
    else if (title.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(q))) score = 3;
    else if (title.includes(q)) score = 2;
    else if ((c.keywords || []).some((k) => String(k).toLowerCase().includes(q))) score = 1;
    if (score) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || a.c.title.localeCompare(b.c.title));
  return scored.map((s) => s.c);
}
