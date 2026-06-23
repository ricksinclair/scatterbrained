// filetree.js — pure helpers to turn a flat file list into a nested, collapsible
// directory tree for the code-review left rail. No DOM; fully unit-tested.

// Build a nested tree from flat files. Each file: { rel, path, lang }.
// Returns a root node: { name, path, dirs:Map<name,node>, files:[{name,path,rel,lang}] }.
export function buildFileTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || !f.rel) continue;
    const parts = String(f.rel).split('/');
    const fname = parts.pop();
    let node = root, acc = '';
    for (const p of parts) {
      acc = acc ? acc + '/' + p : p;
      if (!node.dirs.has(p)) node.dirs.set(p, { name: p, path: acc, dirs: new Map(), files: [] });
      node = node.dirs.get(p);
    }
    node.files.push({ name: fname, path: f.path, rel: f.rel, lang: f.lang });
  }
  return root;
}

// Flatten the tree into an ordered render list, honoring a set of collapsed dir paths.
// Dirs sort before files, each alphabetical; collapsed dirs hide their subtree.
// Rows: { type:'dir'|'file', name, path, depth, collapsed?, rel?, lang? }.
export function flattenTree(root, collapsed) {
  const skip = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  const out = [];
  (function walk(node, depth) {
    [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((d) => {
      const isCollapsed = skip.has(d.path);
      out.push({ type: 'dir', name: d.name, path: d.path, depth, collapsed: isCollapsed });
      if (!isCollapsed) walk(d, depth + 1);
    });
    node.files.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((f) => {
      out.push({ type: 'file', name: f.name, path: f.path, rel: f.rel, lang: f.lang, depth });
    });
  })(root, 0);
  return out;
}
