#!/usr/bin/env node
// ============================================================================
// document-index.js — deterministic "what changed?" probe for local documents.
//
// The all-seeing eye's filesystem lane. The filesystem twin of notion-index.js,
// generalized beyond Markdown to any document type: text (.md/.markdown/.txt/
// .rst) AND binary (.pdf/.docx/.pptx). Walks the curated roots in
// document-sources.json, hashes every tracked file, compares each hash to the
// content_hash on its :Source node in Neo4j, and prints ONLY new/changed files.
//
// Pure detection: hashes + metadata, never bodies, never an LLM. Text files are
// hashed as UTF-8 (and their first heading is sniffed for a display title);
// binary files are hashed as raw bytes (extraction is the skill's job — the
// Read tool reads PDFs, the pdf/docx/pptx skills handle the rest). Keeping
// extraction out of this script is what lets the eye see every format without
// a single new dependency or API key.
//
// Identity: a file's :Source is keyed on `title` = its path RELATIVE to its
// root (stable across edits; a heading can change, a path rarely does). The
// absolute path is stored as `file_path`; `source_kind` records the type.
//
// Usage:
//   node scripts/document-index.js                 # new + changed docs, as JSON
//   node scripts/document-index.js --all           # treat every tracked doc as changed (re-ingest)
//   node scripts/document-index.js --limit 25      # cap the changed-set (batch big first runs)
//   node scripts/document-index.js --root acme   # restrict to roots whose path matches a substring
//   node scripts/document-index.js --kind pdf      # restrict to one source_kind (markdown|text|pdf|docx|pptx)
//   node scripts/document-index.js --stats         # print counts to stderr
//
// Output: JSON array on stdout, newest-mtime first:
//   [{ title, file_path, source_kind, display_title, status, hash, mtime, bytes, tags }]
// status is "new" | "changed". An empty array means nothing changed.
// Exit 2 = no config / no roots (caller should skip the document lane).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'document-sources.json');

// extension -> source_kind. The first map's keys are treated as UTF-8 text
// (heading sniffed); the second map's keys are hashed as raw bytes.
const TEXT_KINDS = { '.md': 'markdown', '.markdown': 'markdown', '.txt': 'text', '.rst': 'text' };
const BINARY_KINDS = { '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx' };

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// First markdown/text H1 (`# ...`), else null. Cheap, tolerant of front-matter.
function firstHeading(text) {
  for (const line of text.split('\n').slice(0, 200)) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (m) return m[1].trim();
  }
  return null;
}

// Recursive walk with a directory denylist. Dependency-free (no glob lib).
function walk(dir, cfg, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip quietly
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (cfg.excludeDirs.includes(ent.name) || ent.name.startsWith('.')) continue;
      walk(full, cfg, out);
    } else if (ent.isFile()) {
      if (cfg.excludeFiles.includes(ent.name)) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const kind = cfg.kindOf[ext];
      if (!kind) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      const cap = BINARY_KINDS[ext] ? cfg.maxBinaryBytes : cfg.maxFileBytes;
      if (st.size > cap) continue;
      out.push({ full, ext, kind, mtimeMs: st.mtimeMs, bytes: st.size });
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`document-index: ${CONFIG_PATH} not found — document lane inactive.`);
    process.exit(2);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // Build the active extension->kind map from config (falling back to defaults),
  // honoring an optional --kind filter.
  const kindFilter = args.kind ? String(args.kind).toLowerCase() : null;
  const allKinds = { ...TEXT_KINDS, ...BINARY_KINDS };
  const enabledExts = (raw.extensions && raw.extensions.length ? raw.extensions : Object.keys(allKinds)).map((e) =>
    e.toLowerCase()
  );
  const kindOf = {};
  for (const ext of enabledExts) {
    const kind = allKinds[ext];
    if (!kind) continue; // unknown extension in config — ignore
    if (kindFilter && kind !== kindFilter) continue;
    kindOf[ext] = kind;
  }
  const cfg = {
    kindOf,
    excludeDirs: raw.excludeDirs || [],
    excludeFiles: raw.excludeFiles || [],
    maxFileBytes: raw.maxFileBytes || 250000,
    maxBinaryBytes: raw.maxBinaryBytes || 26214400, // 25 MB — binaries are only hashed, not parsed here
  };
  if (!Object.keys(kindOf).length) {
    console.error('document-index: no enabled extensions (check config / --kind).');
    process.exit(2);
  }

  let roots = (raw.roots || []).map((r) => ({ ...r, abs: expandHome(r.path) }));
  if (args.root)
    roots = roots.filter((r) => r.path.toLowerCase().includes(String(args.root).toLowerCase()));
  if (!roots.length) {
    console.error('document-index: no roots configured (or --root matched none).');
    process.exit(2);
  }

  // Collect every tracked file, tagging each with its root's tags + rel-path title.
  const files = [];
  for (const root of roots) {
    if (!fs.existsSync(root.abs)) {
      console.error(`document-index: root not found, skipping: ${root.abs}`);
      continue;
    }
    const found = [];
    walk(root.abs, cfg, found);
    const rootName = path.basename(root.abs);
    for (const f of found) {
      const rel = path.relative(root.abs, f.full);
      files.push({
        file_path: f.full,
        title: `${rootName}/${rel}`, // canonical, unique, stable Source key
        source_kind: f.kind,
        ext: f.ext,
        rootTags: root.tags || [],
        mtimeMs: f.mtimeMs,
        bytes: f.bytes,
      });
    }
  }

  // Pull stored hashes for ALL file Sources in one query (any source_kind that
  // came from disk has a file_path).
  const driver = getDriver();
  const stored = new Map();
  try {
    const recs = await run(
      driver,
      `MATCH (s:Source) WHERE s.file_path IS NOT NULL
       RETURN s.file_path AS fp, s.content_hash AS hash`
    );
    for (const r of recs) stored.set(toPlain(r.get('fp')), toPlain(r.get('hash')));
  } finally {
    await driver.close();
  }

  // Hash every file (UTF-8 for text, raw bytes for binary), then collapse exact
  // content duplicates (a doc and its build/app mirror, or the same PDF saved
  // twice). Keep the canonical copy = shortest path, so one logical document
  // maps to one :Source instead of being ingested two or three times.
  const hashed = [];
  for (const f of files) {
    let buf;
    try {
      buf = fs.readFileSync(f.file_path);
    } catch {
      continue;
    }
    const isText = Boolean(TEXT_KINDS[f.ext]);
    const heading = isText ? firstHeading(buf.toString('utf8')) : null;
    hashed.push({ ...f, hash: sha256(buf), heading });
  }
  const byHash = new Map();
  for (const f of hashed) {
    const cur = byHash.get(f.hash);
    if (!cur || f.file_path.length < cur.file_path.length) byHash.set(f.hash, f);
  }
  const canonical = [...byHash.values()];
  const dupes = hashed.length - canonical.length;

  const forceAll = Boolean(args.all);
  const changed = [];
  let unchanged = 0;
  for (const f of canonical) {
    const prev = stored.get(f.file_path);
    const status = prev === undefined ? 'new' : 'changed';
    if (!forceAll && prev === f.hash) {
      unchanged++;
      continue;
    }
    changed.push({
      title: f.title,
      file_path: f.file_path,
      source_kind: f.source_kind,
      display_title: f.heading, // null for binaries — the skill fills it on ingest
      status: forceAll && prev !== undefined ? 'changed' : status,
      hash: f.hash,
      mtime: new Date(f.mtimeMs).toISOString(),
      bytes: f.bytes,
      tags: f.rootTags,
    });
  }

  changed.sort((a, b) => Date.parse(b.mtime) - Date.parse(a.mtime));
  const limit = args.limit ? Number(args.limit) : Infinity;
  const out = Number.isFinite(limit) ? changed.slice(0, limit) : changed;

  if (args.stats) {
    const newN = changed.filter((c) => c.status === 'new').length;
    const byKind = {};
    for (const c of changed) byKind[c.source_kind] = (byKind[c.source_kind] || 0) + 1;
    const kindStr = Object.entries(byKind)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');
    console.error(
      `document-index: ${files.length} tracked · ${canonical.length} unique (${dupes} dup copies collapsed) · ` +
        `${newN} new · ${changed.length - newN} changed · ${unchanged} unchanged` +
        (kindStr ? ` · changed by kind: ${kindStr}` : '') +
        (out.length < changed.length ? ` · emitting ${out.length} (--limit)` : '')
    );
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error('document-index error:', err.message);
  process.exit(1);
});
