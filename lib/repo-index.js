// Repo indexing — the impure (fs) half of the codebase graph, shared by the Studio's
// /api/repo route and the code-graph CLI. The walk + grapher live here; all the pure
// query logic (dependents/path/cycles/…) lives in codebase.js so it stays testable.
import fs from 'node:fs';
import path from 'node:path';
import { langOf, extractsRefs, IGNORE_DIRS, buildModuleGraph } from './codebase.js';

export const REPO_MAX_FILES = 1200;     // walk ceiling (the map is a guide, not an index)
export const REPO_PARSE_MAX = 256 * 1024;

// Walk a directory into the flat file list the module-grapher expects. Skips IGNORE_DIRS
// and dotfiles; reads text only for import-bearing languages (to scan their imports).
export function walkRepo(rootDir, opts = {}) {
  const maxFiles = opts.maxFiles || REPO_MAX_FILES;
  const files = [];
  let truncated = false;
  const stack = [rootDir];
  while (stack.length) {
    if (files.length >= maxFiles) { truncated = true; break; }
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (e.name.startsWith('.')) continue;
        const rel = path.relative(rootDir, full).split(path.sep).join('/');
        const lang = langOf(rel);
        let text = '';
        if (extractsRefs(lang)) {
          try { if (fs.statSync(full).size <= REPO_PARSE_MAX) text = fs.readFileSync(full, 'utf8'); } catch { /* skip */ }
        }
        files.push({ rel, path: full, text });
        if (files.length >= maxFiles) { truncated = true; break; }
      }
    }
  }
  return { files, truncated };
}

// Walk + build the module graph for a repo, with absolute paths attached to each node.
export function indexRepo(rootDir, opts = {}) {
  const { files, truncated } = walkRepo(rootDir, opts);
  const graph = buildModuleGraph(files);
  const byRel = Object.fromEntries(files.map((f) => [f.rel, f.path]));
  graph.nodes.forEach((n) => { n.path = byRel[n.rel]; });
  graph.truncated = truncated;
  graph.root = rootDir;
  return graph;
}
