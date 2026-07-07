// Codebase map (dev persona) — pure logic for turning a repo's files into a module
// graph. The fs walk lives in server.js (impure, sandboxed to the allowlist); this
// file is the tested core: what to ignore, how to classify a file, how to parse its
// imports, and how to resolve those to edges between files in the same repo.
//
// Deliberately language-aware but lightweight: a regex import scan, not a real parser.
// It is allowed to miss exotic syntax — the map is a navigation aid, not a compiler.

// Directories never worth mapping — build output, deps, VCS, caches.
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
  'coverage', 'vendor', '.cache', '.turbo', '.parcel-cache', '__pycache__', '.venv',
  'venv', 'target', '.idea', '.vscode', '.DS_Store', 'tmp', '.terraform',
]);

// Extension → language. Drives node color and which reference parser runs. Asset kinds
// (image/font) matter so a JPEG/font connects to the page/stylesheet that references it.
const EXT_LANG = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  py: 'py', go: 'go', rs: 'rust', java: 'java', rb: 'ruby', php: 'php',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp', swift: 'swift',
  css: 'css', scss: 'css', sass: 'css', less: 'css', html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte',
  json: 'data', yaml: 'data', yml: 'data', toml: 'data', md: 'doc', mdx: 'doc', txt: 'doc',
  sh: 'shell', bash: 'shell', sql: 'sql',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image', ico: 'image', avif: 'image', bmp: 'image',
  woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', eot: 'font',
  mp4: 'media', webm: 'media', mp3: 'media', wav: 'media', pdf: 'doc',
};
export function langOf(filePath) {
  const m = /\.([a-z0-9]+)$/i.exec(String(filePath || ''));
  return m ? (EXT_LANG[m[1].toLowerCase()] || 'other') : 'other';
}
// Languages whose imports we resolve (bare = external package, dropped).
const IMPORT_LANGS = new Set(['js', 'ts', 'vue', 'svelte', 'css']);
// Markup/doc/config langs that *reference* local files (src/href/url, markdown links,
// or config path values like angular.json's main / package.json's module) — here a bare
// path like "src/main.ts" IS a local file, not a package. Config files are the build's
// linkers: they wire entries/assets that no source file statically references.
const REF_LANGS = new Set(['html', 'doc', 'data']);
export function parsesImports(lang) { return IMPORT_LANGS.has(lang); }
// Any file whose text we read to extract edges (imports OR references).
export function extractsRefs(lang) { return IMPORT_LANGS.has(lang) || REF_LANGS.has(lang); }

const stripQuery = (s) => String(s).replace(/[?#].*$/, '');   // drop ?v=2 / #frag on asset urls
// A local file reference (not a URL, protocol, anchor, or data: blob).
const isLocalRef = (s) => !!s && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(s);

// Extract the local files a source references — by import (code) or by src/href/url/link
// (markup, styles, docs). Returns relative specifiers; the resolver turns them into edges.
export function parseImports(text, lang) {
  const src = String(text || '');
  const grab = (re, idxs = [1]) => { const out = []; let m; while ((m = re.exec(src))) { for (const i of idxs) if (m[i]) out.push(m[i]); } return out; };
  if (lang === 'js' || lang === 'ts' || lang === 'vue' || lang === 'svelte') {
    // import…from 'x' | import 'x' | import('x')/require('x') | new URL('x', import.meta.url)
    const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[^.\w])import\s*['"]([^'"]+)['"]|(?:^|[^.\w])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)|new\s+URL\(\s*['"]([^'"]+)['"]/gm;
    return grab(re, [1, 2, 3, 4]).map(stripQuery).filter((s) => s.startsWith('.') || s.startsWith('/'));
  }
  if (lang === 'css') {
    // @import "x" and url(x) for assets/fonts/backgrounds
    return [...grab(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/g), ...grab(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
      .map(stripQuery).filter(isLocalRef);
  }
  if (lang === 'html') {
    // src="…" / href="…" (images, scripts, styles, links) + inline ES-module imports
    return [...grab(/(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi), ...grab(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)]
      .map(stripQuery).filter(isLocalRef);
  }
  if (lang === 'doc') {
    // markdown [text](path) and ![alt](path) to local files
    return grab(/!?\[[^\]]*\]\(\s*([^)\s]+)/g).map(stripQuery).filter(isLocalRef);
  }
  if (lang === 'data') {
    // config/manifest path values (angular.json main, package.json module, tsconfig
    // extends, …). Grab pathy quoted strings; resolution against real files drops noise.
    return grab(/"([^"\s]*(?:\/[^"\s]*|\.[a-z0-9]{1,6}))"/gi).map(stripQuery).filter(isLocalRef);
  }
  return [];
}

// Normalize a POSIX-style relative path, collapsing '.' and '..' segments.
export function normalizeRel(p) {
  const parts = String(p).split('/');
  const stack = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (stack.length && stack[stack.length - 1] !== '..') stack.pop(); else stack.push('..'); }
    else stack.push(seg);
  }
  return stack.join('/');
}

// Resolve an import specifier (relative to fromRel) against the set of repo files,
// trying common extension/index completions. Returns the matched rel path or null
// (external package, or a target outside the mapped set).
export function resolveImport(fromRel, spec, relSet) {
  const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
  const base = normalizeRel((dir ? dir + '/' : '') + spec);
  if (relSet.has(base)) return base;
  const exts = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'css', 'scss', 'html'];
  for (const e of exts) if (relSet.has(`${base}.${e}`)) return `${base}.${e}`;
  for (const e of exts) if (relSet.has(`${base}/index.${e}`)) return `${base}/index.${e}`;
  return null;
}

// Static roots a web app serves at "/", so a reference like "img/x.png" or "/img/x.png"
// (omitting the on-disk prefix) still maps to public/img/x.png etc.
export const STATIC_ROOTS = ['public', 'static', 'assets', 'src/assets', 'www', 'public_html', 'site'];

// Resolve a markup/style/doc reference. Tries the normal relative resolution first; if
// that misses (common for web assets), falls back to the repo's static roots — the
// general fix for "this JPEG is referenced by the page but lives under public/".
export function resolveRef(fromRel, spec, relSet, staticRoots = STATIC_ROOTS) {
  const direct = resolveImport(fromRel, spec, relSet);
  if (direct) return direct;
  const bare = normalizeRel(String(spec).replace(/^\/+/, ''));
  if (!bare) return null;
  if (relSet.has(bare)) return bare;
  for (const r of staticRoots) if (relSet.has(`${r}/${bare}`)) return `${r}/${bare}`;
  return null;
}

// Build the module graph from walked files. `files` = [{ rel, text }] (text optional;
// only needed for IMPORT_LANGS). Nodes carry lang + the directory for grouping; links
// are resolved in-repo imports, de-duplicated. importsRaw/importsResolved feed metrics.
export function buildModuleGraph(files) {
  const list = files.map((f) => ({ rel: f.rel, lang: langOf(f.rel), text: f.text || '' }));
  const relSet = new Set(list.map((f) => f.rel));
  const nodes = list.map((f) => ({
    id: f.rel,
    name: f.rel.includes('/') ? f.rel.slice(f.rel.lastIndexOf('/') + 1) : f.rel,
    rel: f.rel,
    dir: f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '',
    lang: f.lang,
    deg: 0,
  }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  // Static roots actually present in this repo (so web-root asset refs resolve).
  const presentRoots = STATIC_ROOTS.filter((r) => list.some((f) => f.rel.startsWith(r + '/')));
  const seen = new Set();
  const links = [];
  for (const f of list) {
    if (!extractsRefs(f.lang)) continue;
    const useRef = REF_LANGS.has(f.lang) || f.lang === 'css';   // markup/style/doc carry asset refs
    for (const spec of parseImports(f.text, f.lang)) {
      const target = useRef ? resolveRef(f.rel, spec, relSet, presentRoots) : resolveImport(f.rel, spec, relSet);
      if (!target || target === f.rel) continue;
      const key = f.rel + ' ' + target;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: f.rel, target });
      byId[f.rel].deg++; byId[target].deg++;
    }
  }
  // Convention edge: an index.html is the shell that boots the app's JS/TS entry. That
  // wiring lives in the build (Angular/Vite/CRA), not in any file's content, so connect
  // it — but only when the config declares exactly ONE js/ts entry (no guessing).
  const entries = [...new Set(links
    .filter((l) => byId[l.source] && byId[l.source].lang === 'data' && byId[l.target] && /^(js|ts)$/.test(byId[l.target].lang))
    .map((l) => l.target))];
  if (entries.length === 1) {
    const entry = entries[0];
    for (const n of nodes) {
      if (n.name !== 'index.html' || n.id === entry) continue;
      const key = n.id + ' ' + entry;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: n.id, target: entry, kind: 'entry' });
      byId[n.id].deg++; byId[entry].deg++;
    }
  }
  return { nodes, links };
}

// ── graph queries (pure) — the agent-facing surface over a {nodes, links} graph ──
// links are directed: {source, target} means `source` imports `target`.
const uniq = (a) => [...new Set(a)];

function reach(start, neighborsOf) {            // BFS, excludes the start node itself
  const seen = new Set([start]); const out = []; const q = [start];
  while (q.length) { for (const n of neighborsOf(q.shift())) if (!seen.has(n)) { seen.add(n); out.push(n); q.push(n); } }
  return out;
}

// Files that import `file` (the impact set if you change it). transitive → all upstream.
export function dependents(graph, file, opts = {}) {
  const inOf = (n) => graph.links.filter((l) => l.target === n).map((l) => l.source);
  return opts.transitive ? reach(file, inOf) : uniq(inOf(file));
}

// Files that `file` imports. transitive → the full downstream closure.
export function dependencies(graph, file, opts = {}) {
  const outOf = (n) => graph.links.filter((l) => l.source === n).map((l) => l.target);
  return opts.transitive ? reach(file, outOf) : uniq(outOf(file));
}

// Shortest import path from → to (following source→target edges), or null. Includes endpoints.
export function findPath(graph, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, null]]); const q = [from];
  while (q.length) {
    const n = q.shift();
    for (const m of graph.links.filter((l) => l.source === n).map((l) => l.target)) {
      if (prev.has(m)) continue;
      prev.set(m, n);
      if (m === to) { const path = [m]; let c = n; while (c != null) { path.unshift(c); c = prev.get(c); } return path; }
      q.push(m);
    }
  }
  return null;
}

// Files nothing imports (candidate dead code / entry points — caller judges which).
export function orphans(graph) {
  const imported = new Set(graph.links.map((l) => l.target));
  return graph.nodes.filter((n) => !imported.has(n.id)).map((n) => n.id);
}

// Import cycles (strongly-connected components of size > 1), via Tarjan's algorithm.
export function cycles(graph) {
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const l of graph.links) if (adj.has(l.source)) adj.get(l.source).push(l.target);
  let idx = 0; const index = new Map(), low = new Map(), onStack = new Set(), stack = [], out = [];
  const strong = (v) => {
    index.set(v, idx); low.set(v, idx); idx++; stack.push(v); onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      const comp = []; let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) out.push(comp.reverse());
    }
  };
  for (const n of graph.nodes) if (!index.has(n.id)) strong(n.id);
  return out;
}

// Headline stats + the hub files an agent should read first (highest combined degree).
export function summary(graph, topN = 10) {
  const deg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const l of graph.links) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1); }
  const langs = {};
  for (const n of graph.nodes) langs[n.lang] = (langs[n.lang] || 0) + 1;
  const hubs = graph.nodes.map((n) => ({ file: n.id, degree: deg.get(n.id) || 0 }))
    .sort((a, b) => b.degree - a.degree).slice(0, topN);
  return { fileCount: graph.nodes.length, edgeCount: graph.links.length, languages: langs, hubs };
}

// The skimmable, decision-carrying view of a repo — hubs to read first, unreferenced CODE
// (dead module or entry point), and genuine CODE import cycles. This is the useful CORE the
// old force-graph never surfaced: a ranked answer to "what's the shape of this repo," not a
// hairball. ONE function, TWO consumers — the Studio Code lens and the agent brief — so the
// human sees exactly what a launched agent gets. `file` fields are repo-relative; callers
// attach absolute paths / render as they need.
//
// Noise discipline — the filters are what make this TRUSTWORTHY rather than misleading (a
// "dead code" list full of live files re-earns "useless"). Raw `orphans()`/`cycles()` stay
// pure (the CLI shows everything); the honesty rules live HERE, where the audience is "which
// of my SOURCE modules is dead / tangled / worth reading first":
//   • Hubs exclude TEST files — a big integration test imports many files (high degree) but is
//     never "read this first" (CoopOS put a testing helper at degree 46 as hub #2).
//   • Unreferenced is SOURCE-only (js/ts/vue/svelte) and drops TESTS: CSS/SCSS is excluded
//     because Angular `styleUrls` / scss `@use` refs aren't parsed, so an "unreferenced"
//     stylesheet is usually a FALSE positive; test files are runner entry points, not dead.
//   • Cycles keep only all-code-lang loops (drops tsconfig `extends` chains — not coupling).
const SRC_LANGS = new Set(['js', 'ts', 'vue', 'svelte']);
const isTestFile = (rel) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(rel)
  || /(^|\/)(__tests__|e2e)(\/|$)/.test(rel) || /(^|\/)(test|tests|testing)\//.test(rel);

export function repoInsights(graph, { topN = 12 } = {}) {
  const langByRel = new Map(graph.nodes.map((n) => [n.id, n.lang]));
  const deg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const l of graph.links) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1); }
  const langs = {};
  for (const n of graph.nodes) langs[n.lang] = (langs[n.lang] || 0) + 1;
  const hubs = graph.nodes
    .filter((n) => !isTestFile(n.id) && (deg.get(n.id) || 0) > 0)   // degree-0 isn't a hub; tests aren't read-first
    .map((n) => ({ file: n.id, degree: deg.get(n.id), lang: n.lang }))
    .sort((a, b) => b.degree - a.degree).slice(0, topN);
  const unreferenced = orphans(graph)
    .filter((f) => SRC_LANGS.has(langByRel.get(f)) && !isTestFile(f))
    .map((f) => ({ file: f, lang: langByRel.get(f) }));
  const codeCycles = cycles(graph).filter((c) => c.every((f) => parsesImports(langByRel.get(f))));
  return { fileCount: graph.nodes.length, edgeCount: graph.links.length, languages: langs, hubs, unreferenced, cycles: codeCycles };
}
