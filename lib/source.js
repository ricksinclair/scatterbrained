// Pure helpers for the /api/source BFF (M-A) — the "See" layer reads a node's
// primary file and returns a typed, *sandboxed* excerpt. No fs here: the endpoint
// does IO, these functions are pure so path-sandboxing, kind-detection and excerpt
// windowing are unit-tested exactly as shipped. (SPEC §1 See; ROADMAP M-A; Open #6.)

import path from 'node:path';

// Extension → typed kind. Mirrors the document-lane source_kind vocab; `unknown`
// for anything the viewer can't render (never guessed).
const KIND_BY_EXT = {
  '.md': 'markdown', '.markdown': 'markdown', '.rst': 'markdown',
  '.txt': 'text', '.text': 'text', '.log': 'text',
  '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx',
  '.csv': 'csv', '.tsv': 'csv', '.xlsx': 'xlsx',
};
export function detectKind(filePath) {
  return KIND_BY_EXT[path.extname(String(filePath || '')).toLowerCase()] || 'unknown';
}
// The kinds the BFF can read & return as text directly (no extractor/lib needed).
export const TEXT_KINDS = new Set(['markdown', 'text', 'csv']);

// Expand the document-sources allowlist into absolute root paths (resolving a
// leading ~). This set is the curation boundary AND the read sandbox (Open #6).
export function expandRoots(config = {}, homedir = '') {
  return (config.roots || [])
    .map((r) => (typeof r === 'string' ? r : r && r.path))
    .filter(Boolean)
    .map((p) => (p.startsWith('~') ? path.join(homedir, p.slice(1)) : p))
    .map((p) => path.resolve(p));
}

// True only if `target` resolves to a location inside one of `roots` — blocks
// `..` traversal, symlink-style escapes via resolve, and prefix-collision
// false-positives ('/a/bc' is NOT inside '/a/b'). Empty/absent target → false.
export function isWithinRoots(target, roots = []) {
  if (!target) return false;
  const abs = path.resolve(String(target));
  return roots.some((root) => {
    const r = path.resolve(root);
    return abs === r || abs.startsWith(r + path.sep);
  });
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'are', 'was']);
function tokenize(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t));
}
// How well a candidate file matches the node — token overlap between the node name
// and the file's basename/title. Lets a 23-source node show the source actually
// *about* it, not just the first readable one (persona P2: USFWC was showing a
// random Colorado state file).
function relevance(nameTokens, cand) {
  if (!nameTokens.length) return 0;
  const hay = new Set(tokenize(cand.filePath).concat(tokenize(cand.title)));
  return nameTokens.reduce((n, t) => n + (hay.has(t) ? 1 : 0), 0);
}

// Choose a node's primary file (Open #4): rank candidates (the node's own file, then
// incoming Source edges, then any edge with a file) by — in order — own-file primacy,
// sandbox-readability (when `isReadable` is given), then relevance to the node name,
// then original order. Returns the best { filePath, title } or null. Pure — the
// predicate carries any IO knowledge; relevance keeps it deterministic.
export function pickPrimarySource(node = {}, edges = [], isReadable = null) {
  const candidates = [];
  if (node.file_path) candidates.push({ filePath: node.file_path, title: node.name || node.file_path, own: true });
  for (const e of edges) {
    if (e.dir === 'in' && e.label === 'Source' && e.file_path) candidates.push({ filePath: e.file_path, title: e.name || e.file_path });
  }
  for (const e of edges) {
    if (e.file_path && !candidates.some((c) => c.filePath === e.file_path)) candidates.push({ filePath: e.file_path, title: e.name || e.file_path });
  }
  if (!candidates.length) return null;
  const nameTokens = tokenize(node.name);
  const score = (c) => (c.own ? 1000 : 0) + (isReadable && isReadable(c.filePath) ? 100 : 0) + relevance(nameTokens, c);
  const best = candidates
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0].c;
  return { filePath: best.filePath, title: best.title };
}

// Grounded excerpt: return the window of lines around the first line matching any
// keyword (case-insensitive). No match → head of the file. Always bounded by
// maxLines so a huge file never floods the inspector. Returns { text, truncated,
// matchedLine } (matchedLine = 1-based, or 0 when falling back to the head).
export function excerptAround(content, keywords = [], { context = 6, maxLines = 40 } = {}) {
  const lines = String(content || '').split(/\r?\n/);
  const kws = (Array.isArray(keywords) ? keywords : [keywords])
    .filter(Boolean).map((k) => String(k).toLowerCase()).filter((k) => k.length >= 3);
  let hit = -1;
  if (kws.length) {
    hit = lines.findIndex((ln) => { const l = ln.toLowerCase(); return kws.some((k) => l.includes(k)); });
  }
  let start, end;
  if (hit >= 0) { start = Math.max(0, hit - context); end = Math.min(lines.length, hit + context + 1); }
  else { start = 0; end = Math.min(lines.length, maxLines); }
  if (end - start > maxLines) end = start + maxLines;
  return {
    text: lines.slice(start, end).join('\n'),
    truncated: start > 0 || end < lines.length,
    matchedLine: hit >= 0 ? hit + 1 : 0,
  };
}
