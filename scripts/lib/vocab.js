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
  markdown: 'A Markdown document (.md/.markdown).',
  text: 'A plain-text document (.txt/.rst).',
  pdf: 'A PDF document.',
  docx: 'A Word document.',
  pptx: 'A PowerPoint deck.',

  // — Curated / manually-added artifacts (set by hand during a session) —
  claude_memory: 'A Claude memory file (~/.claude/.../memory/*.md).',
  git_repo: 'A git repository as a whole (not a single file in it).',
  config: 'A configuration artifact (settings, CLAUDE.md-style instructions).',
  tooling: 'A script, CLI, or dev tool.',
  skill: 'A Claude skill (SKILL.md).',
  protocol: 'A collaboration/operating protocol document.',
  live_demo: 'A deployed/live site or demo (referenced by URL).',
};

export const SOURCE_KIND_LIST = Object.keys(SOURCE_KINDS);

// Kinds that originate from a file on disk, so they MUST carry a file_path.
// (Used by lint to flag document-lane Sources that lost their absolute path.)
export const FILE_BACKED_KINDS = ['markdown', 'text', 'pdf', 'docx', 'pptx', 'claude_memory'];

export function isValidSourceKind(k) {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_KINDS, k);
}
