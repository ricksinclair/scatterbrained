#!/usr/bin/env node
// release-sanity.js — the privacy/rebrand gate for the public Scatterbrained release (#16).
//
// Sanitization for the #17 extraction is otherwise purely manual (the move-list discipline in
// docs/internal/PLAN-alpha-release.md). This turns it into an enforced check: scan the extractable
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

// Files/dirs that carry your personal data — must NEVER ship in the public repo.
// Note: an empty `backups/` (ships with just .gitkeep) is legitimate in the public repo,
// so it is NOT forbidden by name — it's skipped (see SKIP_DIRS) and `graph.json` is forbidden
// wherever it appears.
const FORBIDDEN = new Set([
  'graph.json', 'notion-ids.json', 'document-sources.json',
  'COLLABORATION-PROTOCOL.md', '.env',
]);
// The retired brand — the rebrand must be complete in anything public.
const REBRAND_RE = /engram/i;
// Project-specific overfit — terms tied to the maintainer's OTHER projects/domains that
// crept in because the public repo was authored from a private source. The denylist must
// NEVER be hardcoded here (that would publish the very private names it guards — same lesson
// as the CI leak gate): it comes from the FORBIDDEN_TERMS env (a pipe-separated regex, held
// in an encrypted Actions secret / your local env). Unset → the scan skips cleanly (forks,
// fresh clones). And we report only a COUNT — never the matched line or filename, either of
// which could itself contain a private term.
const DOMAIN_RE = process.env.FORBIDDEN_TERMS ? new RegExp(process.env.FORBIDDEN_TERMS, 'i') : null;
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
const domainHitFiles = new Set();   // distinct files matching FORBIDDEN_TERMS — COUNT only, names never reported

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
    if (DOMAIN_RE && DOMAIN_RE.test(text)) domainHitFiles.add(full);   // file-level test; never store the line
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

if (!DOMAIN_RE) {
  console.log('ℹ️  project-specific term scan skipped (FORBIDDEN_TERMS not set — fork or unconfigured)');
} else if (domainHitFiles.size) {
  // COUNT only — never the file path or matched line; either could leak a private term.
  console.log(`\n⚠️  ${domainHitFiles.size} file(s) contain a forbidden project-specific term — scrub before publishing (terms/paths not shown by design)`);
} else {
  console.log('✅ no project-specific overfit terms');
}

const totalWarns = warns.length + domainHitFiles.size;
console.log(`\n${errors.length ? '❌ FAIL' : '✅ PASS'} — ${errors.length} errors, ${totalWarns} warnings.\n`);
process.exit(errors.length ? 1 : 0);
