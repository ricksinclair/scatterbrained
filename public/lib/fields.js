// fields.js — per-field association rows (#29). Pure, DOM-free, tested.
//
// Generalizes the single generic "+ Relate to…" panel into NAMED fields: a node's
// People / Projects / Goals / Skills become inline pickers. Each FIELD binds a human
// label to exactly one schema edge shape — (relType, dir, targetLabel) — and is shown
// only for the node labels where that shape is valid. The inspector renders each field
// as a pre-typed picker: current members as removable chips (× = remove-edge, Stage 1),
// a typeahead filtered to targetLabel to add (= /api/relate, in the field's direction).
//
// This is a CURATED table (which relationships are worth a named field, and what to call
// them) — but every entry is test-guarded against REL_SHAPES (vocab.js), so the curation
// can never drift into an edge shape the server would reject.
//
//   dir 'out' → (node)-[:relType]->(:targetLabel)   [members are the node's outgoing edges]
//   dir 'in'  → (:targetLabel)-[:relType]->(node)   [members are the node's incoming edges]

export const FIELDS = [
  // Insight — what a takeaway is about
  { key: 'insight-projects', for: 'Insight', label: 'Projects', relType: 'ABOUT', dir: 'out', targetLabel: 'Project' },
  { key: 'insight-ideas',    for: 'Insight', label: 'Ideas',    relType: 'ABOUT', dir: 'out', targetLabel: 'Idea' },
  { key: 'insight-goals',    for: 'Insight', label: 'Goals',    relType: 'ABOUT', dir: 'out', targetLabel: 'Goal' },

  // Project — people, the goals it serves, the skills it needs, the ideas it holds
  { key: 'project-people',  for: 'Project', label: 'People',   relType: 'COLLABORATES_ON', dir: 'in',  targetLabel: 'Person' },
  { key: 'project-goals',   for: 'Project', label: 'Goals',    relType: 'ACHIEVED_BY',     dir: 'in',  targetLabel: 'Goal' },
  { key: 'project-skills',  for: 'Project', label: 'Skills',   relType: 'REQUIRES',        dir: 'out', targetLabel: 'Skill' },
  { key: 'project-ideas',   for: 'Project', label: 'Ideas',    relType: 'CONTAINS',        dir: 'out', targetLabel: 'Idea' },

  // Goal — the project that achieves it, the skills it requires
  { key: 'goal-project', for: 'Goal', label: 'Achieved by', relType: 'ACHIEVED_BY', dir: 'out', targetLabel: 'Project' },
  { key: 'goal-skills',  for: 'Goal', label: 'Skills',      relType: 'REQUIRES',    dir: 'out', targetLabel: 'Skill' },

  // Person — where they work, the projects they collaborate on
  { key: 'person-org',      for: 'Person', label: 'Works at', relType: 'WORKS_AT',        dir: 'out', targetLabel: 'Organization' },
  { key: 'person-projects', for: 'Person', label: 'Projects', relType: 'COLLABORATES_ON', dir: 'out', targetLabel: 'Project' },

  // Idea — the project it belongs to, the skills it needs
  { key: 'idea-project', for: 'Idea', label: 'Part of', relType: 'PART_OF',  dir: 'out', targetLabel: 'Project' },
  { key: 'idea-skills',  for: 'Idea', label: 'Skills',  relType: 'REQUIRES', dir: 'out', targetLabel: 'Skill' },
];

// The fields shown for a node of this label (in table order).
export function fieldRowsFor(nodeLabel) {
  return FIELDS.filter((f) => f.for === nodeLabel);
}

// Current members of a field = the node's edges matching its (relType, dir, targetLabel).
// Edges come from /api/node (each carries type, dir, label, id, rel_id).
export function membersForField(edges = [], field) {
  if (!field) return [];
  return (edges || []).filter((e) =>
    e && e.type === field.relType && e.dir === field.dir && e.label === field.targetLabel);
}

// For a pick in this field, which end is source vs target (so the new edge has the
// field's shape). dir 'out' → node is source; dir 'in' → the picked node is source.
export function relateArgs(field, nodeId, pickedId) {
  return field.dir === 'out'
    ? { sourceId: nodeId, targetId: pickedId, type: field.relType }
    : { sourceId: pickedId, targetId: nodeId, type: field.relType };
}
