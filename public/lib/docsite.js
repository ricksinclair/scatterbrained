// docsite.js — the standard doc taxonomy + per-project doc-tree builder (pure).
// Convention-over-manifest: a project's doc set is classified from data ALREADY on its
// Source nodes (title = '<root>/<relPath>', display_title) — no frontmatter, no manifest,
// no re-ingestion. The taxonomy is the SINGLE source of truth shared by the Docs lens,
// /api/docs, and the new-project scaffold, so every project gets uniform navigation:
//   user    — reading the app        admin — running a packaged/self-hosted server
//   builder — changing the code      (+ "Working notes" for everything unclassified)
// Docs that don't match a section are NEVER hidden — they group by directory under
// Working notes. Empty sections are omitted by buildDocTree (no scaffold-shaped
// emptiness for older projects).

export const DOC_TAXONOMY = [
  { id: 'user', label: 'Using it', sections: [
    { id: 'overview', label: 'Overview' },
    { id: 'getting-started', label: 'Getting started' },
    { id: 'guides', label: 'Guides' },
    { id: 'reference', label: 'Reference' },
    { id: 'faq', label: 'FAQ & troubleshooting' },
  ] },
  { id: 'admin', label: 'Running it', sections: [
    { id: 'install', label: 'Install' },
    { id: 'configuration', label: 'Configuration' },
    { id: 'deployment', label: 'Deployment' },
    { id: 'backup', label: 'Backup & restore' },
    { id: 'upgrade', label: 'Upgrade' },
    { id: 'operations', label: 'Operations' },
  ] },
  { id: 'builder', label: 'Building it', sections: [
    { id: 'architecture', label: 'Architecture' },
    { id: 'changelog', label: 'Changelog' },
    { id: 'contributing', label: 'Contributing' },
  ] },
];

// Stem/path rules, first match wins. Matched against the doc's path *within* its root
// (title minus the root prefix) — case-insensitive, stem = filename without extension.
// Verified against the real graph: existing docs follow loose stems (SPEC-*, RESEARCH-*,
// CHANGELOG*, README, ROADMAP…); the user/admin stems are what new-project scaffolds.
const RULES = [
  { re: /(^|\/)readme$/, a: 'user', s: 'overview' },
  { re: /(^|\/)(overview|about)$/, a: 'user', s: 'overview' },
  { re: /(^|\/)(getting.?started|quickstart|quick.?start|setup)$/, a: 'user', s: 'getting-started' },
  { re: /(^|\/)guides\//, a: 'user', s: 'guides' },
  { re: /(^|\/)(guide|howto|how.?to)[-_]/, a: 'user', s: 'guides' },
  { re: /(^|\/)(reference|api)$/, a: 'user', s: 'reference' },
  { re: /(^|\/)(faq|troubleshoot(ing)?)$/, a: 'user', s: 'faq' },
  { re: /(^|\/)install/, a: 'admin', s: 'install' },
  { re: /(^|\/)config/, a: 'admin', s: 'configuration' },
  { re: /(^|\/)deploy/, a: 'admin', s: 'deployment' },
  { re: /(^|\/)backup/, a: 'admin', s: 'backup' },
  { re: /(^|\/)(upgrade|migrat)/, a: 'admin', s: 'upgrade' },
  { re: /(^|\/)(operations|runbook|ops)$/, a: 'admin', s: 'operations' },
  { re: /(^|\/)diagrams\//, a: 'builder', s: 'architecture' },
  { re: /(^|\/)(architecture|design|adr[-_]|spec[-s]?|spec$|.*-architecture)/, a: 'builder', s: 'architecture' },
  { re: /(^|\/)(changelog|release[-s]?|history)/, a: 'builder', s: 'changelog' },
  { re: /(^|\/)(contributing|workflow|development)$/, a: 'builder', s: 'contributing' },
];

// title = '<root>/<path/to/file.md>' → the in-root path, lowercased, extension dropped.
export function docPathOf(title) {
  const t = String(title || '');
  const inRoot = t.includes('/') ? t.slice(t.indexOf('/') + 1) : t;
  return inRoot.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
}

// → { audience, section } | null (null = Working notes)
export function classifyDoc({ title } = {}) {
  const p = docPathOf(title);
  if (!p) return null;
  for (const r of RULES) if (r.re.test(p)) return { audience: r.a, section: r.s };
  return null;
}

// sources: [{ title, display_title, file_path, source_kind, readable? }] →
// { audiences: [{ id, label, sections: [{ id, label, docs }] }], notes: [{ dir, docs }] }
// INVARIANT: every input doc appears exactly once (classified or under Working notes).
export function buildDocTree(sources = []) {
  const byKey = new Map();   // 'aud/sec' → docs[]
  const notes = new Map();   // dir → docs[]
  const docOf = (s) => ({
    title: s.title, display_title: s.display_title || s.title, file_path: s.file_path,
    source_kind: s.source_kind, readable: s.readable !== false, id: s.id,
  });
  for (const s of sources) {
    const c = classifyDoc(s);
    if (c) {
      const k = c.audience + '/' + c.section;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(docOf(s));
    } else {
      const p = docPathOf(s.title);
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '(root)';
      if (!notes.has(dir)) notes.set(dir, []);
      notes.get(dir).push(docOf(s));
    }
  }
  const byName = (a, b) => String(a.display_title).localeCompare(String(b.display_title));
  const audiences = DOC_TAXONOMY.map((aud) => ({
    id: aud.id, label: aud.label,
    sections: aud.sections
      .map((sec) => ({ id: sec.id, label: sec.label, docs: (byKey.get(aud.id + '/' + sec.id) || []).sort(byName) }))
      .filter((sec) => sec.docs.length),
  })).filter((aud) => aud.sections.length);
  const notesOut = [...notes.entries()]
    .map(([dir, docs]) => ({ dir, docs: docs.sort(byName) }))
    .sort((a, b) => a.dir.localeCompare(b.dir));
  return { audiences, notes: notesOut };
}
