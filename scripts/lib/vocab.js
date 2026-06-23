// Canonical controlled vocabularies for the knowledge graph.
//
// SINGLE SOURCE OF TRUTH. Both the linter (lint-graph.js) and the human docs
// (CLAUDE.md) defer to this file. When `source_kind` was free-text, three
// ingestion paths each stamped Notion pages differently (notion / notion_page /
// notion_workspace / untagged), so "every Notion page that informed X" silently
// missed rows. Closing the set here — and ERRORing on anything outside it in
// lint — is what stops that drift from coming back.
//
// To add a kind: add it here WITH a one-line rationale, update the CLAUDE.md
// Source-kind table, and make sure whatever writes it (a script or the
// graph-sync skill) uses the exact string. Don't stamp a kind that isn't listed.

// kind -> short description of what it tags. Keep the keys lowercase_snake.
export const SOURCE_KINDS = {
  // — Notion lane (set by the graph-sync skill when ingesting Notion) —
  notion_page: 'A Notion content page.',
  notion_workspace: 'A Notion workspace/hub index page (the top of a project space).',

  // — Document lane (set by document-index.js from the file extension) —
  // These are the ONLY kinds the ingestion lane auto-produces (TEXT_KINDS + BINARY_KINDS
  // in document-index.js): .md/.markdown/.txt/.rst/.pdf/.docx/.pptx.
  markdown: 'A Markdown document (.md/.markdown).',
  text: 'A plain-text document (.txt/.rst).',
  pdf: 'A PDF document.',
  docx: 'A Word document.',
  pptx: 'A PowerPoint deck.',

  // — Spreadsheet/tabular lane — VALID kinds the Scatterbrained Studio sheet/chart viewers
  //   render (public/lib/csv.js + lib/xlsx.js, both shipped), but NOT auto-ingested by
  //   document-index.js. They reach the graph by hand or via the Studio (test fixtures use
  //   them today); auto-ingestion is queued, see scatterbrained-studio ROADMAP Open #10.
  csv: 'A comma/tab-separated spreadsheet (.csv/.tsv) — rendered as a table + chart by the Studio.',
  xlsx: 'An Excel spreadsheet (.xlsx) — rendered as a table by the Studio.',

  // — Curated / manually-added artifacts (set by hand during a session) —
  claude_memory: 'A Claude memory file (~/.claude/.../memory/*.md).',
  git_repo: 'A git repository as a whole (not a single file in it).',
  config: 'A configuration artifact (settings, CLAUDE.md-style instructions).',
  tooling: 'A script, CLI, or dev tool.',
  skill: 'A Claude skill (SKILL.md).',
  protocol: 'A collaboration/operating protocol document.',
  live_demo: 'A deployed/live site or demo (referenced by URL).',
  github_issue: 'A GitHub issue or pull request (referenced by URL).',
};

export const SOURCE_KIND_LIST = Object.keys(SOURCE_KINDS);

// Kinds that originate from a file on disk, so they MUST carry a file_path.
// (Used by lint to flag document-lane Sources that lost their absolute path.)
export const FILE_BACKED_KINDS = ['markdown', 'text', 'pdf', 'docx', 'pptx', 'csv', 'xlsx', 'claude_memory'];

export function isValidSourceKind(k) {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_KINDS, k);
}

// Closed set of relationship types (CLAUDE.md "Relationship types — don't invent
// new ones"). The same single-source-of-truth discipline as SOURCE_KINDS: the
// Studio's inline associate control (#29) and any writer MUST pick from this set
// so the UI can't introduce an ad-hoc edge type. Mirrors scripts/seed-schema.cypher.
export const REL_TYPES = [
  'WORKS_AT', 'ADVISED_ON', 'FLAGGED_RISK', 'RECOMMENDED', 'COLLABORATES_ON',
  'SUPPORTS', 'PUBLISHED', 'CONTAINS', 'REQUIRES', 'INFORMED_BY', 'DEPENDS_ON',
  'PART_OF', 'BLOCKED_BY', 'CONSTRAINS', 'APPLIES_TO', 'INFORMS', 'TEACHES',
  'DERIVED_FROM', 'ABOUT', 'ACHIEVED_BY', 'USED_IN', 'INSPIRED', 'ROUTES_TO',
];

export function isValidRelType(t) {
  return typeof t === 'string' && REL_TYPES.includes(t);
}

// Provenance edges are EARNED at ingest (a Source INFORMS the nodes it produced; an
// Insight is DERIVED_FROM its evidence) — they encode where a fact came from. They are
// retired by SUPERSEDING the source, never hand-pruned, so the Studio's remove-edge
// affordance (#29) refuses them. Single source of truth for that rule.
export const PROVENANCE_REL_TYPES = ['INFORMS', 'DERIVED_FROM'];
export function isProvenanceRelType(t) {
  return typeof t === 'string' && PROVENANCE_REL_TYPES.includes(t);
}

// Pre-existing relationship types found in the live graph that are NOT in the
// curated set above (created by past agent/manual writes before the vocab was
// closed). They were GRANDFATHERED — tolerated by lint so it stayed green — until
// each was resolved (2026-06-18): the 7 drift types were migrated to canonical
// types (or promoted: INSPIRED is now canonical). The set is now EMPTY, so
// `relationship-type-not-in-vocabulary` ERRORs on any of them reappearing.
//   RELATES_TO     → ABOUT / PART_OF / DEPENDS_ON / SUPPORTS / DERIVED_FROM (per edge)
//   USES           → USED_IN (Skill→Project, reversed) / DEPENDS_ON (Project→Org)
//   ENABLES        → SUPPORTS (Project→Project)
//   GUIDED_BY      → ACHIEVED_BY (Goal→Project, reversed)
//   RESPONDS_TO    → DERIVED_FROM (Insight→Insight)
//   CONSTRAINED_BY → CONSTRAINS (Rule→Project, reversed)
//   INSPIRED       → PROMOTED to REL_TYPES (Person/Resource → Project/Idea)
export const REL_TYPES_LEGACY = [];
// Every relationship type the graph may currently contain without a lint ERROR.
export const REL_TYPES_KNOWN = [...REL_TYPES, ...REL_TYPES_LEGACY];

export function isKnownRelType(t) {
  return typeof t === 'string' && REL_TYPES_KNOWN.includes(t);
}

// Allowed edge SHAPES per canonical relationship type: `${SourceLabel}>${TargetLabel}`.
// Seeded from the documented schema (scripts/seed-schema.cypher) broadened to the
// clearly-legitimate shapes already in the graph. Shapes left OUT here surface as an
// advisory WARN in lint (and /api/relate rejects creating them) — that's how a
// mis-typed or backwards edge (e.g. a reversed USED_IN, an Insight used as an INFORMS
// source) gets caught instead of landing silently. Legacy types are not shape-checked.
export const REL_SHAPES = {
  ABOUT: ['Insight>Project', 'Insight>Idea', 'Insight>Goal', 'Insight>Organization', 'Insight>Skill', 'Idea>Project', 'Idea>Idea', 'Skill>Project'],
  ACHIEVED_BY: ['Goal>Project'],
  ADVISED_ON: ['Person>Rule', 'Person>Idea'],
  APPLIES_TO: ['Rule>Project', 'Rule>Idea'],
  BLOCKED_BY: ['Goal>Idea', 'Idea>Rule', 'Idea>Idea'],
  COLLABORATES_ON: ['Person>Project'],
  // Rule→X is the core form; Organization>Project covers a regulator/agency constraining a
  // project (e.g. a regulator → a regulated project), Idea>Idea a design constraint-idea bounding
  // another idea (e.g. "protected key-facts" → "demo dataset"). Both added 2026-06-18.
  CONSTRAINS: ['Rule>Project', 'Rule>Idea', 'Organization>Project', 'Idea>Idea'],
  CONTAINS: ['Project>Idea'],
  DEPENDS_ON: ['Idea>Idea', 'Project>Organization', 'Project>Project'],
  // Insight→X is the core form; Idea>Idea covers one idea evolving from a prior idea
  // (e.g. "Scatterbrained Studio" ← "Agentic OS dashboard"). Added 2026-06-18.
  DERIVED_FROM: ['Insight>Source', 'Insight>Insight', 'Insight>Idea', 'Insight>Rule', 'Idea>Idea'],
  FLAGGED_RISK: ['Person>Idea'],
  INFORMED_BY: ['Project>Source'],
  INFORMS: ['Source>Project', 'Source>Idea', 'Source>Rule', 'Source>Insight', 'Source>Organization', 'Source>Skill', 'Source>Resource', 'Source>Person', 'Source>Goal', 'Source>Source'],
  // Promoted from REL_TYPES_LEGACY 2026-06-18: a person or resource (a namesake, a book, a
  // place, prior art) that inspired a project or idea — e.g. a namesake → the app named for it.
  // Distinct from COLLABORATES_ON (active work); captures legacy/namesake/inspiration.
  INSPIRED: ['Person>Project', 'Person>Idea', 'Resource>Project', 'Resource>Idea'],
  PART_OF: ['Idea>Project', 'Idea>Idea', 'Project>Project'],
  PUBLISHED: ['Organization>Source'],
  RECOMMENDED: ['Person>Organization', 'Person>Resource'],
  // Rule>Organization covers a rule mandating a specific org/vendor/regulator
  // (e.g. "deploy to Render, not Heroku" → Render). Added 2026-06-18.
  REQUIRES: ['Project>Skill', 'Goal>Skill', 'Idea>Skill', 'Idea>Resource', 'Rule>Organization'],
  // A domain/site project routing to another project hosted elsewhere (e.g. a personal
  // domain pointing a subdomain/path at a GitHub-Pages-hosted app). Distinct from SUPPORTS
  // (which implies hosting) — the domain only resolves the address. Added 2026-06-18.
  ROUTES_TO: ['Project>Project'],
  SUPPORTS: ['Organization>Project', 'Project>Project'],
  TEACHES: ['Resource>Skill'],
  USED_IN: ['Skill>Project', 'Resource>Project'],
  WORKS_AT: ['Person>Organization'],
};
// Flat `${TYPE}|${Source}>${Target}` list — the form lint's Cypher membership-checks.
export const REL_SHAPE_LIST = Object.entries(REL_SHAPES).flatMap(([t, shapes]) => shapes.map((s) => `${t}|${s}`));

// Annotation / meta labels that sit OUTSIDE the semantic knowledge-entity graph — the
// shape allowlist governs entities (Person/Project/Idea/…), not the annotation layer.
// A `Note` can be ABOUT *any* node (node-notes) or PART_OF a `Review`; a `Review` is a
// Studio code-review artifact; a `ProtectedFact` is a protected-fact node ABOUT any node (#23).
// Edges touching these are not shape-constrained.
export const RELSHAPE_EXEMPT_LABELS = ['Note', 'Review', 'ProtectedFact'];

// Is (sourceLabel)-[:type]->(targetLabel) a recognized shape? Canonical types only
// (legacy types are not shape-constrained). Edges touching an annotation/meta label are
// exempt. Unknown canonical type with no shape list → unconstrained (true) so adding a
// type can't silently block it.
export function isValidRelShape(sourceLabel, type, targetLabel) {
  if (RELSHAPE_EXEMPT_LABELS.includes(sourceLabel) || RELSHAPE_EXEMPT_LABELS.includes(targetLabel)) return true;
  if (!REL_TYPES.includes(type)) return true;       // legacy/unknown: not shape-checked here
  const allowed = REL_SHAPES[type];
  if (!allowed) return true;
  return allowed.includes(`${sourceLabel}>${targetLabel}`);
}
