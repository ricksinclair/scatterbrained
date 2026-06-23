#!/usr/bin/env node
// code-graph — query a repo's import structure from the command line.
//
// Phase 0 of SPEC-code-graph-agent.md: a dependency-free CLI an agent can call via the
// shell to answer structural questions in one lookup instead of N greps + reads. The
// index is rebuilt on every run (a few-hundred-file walk is sub-second), so it is always
// fresh — never stale. It caches STRUCTURE, not semantics: use it to find the right
// files fast, then read them.
//
// Usage:
//   node bin/code-graph.mjs summary       <repo>
//   node bin/code-graph.mjs dependents    <repo> <file> [--transitive]
//   node bin/code-graph.mjs dependencies  <repo> <file> [--transitive]
//   node bin/code-graph.mjs path          <repo> <from> <to>
//   node bin/code-graph.mjs orphans       <repo>
//   node bin/code-graph.mjs cycles        <repo>
//   ...add --json for machine-readable output.
import path from 'node:path';
import os from 'node:os';
import { indexRepo } from '../lib/repo-index.js';
import { dependents, dependencies, findPath, orphans, cycles, summary } from '../lib/codebase.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const pos = argv.filter((a) => !a.startsWith('--'));
const [cmd, repoArg, ...rest] = pos;
const json = flags.has('--json');
const transitive = flags.has('--transitive');

function die(msg) { console.error(msg); process.exit(1); }
if (!cmd || !repoArg) die('usage: code-graph <summary|dependents|dependencies|path|orphans|cycles> <repo> [args] [--transitive] [--json]');

const repo = path.resolve(repoArg.startsWith('~') ? path.join(os.homedir(), repoArg.slice(1)) : repoArg);
const graph = indexRepo(repo);
// Accept a file arg as repo-relative or absolute (normalize to the rel keys the graph uses).
const rel = (f) => {
  if (!f) return f;
  const abs = path.resolve(f);
  if (abs.startsWith(repo + path.sep)) return path.relative(repo, abs).split(path.sep).join('/');
  return f.split(path.sep).join('/');
};
const out = (obj, lines) => { if (json) console.log(JSON.stringify(obj, null, 2)); else console.log(lines); };

switch (cmd) {
  case 'summary': {
    const s = summary(graph);
    out(s, [
      `${graph.root}`,
      `${s.fileCount} files · ${s.edgeCount} imports${graph.truncated ? ' · (truncated)' : ''}`,
      `languages: ${Object.entries(s.languages).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`,
      `hubs (most-connected):`,
      ...s.hubs.map((h) => `  ${String(h.degree).padStart(3)}  ${h.file}`),
    ].join('\n'));
    break;
  }
  case 'dependents': {
    const f = rel(rest[0]); if (!f) die('need a <file>');
    const r = dependents(graph, f, { transitive }).sort();
    out({ file: f, transitive, dependents: r }, r.length
      ? `${r.length} file(s) import ${f}${transitive ? ' (transitively)' : ''}:\n` + r.map((x) => '  ' + x).join('\n')
      : `nothing imports ${f}`);
    break;
  }
  case 'dependencies': {
    const f = rel(rest[0]); if (!f) die('need a <file>');
    const r = dependencies(graph, f, { transitive }).sort();
    out({ file: f, transitive, dependencies: r }, r.length
      ? `${f} imports ${r.length} in-repo file(s)${transitive ? ' (transitively)' : ''}:\n` + r.map((x) => '  ' + x).join('\n')
      : `${f} imports no in-repo files`);
    break;
  }
  case 'path': {
    const from = rel(rest[0]), to = rel(rest[1]); if (!from || !to) die('need <from> <to>');
    const p = findPath(graph, from, to);
    out({ from, to, path: p }, p ? p.join('  →  ') : `no import path from ${from} to ${to}`);
    break;
  }
  case 'orphans': {
    const r = orphans(graph).sort();
    out({ orphans: r }, `${r.length} file(s) nothing imports (entry points or dead code):\n` + r.map((x) => '  ' + x).join('\n'));
    break;
  }
  case 'cycles': {
    const c = cycles(graph);
    out({ cycles: c }, c.length ? c.map((cy, i) => `cycle ${i + 1}: ${cy.join(' → ')} → ${cy[0]}`).join('\n') : 'no import cycles');
    break;
  }
  default:
    die(`unknown command: ${cmd}`);
}
