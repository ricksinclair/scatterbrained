#!/usr/bin/env node
// ============================================================================
// check-notion.js — validate the Notion ID manifest before IDs rot silently.
//
// The brittleness this fixes: data_source_ids were scattered as literals through
// prose (agent instructions, scripts). If a database is recreated, the ID rots and
// the agent only finds out when a write fails mid-task. notion-ids.json is now
// the single source of truth; this checks it.
//
// Two tiers, mirroring notion-index.js:
//   • STRUCTURAL (always, no API): every entry has kind+id, ids are well-formed
//     32-hex / dashed UUIDs, no duplicate ids. Pure-local, honors the repo's
//     "no API keys required" rule.
//   • LIVE (only if NOTION_TOKEN is set): resolve each id against the Notion API
//     and report any that no longer exist. Without a token it prints how to
//     verify the same thing via the Notion MCP in-session and exits clean.
//
// Usage:
//   node scripts/check-notion.js                # structural (+ live if token)
//   node scripts/check-notion.js --project Acme
//   node scripts/check-notion.js --json
// Exit: 1 if any structural problem (or, with a token, any unresolved id).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
const MANIFEST = path.join(REPO_ROOT, 'notion-ids.json');

const HEX32 = /^[0-9a-f]{32}$/i;
const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const wantJson = process.argv.includes('--json');
const onlyProject = getArg('--project');

export function flatten(manifest, onlyProject = null) {
  const out = [];
  for (const [project, p] of Object.entries(manifest.projects || {})) {
    if (onlyProject && project !== onlyProject) continue;
    for (const [name, e] of Object.entries(p.entries || {})) {
      out.push({ project, name, kind: e.kind, id: e.id, purpose: e.purpose });
    }
  }
  return out;
}

// Pure structural validation (no network): kind ∈ {page,data_source}, id is a
// well-formed Notion UUID, no duplicate ids. Returns a problems[] (empty = ok).
export function validateStructural(manifest, onlyProject = null) {
  const problems = [];
  const seen = new Map();
  for (const e of flatten(manifest, onlyProject)) {
    if (!e.kind || !['page', 'data_source'].includes(e.kind))
      problems.push({ level: 'structural', entry: `${e.project}/${e.name}`, issue: `kind must be 'page' or 'data_source' (got '${e.kind}')` });
    if (!e.id || !(HEX32.test(e.id) || DASHED.test(e.id)))
      problems.push({ level: 'structural', entry: `${e.project}/${e.name}`, issue: `id is not a valid Notion UUID: '${e.id}'` });
    const norm = (e.id || '').replace(/-/g, '').toLowerCase();
    if (norm) {
      if (seen.has(norm)) problems.push({ level: 'structural', entry: `${e.project}/${e.name}`, issue: `duplicate id (also ${seen.get(norm)})` });
      else seen.set(norm, `${e.project}/${e.name}`);
    }
  }
  return problems;
}

async function resolveLive(token, id) {
  // An id is either a page or a database; the wrong-type endpoint returns 400/404,
  // so try BOTH and only fail when neither resolves. Auth/permission errors (401/403)
  // are fatal and reported as-is.
  let last = 404;
  for (const kind of ['databases', 'pages']) {
    const res = await fetch(`https://api.notion.com/v1/${kind}/${id.replace(/-/g, '')}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    });
    if (res.ok) return { ok: true, as: kind };
    last = res.status;
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status };
  }
  return { ok: false, status: last };
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`check-notion: ${MANIFEST} not found.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const entries = flatten(manifest, onlyProject);
  const problems = validateStructural(manifest, onlyProject);

  const token = process.env.NOTION_TOKEN;
  let liveChecked = 0;
  if (token) {
    for (const e of entries) {
      if (!e.id) continue;
      const r = await resolveLive(token, e.id);
      liveChecked++;
      if (!r.ok) problems.push({ level: 'live', entry: `${e.project}/${e.name}`, issue: r.status === 404 ? 'id no longer resolves (recreated/deleted?)' : `Notion API ${r.status}` });
    }
  }

  if (wantJson) {
    console.log(JSON.stringify({ entries: entries.length, liveChecked, tokenPresent: Boolean(token), problems }, null, 2));
    process.exit(problems.length ? 1 : 0);
  }

  console.log(`\n🔗 Notion ID check — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${onlyProject ? ` (project=${onlyProject})` : ''}\n`);
  if (problems.length === 0) {
    console.log(`✅ structural OK${token ? ` · ✅ ${liveChecked} resolved live` : ' · live skipped (no NOTION_TOKEN)'}\n`);
    if (!token) console.log('   To verify live without a token, resolve each id with the Notion MCP (notion-fetch) in-session.\n');
    process.exit(0);
  }
  for (const p of problems) console.log(`  ❌ [${p.level}] ${p.entry} — ${p.issue}`);
  console.log(`\n❌ ${problems.length} problem(s).\n`);
  process.exit(1);
}

// Run as a CLI only when invoked directly (so tests can import the exports).
if (process.argv[1] && process.argv[1].endsWith('check-notion.js')) {
  main().catch((err) => {
    console.error('check-notion error:', err.message);
    process.exit(2);
  });
}
