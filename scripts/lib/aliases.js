// Retired entity/brand names — the single source of truth for "this name is no
// longer canonical, and here's what it became."
//
// WHY THIS EXISTS (root cause of the Engram→Scatterbrained drift):
// The graph DENORMALIZES names — the same brand is copied as free text into
// dozens of nodes' name/description/tags fields. A rename is therefore a fan-out,
// not a single edit. The 2026-06-16 rename touched ONE attribute on ONE node
// (Scatterbrained.former_name) and stopped, so the old name lingered in ~110
// live fields — and nodes authored afterward kept reintroducing it because the
// authoring path had no idea "Engram" was retired.
//
// This file makes a retired name two things it wasn't before:
//   • CHECKABLE — lint-graph's `retired-alias-drift` fails when a live identity
//     field reintroduces a retired brand (backstop against future drift).
//   • EXECUTABLE — rename-brand.js reads this to perform a complete fan-out
//     rename (and knows what NOT to touch).
//
// Used by: scripts/lint-graph.js, scripts/rename-brand.js.

// retired token (lowercase) -> canonical current name.
// Add an entry here the moment a brand/project is renamed; that single line is
// what turns "we hope the rename was complete" into "the linter checks it."
export const RETIRED_ALIASES = {
  engram: 'Scatterbrained',
};

// Node labels whose NAME is live identity — drift in these is real and fixable.
// Deliberately excludes Insight and Source: their summary/full_text/title narrate
// HISTORY (incl. the rename itself and real GitHub artifacts titled "Engram PR
// #21"), where the old name is faithful, not drift.
export const IDENTITY_LABELS = ['Project', 'Idea', 'Skill', 'Goal', 'Resource', 'Organization', 'Person'];

// DRIFT DETECTION keys on these fields only: is the thing still CALLED the old
// name? A node whose name/title is already canonical (e.g. the Project, renamed
// to "Scatterbrained") is NOT drift even if its description recounts the history.
export const NAME_FIELDS = ['name', 'title'];

// When a node IS drifting, these are the fields rename-brand.js fans the rewrite
// out across (the full denormalized footprint of the name on that one node).
export const REWRITE_FIELDS = ['name', 'title', 'description', 'summary', 'purpose', 'tags'];

// Fields where a retired name is LEGITIMATELY preserved (history, immutable keys,
// pointers). rename-brand.js never rewrites these; the lint check never flags them.
export const ALLOWED_FIELDS = new Set([
  'former_name',
  'former_npm_package',
  'id',
  'session_id',
  'superseded_by',
  'invalidated_reason',
  'aliases',
]);

// A retired token is BRAND DRIFT only when it appears as a standalone brand word.
// Three classes are deliberately NOT drift and must survive a rename untouched:
//   1. kebab/path identifiers — e.g. the published npm name engram-kg
//      (a real frozen identifier): guarded by the trailing (?![-/.]).
//   2. repo/path segments — ly-wang19/engram (the prior-art that forced the
//      rename!): guarded by a leading (?<![/-]).
//   3. historical narration — "formerly Engram", "drafted as Engram",
//      "renamed from Engram": guarded by the cue-phrase lookbehinds.
//   "Engram Studio"             -> drift   (standalone, followed by space)
//   "engram-kg"                 -> keep    (trailing '-')
//   "collision with ly-wang19/engram" -> keep (leading '/')
//   "formerly drafted as Engram"-> keep    (cue 'as ' / 'drafted as ')
const HISTORICAL_CUES = ['formerly', 'formally', 'previously', 'originally', 'drafted as', 'known as', 'renamed from', 'rebranded as', 'aka', 'née', 'nee'];

function tokenAlternation() {
  return Object.keys(RETIRED_ALIASES).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

function cueLookbehinds() {
  return HISTORICAL_CUES.map((c) => `(?<!${c} )`).join('');
}

// Core pattern (no flags): standalone retired brand word, not an identifier,
// repo segment, or historical mention. Shared by JS and Cypher so detection and
// rewrite never disagree.
function corePattern() {
  return `(?<![/-])${cueLookbehinds()}\\b(${tokenAlternation()})\\b(?![-/.])`;
}

// JS regex matching a standalone retired brand word.
export function brandRegexJS(flags = 'gi') {
  return new RegExp(corePattern(), flags);
}

// Java/Cypher regex string for a FULL-string match (=~), DOTALL so it spans the
// newlines in full_text/description. Used by lint-graph's drift check.
export function brandRegexCypher() {
  return `(?is).*${corePattern()}.*`;
}

// Does this scalar/string carry a retired brand word used as a brand?
export function hasBrandDrift(value) {
  if (value == null) return false;
  return brandRegexJS('i').test(String(value));
}

// Rewrite retired brand words to their canonical names, preserving case
// (Engram→Scatterbrained, engram→scatterbrained) and leaving identifiers intact.
export function rewriteBrand(value) {
  if (value == null) return value;
  return String(value).replace(brandRegexJS('gi'), (match) => {
    const canonical = RETIRED_ALIASES[match.toLowerCase()] || match;
    // Lowercase occurrence → lowercase canonical; otherwise canonical as-authored.
    return match[0] === match[0].toLowerCase() ? canonical.toLowerCase() : canonical;
  });
}

// The canonical name for a retired token (or null if not retired).
export function canonicalFor(token) {
  return RETIRED_ALIASES[String(token).toLowerCase()] || null;
}
