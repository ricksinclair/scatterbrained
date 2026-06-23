#!/usr/bin/env node
// release-sanity.js — the privacy/rebrand gate for the public Scatterbrained release (#16).
//
// Sanitization for the #17 extraction is otherwise purely manual (the move-list discipline in
// docs/RELEASE-alpha-plan.md). This turns it into an enforced check: scan the extractable
// surface (or an extraction output dir) and FAIL if any personal data or rebrand leftover is
// present.
//
// Usage:
//   node scripts/release-sanity.js                 # scan the default extractable surface
//   node scripts/release-sanity.js <dir> [<dir>…]  # scan an extraction output tree
//
// ERROR (exit 1): a forbidden personal-data file is present.
// WARN (exit 0):  an "engram" reference lingers (rebrand should be complete) — reported.
import fs from 'node:fs';
import path from 'node:path';

// Files/dirs that carry Rick's personal data — must NEVER ship in the public repo.
// Note: an empty `backups/` (ships with just .gitkeep) is legitimate in the public repo,
// so it is NOT forbidden by name — it's skipped (see SKIP_DIRS) and `graph.json` is forbidden
// wherever it appears.
const FORBIDDEN = new Set([
  'graph.json', 'notion-ids.json', 'document-sources.json',
  'COLLABORATION-PROTOCOL.md', '.env',
]);
// The retired brand — the rebrand must be complete in anything public.
const REBRAND_RE = /engram/i;
// Files whose JOB is to contain the retired token — the rebrand alias map and this
// gate itself. They legitimately mention "engram"; don't flag them as leftovers.
const REBRAND_SKIP = new Set(['aliases.js', 'release-sanity.js']);
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.cypher', '.html', '.css', '.txt', '.yml', '.yaml']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'backups']);

const roots = process.argv.slice(2);
const DEFAULT_ROOTS = ['.'];
const targets = (roots.length ? roots : DEFAULT_ROOTS).map((r) => path.resolve(r));

const errors = [];
const warns = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (FORBIDDEN.has(e.name)) { errors.push(`forbidden ${e.isDirectory() ? 'dir' : 'file'}: ${full}`); continue; }
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
    if (!TEXT_EXT.has(path.extname(e.name))) continue;
    if (REBRAND_SKIP.has(e.name)) continue;
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      if (REBRAND_RE.test(line)) warns.push(`${full}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
}

for (const t of targets) walk(t);

console.log('\n🔒 Release sanity — personal-data + rebrand gate\n');
console.log(`Scanned: ${targets.map((t) => path.relative(process.cwd(), t) || '.').join(', ')}\n`);

if (errors.length) {
  console.log(`❌ ${errors.length} forbidden personal-data path(s):`);
  for (const e of errors) console.log(`   • ${e}`);
} else {
  console.log('✅ no personal-data files present');
}

if (warns.length) {
  console.log(`\n⚠️  ${warns.length} lingering "engram" reference(s) — finish the rebrand before publishing:`);
  for (const w of warns.slice(0, 30)) console.log(`   • ${w}`);
  if (warns.length > 30) console.log(`   … and ${warns.length - 30} more`);
} else {
  console.log('✅ no "engram" rebrand leftovers');
}

console.log(`\n${errors.length ? '❌ FAIL' : '✅ PASS'} — ${errors.length} errors, ${warns.length} warnings.\n`);
process.exit(errors.length ? 1 : 0);
