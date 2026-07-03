// impact.js — pure client-side impact queries over a module graph's {nodes, links}
// (links are directed: `source` imports `target`). Mirrors the tested server helpers in
// lib/codebase.js (dependents/dependencies) but runs in the browser with NO round-trip, for
// the Code-lens impact view ("what breaks if I change X · what X pulls in"). Kept pure +
// dependency-free so it's unit-tested exactly as shipped. Files are referenced by `rel`.
const uniq = (a) => [...new Set(a)];

// What `file` imports (its direct dependencies).
export function importsOf(links, file) {
  return uniq(links.filter((l) => l.source === file).map((l) => l.target));
}
// What imports `file` (its direct dependents — the direct blast radius of a change).
export function importedBy(links, file) {
  return uniq(links.filter((l) => l.target === file).map((l) => l.source));
}
// Transitive blast radius: every file that (in)directly imports `file` (excludes itself).
// The honest "how far a change here can ripple" number.
export function blastRadius(links, file) {
  const inOf = (n) => links.filter((l) => l.target === n).map((l) => l.source);
  const seen = new Set([file]); const q = [file]; const out = [];
  while (q.length) { for (const m of inOf(q.shift())) if (!seen.has(m)) { seen.add(m); out.push(m); q.push(m); } }
  return out;
}
// The 1-hop ego graph around `file`: nodes = file + its importers + its imports; links =
// the directed edges touching `file`. `nodeOf(rel)` supplies display fields (name/lang/path).
// This is the bounded, readable "diagram" — deliberately NOT the whole-repo hairball; `limit`
// caps each side so a hub file (dozens of dependents) still draws legibly (the lists stay full).
export function egoGraph(links, file, nodeOf = () => ({}), limit = Infinity) {
  const imp = importsOf(links, file).slice(0, limit), by = importedBy(links, file).slice(0, limit);
  const ids = uniq([file, ...imp, ...by]);
  const nodes = ids.map((id) => {
    const n = nodeOf(id) || {};
    return { id, name: n.name || id, lang: n.lang || 'other', path: n.path, focus: id === file };
  });
  const egoLinks = [...by.map((s) => ({ source: s, target: file })), ...imp.map((t) => ({ source: file, target: t }))];
  return { nodes, links: egoLinks };
}
