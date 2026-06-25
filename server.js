#!/usr/bin/env node
// ============================================================================
// Scatterbrained Studio — local BFF (backend-for-frontend) for the graph observatory.
//
// A tiny, dependency-free HTTP server (node:http only) that wraps the shared
// Neo4j driver and serves a static single-page "observatory" frontend.
// Secrets stay server-side (.env); the browser only ever talks to localhost.
//
// Endpoints:
//   GET /                     → the observatory SPA
//   GET /api/graph?limit=250  → nodes + links (top-N by degree)
//   GET /api/health           → counts: total, indexed, orphans, superseded, byLabel, newest
//   GET /api/search?q=...      → keyword matches (full-text if available, else CONTAINS)
//   GET /api/node?id=...       → one node: properties, neighbors, supersession chain
//
// Run:  npm run studio   (then open http://localhost:4317)
//
// A no-build node:http BFF over the Neo4j driver. Connection is env-driven
// (NEO4J_URI/USER/PASSWORD) — point it at your own graph; see .env.example.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import neo4j from 'neo4j-driver';
import { acquire as lockAcquire, release as lockRelease, status as lockStatus, prune as lockPrune, HOLDER_STUDIO } from './lib/filelock.js';
import { hashText, validateSave, gitArgs, parseLog, commitMessage } from './lib/save.js';
import { getDriver, run, toPlain } from './scripts/lib/db.js';
import { IDENTITY_LABELS as ALIAS_LABELS, NAME_FIELDS as ALIAS_NAME_FIELDS, brandRegexCypher } from './scripts/lib/aliases.js';
import { keysLookAlike } from './scripts/lib/identity.js';
import { REL_TYPES, REL_SHAPES, isValidRelType, isValidRelShape, isProvenanceRelType } from './scripts/lib/vocab.js';
import { isScheduleKind, isIsoDate } from './public/lib/schedule.js';
import { detectCandidates, normalizeValue, isProtectedFactKind, checkRewrite } from './public/lib/protected-facts.js';
import { isWebUrl, isVideoUrl } from './public/lib/links.js';
import { detectKind, expandRoots, isWithinRoots, pickPrimarySource, excerptAround, TEXT_KINDS } from './lib/source.js';
import { buildModuleGraph } from './lib/codebase.js';
import { walkRepo } from './lib/repo-index.js';
import { unzip, extractText } from './lib/office.js';
import { firstSheet } from './lib/xlsx.js';

// Read a .docx/.pptx off disk and extract its text (dependency-free, size-capped).
function extractOfficeText(fp, kind) {
  if (fs.statSync(fp).size > SOURCE_MAX_BYTES * 8) throw new Error('file too large');
  return extractText(unzip(fs.readFileSync(fp)), kind);
}
// Read an .xlsx off disk and parse its first worksheet into rows (same cap).
function extractXlsxRows(fp) {
  if (fs.statSync(fp).size > SOURCE_MAX_BYTES * 8) throw new Error('file too large');
  return firstSheet(unzip(fs.readFileSync(fp)));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.STUDIO_PORT || 4317);

const driver = getDriver();

// ── SSE broadcast (graph-changed notifications) ──────────────────────────────
const sseClients = new Set();
function broadcast(event, data = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch { sseClients.delete(res); } }
}

// The /api/source read sandbox = the document-lane allowlist, nothing else (Open #6).
// Mutable so the folder-permission UI can grant/revoke roots live (no restart).
const ROOTS_PATH = path.join(__dirname, '..', 'document-sources.json');
let ROOTS_CFG = { roots: [] };
let SOURCE_ROOTS = [];
// Repo root = the dir that holds examples/ (one level up in the monorepo; the root
// itself in the public repo). Relative file_paths — e.g. the demo graph's
// "examples/demo-files/x.md" — resolve against it, so sources load no matter what
// cwd the Studio was started from. Bundled demo files are always readable.
const REPO_ROOT = [path.join(__dirname, '..'), __dirname]
  .find((b) => { try { return fs.existsSync(path.join(b, 'examples', 'demo-files')); } catch { return false; } }) || path.join(__dirname, '..');
const DEMO_DIR = path.join(REPO_ROOT, 'examples', 'demo-files');
const absSrc = (fp) => { const s = String(fp || ''); return s && !path.isAbsolute(s) ? path.resolve(REPO_ROOT, s) : s; };
function loadRoots() {
  try { ROOTS_CFG = JSON.parse(fs.readFileSync(ROOTS_PATH, 'utf8')); } catch { ROOTS_CFG = { roots: [] }; }
  try { SOURCE_ROOTS = expandRoots(ROOTS_CFG, os.homedir()); } catch { SOURCE_ROOTS = []; }
  try { if (fs.existsSync(DEMO_DIR) && !SOURCE_ROOTS.some((r) => path.resolve(r) === path.resolve(DEMO_DIR))) SOURCE_ROOTS.push(DEMO_DIR); } catch { /* ignore */ }
}
loadRoots();

// Grant/revoke a folder in the allowlist. Guardrails: absolute (after ~), must exist,
// must be a real directory, and must live under the user's home — the app can never be
// pointed at /, /etc, or anywhere outside the user's own files.
function mutateRoots(action, rawPath, tags) {
  const home = os.homedir();
  const abs = path.resolve(rawPath.startsWith('~') ? path.join(home, rawPath.slice(1)) : rawPath);
  const within = (abs + path.sep).startsWith(home + path.sep);
  const stored = rawPath.startsWith('~') ? rawPath : abs;
  if (action === 'add') {
    if (!within) return { error: 'folders must be inside your home directory' };
    let st; try { st = fs.statSync(abs); } catch { return { error: 'folder not found' }; }
    if (!st.isDirectory()) return { error: 'not a directory' };
    const roots = ROOTS_CFG.roots || (ROOTS_CFG.roots = []);
    if (roots.some((r) => path.resolve((typeof r === 'string' ? r : r.path).replace(/^~/, home)) === abs)) return { error: 'already granted' };
    roots.push({ path: stored, tags: Array.isArray(tags) ? tags : [] });
  } else if (action === 'remove') {
    ROOTS_CFG.roots = (ROOTS_CFG.roots || []).filter((r) => path.resolve((typeof r === 'string' ? r : r.path).replace(/^~/, home)) !== abs);
  } else return { error: 'unknown action' };
  fs.writeFileSync(ROOTS_PATH, JSON.stringify(ROOTS_CFG, null, 2) + '\n');
  loadRoots();
  return { ok: true };
}
const SOURCE_MAX_BYTES = 512 * 1024;   // never slurp a giant file into the inspector

// Intelligence layer (M-E) — LLM-OPTIONAL. Talks to a LOCAL Ollama if present; every
// endpoint degrades to { available:false } when none is connected (no cloud calls,
// per the repo's no-external-API rule — Ollama is local).
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
async function ollamaTags(timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.models || []).map((m) => m.name);
  } catch { return null; } finally { clearTimeout(t); }
}
async function ollamaGenerate(model, prompt, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(OLLAMA + '/api/generate', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!r.ok) return null;
    return (await r.json()).response;
  } catch { return null; } finally { clearTimeout(t); }
}
const nodeText = (n) => (n ? [n.name, n.desc].filter(Boolean).join('\n\n') : '');

// ── Cypher ────────────────────────────────────────────────────────────────
// Primary label, preferring the meaningful one over the `Embeddable` marker.
const PRIMARY_LABEL = `head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n))`;

const Q_NODES = `
  MATCH (n)
  WITH n, COUNT { (n)--() } AS degree
  ORDER BY degree DESC
  LIMIT $limit
  RETURN elementId(n) AS id,
         ${PRIMARY_LABEL} AS label,
         labels(n) AS labels,
         coalesce(n.name, n.title, n.summary, n.id, '(unnamed)') AS name,
         left(coalesce(n.description, n.summary, n.full_text, ''), 240) AS desc,
         ('Embeddable' IN labels(n)) AS embeddable,
         (n.valid_until IS NOT NULL) AS superseded,
         toString(n.valid_until) AS valid_until,
         toString(n.created_at) AS created_at,
         n.superseded_by AS superseded_by,
         n.file_path AS file_path,
         degree`;

const Q_LINKS = `
  MATCH (a)-[r]->(b)
  WHERE elementId(a) IN $ids AND elementId(b) IN $ids
  RETURN elementId(a) AS source, elementId(b) AS target, type(r) AS type`;

const Q_HEALTH = `
  MATCH (n)
  RETURN count(n) AS total,
         count(CASE WHEN 'Embeddable' IN labels(n) THEN 1 END) AS indexed,
         count(CASE WHEN n.valid_until IS NOT NULL THEN 1 END) AS superseded`;
const Q_ORPHANS = `MATCH (n) WHERE NOT (n)--() RETURN count(n) AS orphans`;
const Q_BYLABEL = `
  MATCH (n) WITH ${PRIMARY_LABEL} AS label
  RETURN label, count(*) AS c ORDER BY c DESC`;
const Q_NEWEST = `
  MATCH (n:Insight) WHERE n.created_at IS NOT NULL
  RETURN coalesce(n.name, n.title, n.summary, left(n.full_text, 60)) AS name, toString(n.created_at) AS created_at
  ORDER BY n.created_at DESC LIMIT 1`;
const Q_SYNC = `
  OPTIONAL MATCH (s:SyncState)
  RETURN toString(coalesce(s.last_full_sync, s.updated_at)) AS last_sync`;

const Q_SEARCH = `
  MATCH (n)
  WHERE toLower(coalesce(n.name, n.title, n.summary, '')) CONTAINS toLower($q)
     OR toLower(coalesce(n.description, n.full_text, '')) CONTAINS toLower($q)
  WITH n, COUNT { (n)--() } AS degree
  RETURN elementId(n) AS id, ${PRIMARY_LABEL} AS label,
         coalesce(n.name, n.title, n.summary, n.id) AS name,
         (n.valid_until IS NOT NULL) AS superseded
  ORDER BY degree DESC LIMIT 12`;

const Q_NODE = `
  MATCH (n) WHERE elementId(n) = $id
  RETURN elementId(n) AS id, ${PRIMARY_LABEL} AS label, labels(n) AS labels,
         coalesce(n.name, n.title, n.summary, n.id) AS name,
         coalesce(n.description, n.summary, n.full_text, '') AS desc,
         ('Embeddable' IN labels(n)) AS embeddable,
         toString(n.created_at) AS created_at,
         toString(n.valid_from) AS valid_from,
         toString(n.valid_until) AS valid_until,
         n.superseded_by AS superseded_by,
         n.invalidated_reason AS invalidated_reason,
         n.confidence AS confidence, n.citation AS citation,
         n.timeframe AS timeframe, toString(n.target_date) AS target_date,
         toString(n.due_at) AS due_at, toString(n.review_at) AS review_at,
         n.status AS status, n.jurisdiction AS jurisdiction,
         n.source_kind AS source_kind, n.file_path AS file_path, n.url AS url, n.tags AS tags,
         n { .*, embedding: NULL } AS props,
         size([(s2:Source)-[:INFORMS]->(n) | 1]) AS source_count,
         [(s3:Source)-[:INFORMS]->(n) | { id: elementId(s3), name: coalesce(s3.title, s3.name, s3.id),
            source_kind: s3.source_kind, url: s3.url, file_path: s3.file_path }][0..500] AS all_sources,
         [(nt:Note)-[:ABOUT]->(n) | { id: nt.id, text: nt.text, state: nt.state,
            anchor_kind: nt.anchor_kind, locator: nt.locator, created_at: toString(nt.created_at) }][0..200] AS notes,
         [(kf:ProtectedFact)-[:ABOUT]->(n) WHERE kf.valid_until IS NULL | { id: kf.id, value: kf.value, note: kf.note,
            pending_status: kf.pending_status, pending_new: kf.pending_new,
            pending_reason: kf.pending_reason, created_at: toString(kf.created_at) }][0..200] AS protected_facts,
         [(kf:ProtectedFact)-[:ABOUT]->(n) WHERE kf.valid_until IS NOT NULL AND kf.invalidated_reason = 'unpinned'
            | { id: kf.id, value: kf.value, note: kf.note, retired_at: toString(kf.valid_until) }][0..50] AS retired_facts,
         size([(n)--() | 1]) AS degree,
         [(n)-[r2]-() | type(r2)] AS rel_types,
         [(n)-[r]-(m) | { type: type(r), id: elementId(m), rel_id: elementId(r),
            name: coalesce(m.name, m.title, m.summary, m.id),
            label: head([l IN labels(m) WHERE l <> 'Embeddable'] + labels(m)),
            url: m.url, file_path: m.file_path,
            status: m.status, valid_until: toString(m.valid_until),
            dir: CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END }][0..60] AS edges`;

// ── Pulse (status board) ────────────────────────────────────────────────────
const Q_GOALS = `
  MATCH (g:Goal)
  OPTIONAL MATCH (g)-[:ACHIEVED_BY|SUPPORTS]-(p:Project)
  WITH g, collect(DISTINCT p.name) AS projects
  RETURN g.name AS name, g.timeframe AS timeframe, coalesce(g.status,'active') AS status,
         left(coalesce(g.description,''), 200) AS desc, projects[0..5] AS projects
  ORDER BY CASE g.timeframe WHEN '30_days' THEN 0 WHEN 'short_term' THEN 1 WHEN '90_days' THEN 2
                            WHEN '1_year' THEN 3 WHEN 'long_term' THEN 5 ELSE 4 END`;
const Q_PROJECTS = `
  MATCH (p:Project)
  RETURN p.name AS name, coalesce(p.status,'') AS status, coalesce(p.domain,'') AS domain,
         left(coalesce(p.description,''), 140) AS desc
  ORDER BY p.name`;
const Q_BLOCKED = `
  MATCH (a)-[:BLOCKED_BY]->(b)
  RETURN coalesce(a.name,a.title) AS name, coalesce(b.name,b.title) AS blocker,
         head([l IN labels(a) WHERE l <> 'Embeddable'] + labels(a)) AS label LIMIT 12`;
const Q_NEXT = `
  MATCH (i:Idea)
  WHERE i.valid_until IS NULL AND toLower(coalesce(i.status,'')) =~ '.*(open|queued|next|planned|backlog).*'
  RETURN i.name AS name, coalesce(i.status,'open') AS status, left(coalesce(i.description,''),120) AS desc
  LIMIT 12`;
const Q_WHATSNEW = `
  MATCH (n:Insight) WHERE n.created_at IS NOT NULL AND n.valid_until IS NULL
  RETURN coalesce(n.name, n.title, n.summary, left(n.full_text,90)) AS name,
         toString(n.created_at) AS created_at, [t IN n.tags][0..3] AS tags
  ORDER BY n.created_at DESC LIMIT 10`;
const Q_SUPERSEDED = `
  MATCH (n) WHERE n.valid_until IS NOT NULL
    AND NONE(l IN labels(n) WHERE l IN ['ProtectedFact','Note','Review'])
  RETURN coalesce(n.name,n.title,n.summary) AS name,
         head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS label,
         toString(n.valid_until) AS valid_until, n.superseded_by AS superseded_by LIMIT 12`;
const Q_LOWCONF = `
  MATCH (r:Rule) WHERE toLower(coalesce(r.confidence,'')) IN ['low','medium','tentative']
  RETURN r.name AS name, r.confidence AS confidence, coalesce(r.citation,'') AS citation LIMIT 12`;
// Orphans worth surfacing for review — honors lint-graph's ORPHAN_WHITELIST (SyncState is an
// operational singleton; an empty Review is a legitimately standalone artifact), so the dock
// shows the same orphans the linter would flag and stays quiet about the ones it forgives.
const Q_ORPHAN_LIST = `
  MATCH (n) WHERE NOT (n)--() AND NONE(l IN labels(n) WHERE l IN ['SyncState','Review'])
  RETURN coalesce(n.name,n.title,n.summary,n.id) AS name,
         head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS label LIMIT 12`;
// Retired-brand drift: an identity node still NAMED for a renamed entity (the
// generalized lesson from the retired-brand cleanup). Mirrors lint-graph's
// `retired-alias-drift` so the cockpit shows what the linter would fail on.
const Q_ALIAS_DRIFT = `
  MATCH (n) WHERE any(l IN labels(n) WHERE l IN $aliasLabels)
    AND any(k IN $aliasNameFields WHERE n[k] IS NOT NULL AND toString(n[k]) =~ $brandRe)
  RETURN coalesce(n.name,n.title,n.summary,n.id) AS name,
         head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS label,
         n.former_name AS former_name LIMIT 12`;
// Protected key-facts awaiting approval (#23): a rewrite dropped/altered a pinned fact and
// queued the change. The dock surfaces these for approve/reject, like alias-drift.
const Q_PROTECTED_FACT_REVIEW = `
  MATCH (k:ProtectedFact)-[:ABOUT]->(n) WHERE k.valid_until IS NULL AND k.pending_status IS NOT NULL
  RETURN k.id AS id, k.value AS value, k.kind AS kind, k.pending_status AS pending_status,
         k.pending_new AS pending_new, k.pending_reason AS pending_reason,
         coalesce(n.name, n.title, n.summary, n.id) AS target_name, elementId(n) AS target_id
  ORDER BY k.pending_at DESC LIMIT 24`;

// ── Intent queries (the command bar) — uniform shape {id, name, label, sub} ───
const PLABEL = `head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n))`;
const QI_BLOCKED = `
  MATCH (n)-[:BLOCKED_BY]->(b)
  RETURN elementId(n) AS id, coalesce(n.name,n.title) AS name, ${PLABEL} AS label,
         'blocked by ' + coalesce(b.name,b.title) AS sub LIMIT 20`;
const QI_NEW = `
  MATCH (n) WHERE n.created_at IS NOT NULL AND n.valid_until IS NULL
  RETURN elementId(n) AS id, coalesce(n.name,n.title,n.summary,left(n.full_text,80)) AS name,
         ${PLABEL} AS label, 'added ' + substring(toString(n.created_at),0,10) AS sub
  ORDER BY n.created_at DESC LIMIT 20`;
const QI_REVIEW = `
  MATCH (n) WHERE n.valid_until IS NOT NULL
  RETURN elementId(n) AS id, coalesce(n.name,n.title,n.summary) AS name, ${PLABEL} AS label,
         'superseded ' + substring(toString(n.valid_until),0,10) AS sub LIMIT 12
  UNION
  MATCH (n:Rule) WHERE toLower(coalesce(n.confidence,'')) IN ['low','tentative']
  RETURN elementId(n) AS id, n.name AS name, 'Rule' AS label, 'confidence: ' + n.confidence AS sub LIMIT 8`;
// "Due to revisit" = important (high-degree) nodes that have aged — created a while
// ago and never superseded. created_at is the only staleness proxy we have (no
// last-accessed tracking yet), so order by importance × age. Threshold kept low
// because the graph is young; it tightens naturally as history accrues.
// The agenda: nodes carrying a real intention date (#25 P2) — due_at / review_at, or a
// Goal's target_date — whose SOONEST such date is overdue or within ~14 days, soonest-first.
// Replaces the old staleness heuristic so "what's due / to revisit" reflects the scheduler.
const QI_DUE = `
  MATCH (n) WHERE n.valid_until IS NULL
    AND (n.due_at IS NOT NULL OR n.review_at IS NOT NULL OR (n:Goal AND n.target_date IS NOT NULL))
  WITH n, [d IN [n.due_at, n.review_at, CASE WHEN n:Goal THEN n.target_date ELSE null END]
           WHERE d IS NOT NULL | date(d)] AS ds
  WITH n, reduce(s = null, d IN ds | CASE WHEN s IS NULL OR d < s THEN d ELSE s END) AS soonest
  WHERE soonest <= date() + duration({days: 14})
  RETURN elementId(n) AS id, coalesce(n.name,n.title,n.summary) AS name, ${PLABEL} AS label,
         (CASE WHEN soonest < date() THEN 'overdue · ' ELSE 'due · ' END) + toString(soonest) AS sub
  ORDER BY soonest ASC LIMIT 20`;
const QI_NEXT = `
  MATCH (n:Idea)
  WHERE n.valid_until IS NULL AND toLower(coalesce(n.status,'')) =~ '.*(open|queued|next|planned|backlog).*'
  RETURN elementId(n) AS id, n.name AS name, 'Idea' AS label,
         coalesce(n.status,'open') AS sub LIMIT 20`;
const QI_GOALS = `
  MATCH (n:Goal)
  RETURN elementId(n) AS id, n.name AS name, 'Goal' AS label,
         coalesce(n.timeframe,'') + ' · ' + coalesce(n.status,'active') AS sub
  ORDER BY CASE n.timeframe WHEN '30_days' THEN 0 WHEN 'short_term' THEN 1 WHEN '90_days' THEN 2
                            WHEN '1_year' THEN 3 WHEN 'long_term' THEN 5 ELSE 4 END LIMIT 20`;
const INTENT_Q = { blocked: QI_BLOCKED, new: QI_NEW, review: QI_REVIEW, due: QI_DUE, next: QI_NEXT, goals: QI_GOALS };

// Resolve a superseded_by reference (a node id, name, or elementId) → the live node.
const Q_RESOLVE = `
  MATCH (m) WHERE m.id = $sb OR m.name = $sb OR m.title = $sb OR elementId(m) = $sb
  RETURN elementId(m) AS id, coalesce(m.name, m.title, m.summary, m.id) AS name LIMIT 1`;

// ── helpers ─────────────────────────────────────────────────────────────────
const rows = (recs) => recs.map((r) => toPlain(r.toObject()));

async function api(pathname, params) {
  if (pathname === '/api/graph') {
    const limit = Math.min(Math.max(Number(params.limit) || 250, 1), 1500);
    const nodes = rows(await run(driver, Q_NODES, { limit: neo4j.int(limit) }));
    const ids = nodes.map((n) => n.id);
    const links = rows(await run(driver, Q_LINKS, { ids }));
    return { nodes, links, truncated: nodes.length >= limit };
  }
  if (pathname === '/api/health') {
    const [h] = rows(await run(driver, Q_HEALTH));
    const [{ orphans }] = rows(await run(driver, Q_ORPHANS));
    const byLabel = rows(await run(driver, Q_BYLABEL));
    const newest = rows(await run(driver, Q_NEWEST))[0] || null;
    const [{ last_sync }] = rows(await run(driver, Q_SYNC));
    return { ...h, orphans, byLabel, newest, last_sync };
  }
  if (pathname === '/api/pulse') {
    const [goals, projects, blocked, next, whatsNew, superseded, lowConf, orphans, aliasDrift, protectedFactsReview] = await Promise.all([
      run(driver, Q_GOALS), run(driver, Q_PROJECTS), run(driver, Q_BLOCKED), run(driver, Q_NEXT),
      run(driver, Q_WHATSNEW), run(driver, Q_SUPERSEDED), run(driver, Q_LOWCONF), run(driver, Q_ORPHAN_LIST),
      run(driver, Q_ALIAS_DRIFT, { aliasLabels: ALIAS_LABELS, aliasNameFields: ALIAS_NAME_FIELDS, brandRe: brandRegexCypher() }),
      run(driver, Q_PROTECTED_FACT_REVIEW),
    ]);
    return {
      goals: rows(goals), projects: rows(projects), blocked: rows(blocked), next: rows(next),
      whatsNew: rows(whatsNew),
      review: { superseded: rows(superseded), lowConfidence: rows(lowConf), orphans: rows(orphans), aliasDrift: rows(aliasDrift), protectedFacts: rows(protectedFactsReview) },
    };
  }
  if (pathname === '/api/protected-fact/suggest') {
    return await suggestProtectedFacts(params.id);
  }
  if (pathname === '/api/reltypes') {
    return { types: REL_TYPES };   // closed vocab for the inline associate control (#29)
  }
  if (pathname === '/api/search') {
    const q = String(params.q || '').trim();
    if (!q) return { results: [] };
    return { results: rows(await run(driver, Q_SEARCH, { q })) };
  }
  if (pathname === '/api/node') {
    const node = rows(await run(driver, Q_NODE, { id: String(params.id || '') }))[0] || null;
    // Resolve superseded_by → the resolving node (id + name) so the timeline can link
    // to it. Only when present (rare), so the unlabeled lookup never runs per-view.
    if (node && node.superseded_by) {
      const sup = rows(await run(driver, Q_RESOLVE, { sb: String(node.superseded_by) }))[0];
      if (sup) { node.superseded_by_id = sup.id; node.superseded_by_name = sup.name; }
    }
    return { node };
  }
  if (pathname === '/api/ai/ping') {
    const models = await ollamaTags();
    return { available: !!(models && models.length), models: models || [], host: OLLAMA };
  }
  if (pathname === '/api/ai/summary' || pathname === '/api/ai/ask') {
    const models = await ollamaTags();
    if (!models || !models.length) return { available: false };
    const node = rows(await run(driver, Q_NODE, { id: String(params.id || '') }))[0];
    if (!node) return { available: true, error: 'node not found' };
    const model = params.model && models.includes(params.model) ? params.model : models[0];
    const ctx = nodeText(node);
    const prompt = pathname === '/api/ai/ask'
      ? `Using ONLY the context below, answer the question concisely. If the context doesn't cover it, say so.\n\nContext:\n${ctx}\n\nQuestion: ${String(params.q || '').slice(0, 400)}\n\nAnswer:`
      : `Summarize the following knowledge-graph node in 2-3 sentences, grounded only in this text. Be concrete.\n\n${ctx}\n\nSummary:`;
    const out = await ollamaGenerate(model, prompt);
    return out == null ? { available: true, error: 'generation failed' } : { available: true, model, text: out.trim() };
  }
  if (pathname === '/api/intent') {
    const q = INTENT_Q[String(params.kind || '')];
    if (!q) return { results: [] };
    return { kind: params.kind, results: rows(await run(driver, q)) };
  }
  if (pathname === '/api/source') {
    // The "See" layer: read a node's primary file, sandboxed to the allowlist. Returns
    // { source: null } when there is no file, or a typed payload otherwise.
    const node = rows(await run(driver, Q_NODE, { id: String(params.id || '') }))[0];
    if (!node) return { source: null };
    const primary = pickPrimarySource(node, node.edges || [], (p) => isWithinRoots(absSrc(p), SOURCE_ROOTS));
    if (!primary) return { source: null };
    const fp = absSrc(primary.filePath);
    const kind = detectKind(fp);
    const base = { kind, title: primary.title, sourcePath: fp };
    if (!isWithinRoots(fp, SOURCE_ROOTS)) return { source: { ...base, blocked: true } };
    if (!fs.existsSync(fp)) return { source: { ...base, missing: true } };
    if (!TEXT_KINDS.has(kind)) return { source: { ...base, unsupported: true } };   // pdf/docx/pptx viewers: later module
    try {
      if (fs.statSync(fp).size > SOURCE_MAX_BYTES) return { source: { ...base, tooLarge: true } };
      const content = fs.readFileSync(fp, 'utf8');
      const keywords = [node.name, ...(Array.isArray(node.tags) ? node.tags : [])];
      const ex = excerptAround(content, keywords);
      return { source: { ...base, ...ex } };
    } catch (err) {
      return { source: { ...base, error: String(err.message || err) } };
    }
  }
  if (pathname === '/api/file') {
    // The "load the whole file" path behind a source/provenance link or a codebase-map
    // node. Same read sandbox as /api/source, just the full text instead of an excerpt.
    const fp = absSrc(params.path);
    const kind = detectKind(fp);
    const base = { kind, path: fp, title: fp.split('/').pop() || fp };
    if (!fp || !isWithinRoots(fp, SOURCE_ROOTS)) return { file: { ...base, blocked: true } };
    if (!fs.existsSync(fp)) return { file: { ...base, missing: true } };
    if (kind === 'pdf') return { file: { ...base, embed: 'pdf', notes: await fileNotes(fp) } };   // rendered natively via /api/raw
    if (kind === 'docx' || kind === 'pptx') {
      try {
        const text = extractOfficeText(fp, kind);
        return { file: { ...base, text, lines: text.split('\n').length, extracted: kind, notes: await fileNotes(fp) } };
      } catch (err) { return { file: { ...base, error: 'could not extract ' + kind + ': ' + String(err.message || err) } }; }
    }
    if (kind === 'xlsx') {
      try {
        const { name, rows } = extractXlsxRows(fp);
        // rows -> CSV text too, so the raw view + per-line notes work like a CSV.
        const text = rows.map((r) => r.join('\t')).join('\n');
        return { file: { ...base, kind: 'xlsx', rows, sheetName: name, text, lines: rows.length, extracted: 'xlsx', notes: await fileNotes(fp) } };
      } catch (err) { return { file: { ...base, error: 'could not read xlsx: ' + String(err.message || err) } }; }
    }
    if (!TEXT_KINDS.has(kind)) return { file: { ...base, unsupported: true } };
    try {
      if (fs.statSync(fp).size > SOURCE_MAX_BYTES) return { file: { ...base, tooLarge: true } };
      const text = fs.readFileSync(fp, 'utf8');
      return { file: { ...base, text, lines: text.split('\n').length, notes: await fileNotes(fp) } };
    } catch (err) {
      return { file: { ...base, error: String(err.message || err) } };
    }
  }
  if (pathname === '/api/roots') {
    // The granted folders (allowlist) with liveness, for the permission panel.
    const home = os.homedir();
    const roots = (ROOTS_CFG.roots || []).map((r) => {
      const raw = typeof r === 'string' ? r : r.path;
      const abs = path.resolve(raw.replace(/^~/, home));
      let exists = false; try { exists = fs.statSync(abs).isDirectory(); } catch { /* gone */ }
      return { path: raw, abs, name: abs.split('/').pop() || abs, tags: (typeof r === 'object' && r.tags) || [], exists };
    });
    return { roots, home };
  }
  if (pathname === '/api/file/history') return fileHistory(absSrc(params.path));
  if (pathname === '/api/file/version') return fileVersion(absSrc(params.path), String(params.rev || ''));
  if (pathname === '/api/file/stat') {
    // Cheap liveness probe for the editor: has the file changed on disk under you?
    const fp = absSrc(params.path);
    if (!fp || !isWithinRoots(fp, SOURCE_ROOTS)) return { error: 'forbidden' };
    try { const text = fs.readFileSync(fp, 'utf8'); return { hash: hashText(text), mtime: fs.statSync(fp).mtimeMs }; }
    catch { return { missing: true }; }
  }
  if (pathname === '/api/repos') {
    // The mappable codebases = the allowlisted roots that actually exist on disk.
    const repos = SOURCE_ROOTS.filter((r) => { try { return fs.statSync(r).isDirectory(); } catch { return false; } })
      .map((r) => ({ path: r, name: r.split('/').pop() || r }));
    return { repos };
  }
  if (pathname === '/api/status') return await status();
  if (pathname === '/api/calendar') return await calendar(params);
  if (pathname === '/api/roadmap') return await roadmap();
  if (pathname === '/api/review/resolve') return await resolveReview(params);
  if (pathname === '/api/review/changes') return await reviewChanges(params);
  if (pathname === '/api/review/refs') return await reviewRefs(params);
  if (pathname === '/api/reviews') return await listReviews();
  if (pathname === '/api/review') return await getReview(params);
  if (pathname === '/api/repo') {
    // Live, read-only codebase map: walk a repo dir (sandboxed) → module graph. Never
    // touches Neo4j — codebases are a separate namespace you load into the canvas and
    // exit, so the personal graph stays clean.
    const dir = String(params.path || '');
    if (!dir || !isWithinRoots(dir, SOURCE_ROOTS)) return { repo: { blocked: true, path: dir } };
    let stat;
    try { stat = fs.statSync(dir); } catch { return { repo: { missing: true, path: dir } }; }
    if (!stat.isDirectory()) return { repo: { notDir: true, path: dir } };
    const { files, truncated } = walkRepo(dir);
    const { nodes, links } = buildModuleGraph(files);
    const byRel = Object.fromEntries(files.map((f) => [f.rel, f.path]));
    nodes.forEach((n) => { n.path = byRel[n.rel]; });   // absolute path so clicking loads the file
    return { repo: { name: dir.split('/').pop() || dir, path: dir, nodes, links, fileCount: nodes.length, edgeCount: links.length, truncated } };
  }
  return null;
}

// ── Notes (deferred-instruction inbox; ROADMAP #15) ─────────────────────────
// Any node can carry freeform Notes; a later sync pass evaluates them (raw →
// cued → addressed/skipped). Local-first write endpoint, mirrors /api/roots.
const NOTE_STATES = new Set(['raw', 'cued', 'addressed', 'skipped']);
async function addNote({ target, filePath, text, anchor_kind, locator, snippet, author, reviewId } = {}) {
  const t = String(text || '').trim();
  if (!t || (!target && !filePath && !reviewId)) return { error: 'text and (target, filePath, or reviewId) required' };
  // author: 'you' (default) or 'agent:<model>' — the seam for a later multi-team tier (#34).
  const a = String(author || 'you').trim() || 'you';
  const RET = `RETURN n.id AS id, n.text AS text, n.state AS state, n.anchor_kind AS anchor_kind,
               n.locator AS locator, n.snippet AS snippet, n.author AS author, toString(n.created_at) AS created_at`;
  const params = { target: target ? String(target) : null, filePath: filePath ? String(filePath) : null,
    text: t, anchor_kind: anchor_kind || null, locator: locator ?? null, snippet: snippet || null,
    author: a, reviewId: reviewId ? String(reviewId) : null };

  // A code-review line comment anchors PART_OF the Review by (file_path, line) — it does
  // NOT require a Source node (most code files aren't ingested Sources). It still links
  // ABOUT a Source if one happens to exist, so document-lane notes stay unified.
  if (reviewId) {
    const recs = await run(driver,
      `MATCH (rv:Review {id: $reviewId})
       CREATE (n:Note {id: randomUUID()})
       SET n.text = $text, n.state = 'raw', n.anchor_kind = coalesce($anchor_kind, 'line'),
           n.locator = $locator, n.snippet = $snippet, n.author = $author,
           n.file_path = $filePath, n.created_at = datetime()
       MERGE (n)-[:PART_OF]->(rv)
       WITH n
       OPTIONAL MATCH (src:Source {file_path: $filePath})
       FOREACH (_ IN CASE WHEN src IS NOT NULL THEN [1] ELSE [] END | MERGE (n)-[:ABOUT]->(src))
       ${RET}`, params);
    if (!recs.length) return { error: 'review not found' };
    return { note: toPlain(recs[0].toObject()) };
  }

  // Otherwise: a node note (ABOUT a node by id) or a document note (ABOUT a file's Source).
  const match = target ? 'MATCH (tg) WHERE elementId(tg) = $target' : 'MATCH (tg:Source) WHERE tg.file_path = $filePath';
  const recs = await run(driver,
    `${match}
     CREATE (n:Note {id: randomUUID()})
     SET n.text = $text, n.state = 'raw', n.anchor_kind = coalesce($anchor_kind, 'node'),
         n.locator = $locator, n.snippet = $snippet, n.author = $author,
         n.file_path = $filePath, n.created_at = datetime()
     MERGE (n)-[:ABOUT]->(tg)
     ${RET}`, params);
  if (!recs.length) return { error: target ? 'target not found' : 'no source node for that file' };
  return { note: toPlain(recs[0].toObject()) };
}
// Anchored notes for a file (notes ABOUT the Source whose file_path matches).
async function fileNotes(fp) {
  const recs = await run(driver,
    `MATCH (s:Source {file_path: $fp})<-[:ABOUT]-(n:Note)
     RETURN n.id AS id, n.text AS text, n.state AS state, n.anchor_kind AS anchor_kind,
            n.locator AS locator, n.snippet AS snippet, coalesce(n.author, 'you') AS author, toString(n.created_at) AS created_at`,
    { fp });
  return recs.map((r) => toPlain(r.toObject()));
}
async function setNoteState(id, state) {
  if (!id || !NOTE_STATES.has(state)) return { error: 'bad id or state' };
  const recs = await run(driver,
    `MATCH (n:Note {id: $id}) SET n.state = $state, n.state_changed_at = datetime()
     RETURN n.id AS id, n.state AS state`, { id: String(id), state });
  if (!recs.length) return { error: 'note not found' };
  return toPlain(recs[0].toObject());
}

// ── Link intake (ROADMAP #19) ───────────────────────────────────────────────
// Save a web link as a Resource (keyed by url → idempotent), classify video vs
// link, and fuzzy-associate it to a Project/Goal (reusing keysLookAlike).
function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    const host = u.hostname.replace(/^www\./, '');
    return seg ? `${host} — ${decodeURIComponent(seg).replace(/[-_]+/g, ' ').slice(0, 60)}` : host;
  } catch { return url; }
}
async function addLink({ url, title, attachTo } = {}) {
  const u = String(url || '').trim();
  if (!isWebUrl(u)) return { error: 'a valid http(s) url is required' };
  const t = (title && String(title).trim()) || titleFromUrl(u);
  const kind = isVideoUrl(u) ? 'video' : 'link';
  const recs = await run(driver,
    `MERGE (r:Resource {url: $url})
     SET r.title = coalesce(r.title, $title), r.type = $kind,
         r.created_at = coalesce(r.created_at, datetime()),
         r.tags = CASE WHEN r.tags IS NULL THEN ['link'] ELSE r.tags END
     RETURN elementId(r) AS id, r.title AS title, r.url AS url, r.type AS type`,
    { url: u, title: t, kind });
  const node = toPlain(recs[0].toObject());

  let attached = null;
  let suggestions = [];
  const candRecs = await run(driver, `MATCH (n) WHERE n:Project OR n:Goal RETURN elementId(n) AS id, n.name AS name, head(labels(n)) AS label`);
  const cands = candRecs.map((r) => toPlain(r.toObject()));
  if (attachTo && String(attachTo).trim()) {
    const q = String(attachTo).trim();
    const hit = cands.find((c) => keysLookAlike(c.name, q)) || cands.find((c) => (c.name || '').toLowerCase().includes(q.toLowerCase()));
    if (hit) {
      await run(driver, `MATCH (r:Resource {url:$url}) MATCH (tg) WHERE elementId(tg)=$tid MERGE (r)-[:INFORMS]->(tg)`, { url: u, tid: hit.id });
      attached = hit;
    }
  } else {
    // fuzzy suggest by shared title tokens (so the user can attach in one click)
    const tokens = t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    suggestions = cands
      .map((c) => ({ ...c, score: tokens.filter((tok) => (c.name || '').toLowerCase().includes(tok)).length }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }
  return { node, attached, suggestions, kind };
}
async function attachLink(linkId, targetId) {
  if (!linkId || !targetId) return { error: 'linkId and targetId required' };
  const recs = await run(driver,
    `MATCH (r) WHERE elementId(r)=$lid MATCH (tg) WHERE elementId(tg)=$tid MERGE (r)-[:INFORMS]->(tg) RETURN elementId(tg) AS id`,
    { lid: String(linkId), tid: String(targetId) });
  return recs.length ? { ok: true } : { error: 'not found' };
}

// ── Inline associate (ROADMAP #29) ──────────────────────────────────────────
// Wire a typed edge (source)-[:TYPE]->(target) between two EXISTING nodes from the
// inspector's fuzzy picker. The type is validated against the closed REL_TYPES set
// (CLAUDE.md "don't invent new relationship types") — so even though Neo4j can't
// parameterize a rel type and it must be interpolated, only an exact allowlisted
// identifier ever reaches the query (no injection surface).
async function relate({ sourceId, targetId, type } = {}) {
  const s = String(sourceId || ''), t = String(targetId || '');
  if (!s || !t) return { error: 'sourceId and targetId required' };
  if (s === t) return { error: 'a node cannot relate to itself' };
  if (!isValidRelType(type)) return { error: `invalid relationship type (allowed: ${REL_TYPES.join(', ')})` };
  // Look up both endpoints' primary labels first, so the SHAPE is validated before any
  // write — a backwards/mistyped edge is rejected, not silently created.
  const meta = await run(driver,
    `MATCH (a) WHERE elementId(a)=$s MATCH (b) WHERE elementId(b)=$t
     RETURN [l IN labels(a) WHERE l <> 'Embeddable'][0] AS la, [l IN labels(b) WHERE l <> 'Embeddable'][0] AS lb`,
    { s, t });
  if (!meta.length) return { error: 'one or both nodes not found' };
  const { la, lb } = toPlain(meta[0].toObject());
  if (!isValidRelShape(la, type, lb)) {
    const ok = (REL_SHAPES[type] || []).join(', ') || '(none defined)';
    return { error: `(${la})-[:${type}]->(${lb}) is not a valid shape — try reversing the direction. Allowed for ${type}: ${ok}` };
  }
  const recs = await run(driver,
    `MATCH (a) WHERE elementId(a)=$s MATCH (b) WHERE elementId(b)=$t
     MERGE (a)-[r:${type}]->(b)
     RETURN elementId(b) AS id, elementId(r) AS rel_id, coalesce(b.name, b.title, b.summary) AS name, head(labels(b)) AS label`,
    { s, t });
  return recs.length ? { ok: true, edge: { type, ...toPlain(recs[0].toObject()) } } : { error: 'one or both nodes not found' };
}

// Remove an association edge (#29 remove-edge). Hard-delete is correct for structural
// edges a user wired in the UI — unlike bi-temporal *facts* (which invalidate, never
// delete), a wrong association should just be gone. PROVENANCE edges are exempt:
// INFORMS/DERIVED_FROM are earned at ingest, not hand-pruned here — superseding the
// Source is the right path, so this endpoint refuses them. Targets one specific edge by
// its relationship elementId (preferred — survives parallel edges), else the exact triple.
async function unrelate({ edgeId, sourceId, targetId, type } = {}) {
  if (edgeId) {
    const meta = await run(driver, `MATCH ()-[r]->() WHERE elementId(r) = $e RETURN type(r) AS t`, { e: String(edgeId) });
    if (!meta.length) return { error: 'edge not found' };
    const t = toPlain(meta[0].toObject()).t;
    if (isProvenanceRelType(t)) return { error: `${t} is a provenance edge — supersede the source instead of removing it here` };
    await run(driver, `MATCH ()-[r]->() WHERE elementId(r) = $e DELETE r`, { e: String(edgeId) });
    return { ok: true, type: t };
  }
  const s = String(sourceId || ''), tg = String(targetId || '');
  if (!s || !tg || !type) return { error: 'edgeId, or (sourceId, targetId, type), required' };
  if (isProvenanceRelType(type)) return { error: `${type} is a provenance edge — supersede the source instead` };
  if (!isValidRelType(type)) return { error: 'invalid relationship type' };   // gate before interpolation
  await run(driver, `MATCH (a)-[r:${type}]->(b) WHERE elementId(a) = $s AND elementId(b) = $tg DELETE r`, { s, tg });
  return { ok: true, type };
}

// Set (or clear) a Goal's target_date (#25 P1). A NARROW, whitelisted scalar setter —
// only `:Goal` nodes, only the one date property, ISO-validated — deliberately NOT a
// generic property writer (trust boundary). Stored as a Neo4j date so the calendar can
// range over it; toString yields YYYY-MM-DD.
async function setGoalTargetDate({ id, date } = {}) {
  const gid = String(id || '');
  if (!gid) return { error: 'id required' };
  const d = (date == null || date === '') ? null : String(date);
  if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: 'date must be YYYY-MM-DD (or empty to clear)' };
  const recs = await run(driver,
    `MATCH (g:Goal) WHERE elementId(g) = $id
     SET g.target_date = CASE WHEN $d IS NULL THEN null ELSE date($d) END
     RETURN toString(g.target_date) AS target_date`,
    { id: gid, d });
  return recs.length ? { ok: true, target_date: toPlain(recs[0].toObject()).target_date } : { error: 'goal not found' };
}

// Set (or clear) an intention-time date on ANY node (#25 P2 scheduler). Generic but
// NARROW: `kind` must be in the closed SCHEDULE_KINDS set (due_at/review_at) so the only
// property name reaching the query is an allowlisted identifier (never user text); `when`
// is ISO-validated. The writer half of the intention clock the calendar + agenda read.
async function setSchedule({ id, kind, when } = {}) {
  const nid = String(id || '');
  if (!nid) return { error: 'id required' };
  if (!isScheduleKind(kind)) return { error: 'kind must be due_at or review_at' };
  const d = (when == null || when === '') ? null : String(when);
  if (d !== null && !isIsoDate(d)) return { error: 'when must be YYYY-MM-DD (or empty to clear)' };
  const recs = await run(driver,
    `MATCH (n) WHERE elementId(n) = $id
     SET n.\`${kind}\` = CASE WHEN $d IS NULL THEN null ELSE date($d) END
     RETURN toString(n.\`${kind}\`) AS value`,
    { id: nid, d });
  return recs.length ? { ok: true, kind, value: toPlain(recs[0].toObject()).value } : { error: 'node not found' };
}

// ── Protected key-facts (#23) ────────────────────────────────────────────────
// First-class ProtectedFact nodes ABOUT a target: a verified number/$amount/date/citation that a
// rewrite must HONOR. (1) suggest deterministic candidates to pin; (2) pin/unpin (unpin =
// invalidate-don't-delete); (3) check a proposed rewrite against the pinned facts and
// optionally queue the casualties for approval; (4) resolve approve/reject — approve applies
// bi-temporally (supersede the old fact, keep history). Detection/diff live in the pure lib.

// Suggest pinnable candidates from a node's stored text, minus what's already pinned.
async function suggestProtectedFacts(id) {
  const nid = String(id || '');
  if (!nid) return { error: 'id required' };
  const recs = await run(driver,
    `MATCH (n) WHERE elementId(n) = $id
     RETURN coalesce(n.full_text, n.description, n.summary, n.text, '') AS text,
            [(k:ProtectedFact)-[:ABOUT]->(n) WHERE k.valid_until IS NULL | k.value_norm] AS pinned`,
    { id: nid });
  if (!recs.length) return { error: 'node not found' };
  const { text, pinned } = toPlain(recs[0].toObject());
  const have = new Set((pinned || []).filter(Boolean));
  const seen = new Set();
  const candidates = [];
  for (const c of detectCandidates(text)) {
    const k = normalizeValue(c.value);
    if (have.has(k) || seen.has(k)) continue;
    seen.add(k); candidates.push(c);
  }
  return { candidates };
}

// Pin a value as a protected fact on a target node. Idempotent: MERGE keyed by (target,
// normalized value), so re-pinning the same fact (even a previously-unpinned one) revives it.
async function pinProtectedFact({ target, value, kind, note, sourceId } = {}) {
  const t = String(target || '');
  const val = String(value == null ? '' : value).trim();
  if (!t || !val) return { error: 'target and value required' };
  const k = isProtectedFactKind(kind) ? kind : 'other';
  const vnorm = normalizeValue(val);
  const recs = await run(driver,
    `MATCH (t) WHERE elementId(t) = $t
     MERGE (kf:ProtectedFact { about_key: $t, value_norm: $vnorm })
       ON CREATE SET kf.id = randomUUID(), kf.created_at = datetime()
     SET kf.value = $val, kf.kind = $k, kf.note = $note, kf.valid_until = null, kf.invalidated_reason = null
     MERGE (kf)-[:ABOUT]->(t)
     RETURN kf.id AS id, kf.value AS value, kf.kind AS kind, kf.note AS note,
            kf.pending_status AS pending_status, toString(kf.created_at) AS created_at`,
    { t, vnorm, val, k, note: note ? String(note) : null });
  if (!recs.length) return { error: 'target not found' };
  const kf = toPlain(recs[0].toObject());
  if (sourceId) {
    await run(driver,
      `MATCH (kf:ProtectedFact {id:$id}) MATCH (s:Source) WHERE elementId(s)=$sid
       MERGE (kf)-[:DERIVED_FROM]->(s)`, { id: kf.id, sid: String(sourceId) }).catch(() => {});
  }
  return { ok: true, fact: kf };
}

const PFACT_PEND_CLEAR = 'kf.pending_status=null, kf.pending_new=null, kf.pending_reason=null, kf.pending_actor=null, kf.pending_at=null';

// Unpin = retire bi-temporally (invalidate-don't-delete), so history survives.
async function unpinProtectedFact({ id } = {}) {
  const kid = String(id || '');
  if (!kid) return { error: 'id required' };
  const recs = await run(driver,
    `MATCH (kf:ProtectedFact {id:$id})
     SET kf.valid_until = datetime(), kf.invalidated_reason = 'unpinned', ${PFACT_PEND_CLEAR}
     RETURN kf.id AS id`, { id: kid });
  return recs.length ? { ok: true, id: kid } : { error: 'protected fact not found' };
}

// Restore an unpinned fact — clears the bi-temporal retirement so it guards again. Only
// applies to facts retired via unpin (NOT ones superseded by an approved rewrite, which were
// genuinely replaced — restoring those would resurrect a stale value alongside the new one).
async function restoreProtectedFact({ id } = {}) {
  const kid = String(id || '');
  if (!kid) return { error: 'id required' };
  const recs = await run(driver,
    `MATCH (kf:ProtectedFact {id:$id}) WHERE kf.valid_until IS NOT NULL AND kf.invalidated_reason = 'unpinned'
     SET kf.valid_until = null, kf.invalidated_reason = null, kf.superseded_by = null
     RETURN kf.id AS id, kf.value AS value`, { id: kid });
  return recs.length ? { ok: true, ...toPlain(recs[0].toObject()) } : { error: 'no restorable (unpinned) fact with that id' };
}

// Edit a pinned fact's human note (the "what is this / why it matters" label) — the only
// user-facing field besides the value. `kind` is auto-derived on pin and stays internal (it
// powers the guard's same-kind replacement matching); it is not edited here. '' clears the note.
async function updateProtectedFact({ id, note } = {}) {
  const kid = String(id || '');
  if (!kid) return { error: 'id required' };
  if (note === undefined) return { error: 'note required (pass "" to clear)' };
  const n = String(note).trim();
  const recs = await run(driver,
    `MATCH (kf:ProtectedFact {id:$id}) WHERE kf.valid_until IS NULL
     SET kf.note = CASE WHEN $n = '' THEN null ELSE $n END
     RETURN kf.id AS id, kf.note AS note`,
    { id: kid, n });
  return recs.length ? { ok: true, ...toPlain(recs[0].toObject()) } : { error: 'protected fact not found' };
}

// The rewrite guard: diff a proposed new text against the target's live ProtectedFacts. With
// `record:true`, queue each casualty for approval (pending_*) — the graph-sync/LLM path calls
// this before overwriting. Without it, a pure read-only preview (the inspector live-checks).
async function checkProtectedFacts({ target, text, record, actor, reason } = {}) {
  const t = String(target || '');
  if (!t) return { error: 'target required' };
  const facts = rows(await run(driver,
    `MATCH (k:ProtectedFact)-[:ABOUT]->(n) WHERE elementId(n)=$t AND k.valid_until IS NULL
     RETURN k.id AS id, k.value AS value, k.value_norm AS value_norm, k.kind AS kind`, { t }));
  const result = checkRewrite(facts, String(text || ''));
  if (record && result.violations.length) {
    for (const v of result.violations) {
      await run(driver,
        `MATCH (kf:ProtectedFact {id:$id})
         SET kf.pending_status=$status, kf.pending_new=$new, kf.pending_reason=$reason,
             kf.pending_actor=$actor, kf.pending_at=datetime()`,
        { id: v.id, status: v.status, new: v.suggestedNew, reason: reason ? String(reason) : 'rewrite', actor: actor ? String(actor) : 'unknown' });
    }
  }
  return { ok: result.ok, violations: result.violations, recorded: !!(record && result.violations.length) };
}

// Resolve a queued change. reject → keep the fact, clear the queue entry. approve → apply
// bi-temporally: an `altered` fact is superseded by a NEW ProtectedFact carrying the new value
// (citation links copied); a `dropped` fact is retired. History is always kept.
async function resolveProtectedFact({ id, decision } = {}) {
  const kid = String(id || '');
  if (!kid) return { error: 'id required' };
  if (decision !== 'approve' && decision !== 'reject') return { error: "decision must be 'approve' or 'reject'" };
  const recs = await run(driver,
    `MATCH (kf:ProtectedFact {id:$id}) WHERE kf.valid_until IS NULL
     OPTIONAL MATCH (kf)-[:ABOUT]->(t)
     RETURN kf.value AS value, kf.kind AS kind, kf.note AS note, kf.pending_status AS status,
            kf.pending_new AS pending_new, elementId(t) AS target`, { id: kid });
  if (!recs.length) return { error: 'protected fact not found' };
  const kf = toPlain(recs[0].toObject());
  if (!kf.status) return { error: 'no pending change to resolve' };
  if (decision === 'reject') {
    await run(driver, `MATCH (kf:ProtectedFact {id:$id}) SET ${PFACT_PEND_CLEAR}`, { id: kid });
    return { ok: true, decision, outcome: 'kept' };
  }
  if (kf.status === 'altered' && kf.pending_new && kf.target) {
    const nv = String(kf.pending_new), vnorm = normalizeValue(nv);
    const made = await run(driver,
      `MATCH (t) WHERE elementId(t)=$t
       MERGE (nf:ProtectedFact { about_key:$t, value_norm:$vnorm })
         ON CREATE SET nf.id = randomUUID(), nf.created_at = datetime()
       SET nf.value=$nv, nf.kind=$kind, nf.note=$note, nf.valid_until=null, nf.invalidated_reason=null,
           nf.pending_status=null, nf.pending_new=null
       MERGE (nf)-[:ABOUT]->(t)
       RETURN nf.id AS id`, { t: kf.target, vnorm, nv, kind: kf.kind, note: kf.note || null });
    const newId = made.length ? toPlain(made[0].toObject()).id : null;
    if (newId) {
      await run(driver,
        `MATCH (nf:ProtectedFact {id:$new}) MATCH (old:ProtectedFact {id:$old})-[:DERIVED_FROM]->(s)
         MERGE (nf)-[:DERIVED_FROM]->(s)`, { new: newId, old: kid }).catch(() => {});
    }
    await run(driver,
      `MATCH (kf:ProtectedFact {id:$id})
       SET kf.valid_until=datetime(), kf.invalidated_reason='superseded by approved rewrite',
           kf.superseded_by=$by, ${PFACT_PEND_CLEAR}`, { id: kid, by: newId });
    return { ok: true, decision, outcome: 'altered', newId, value: nv };
  }
  await run(driver,
    `MATCH (kf:ProtectedFact {id:$id})
     SET kf.valid_until=datetime(), kf.invalidated_reason='dropped via approved rewrite', ${PFACT_PEND_CLEAR}`,
    { id: kid });
  return { ok: true, decision, outcome: 'dropped' };
}

// Read-only calendar lens (#25 P1): the graph's dated nodes within a day range, as a flat
// list the client buckets by day. Three date sources, one shape: record-time `created_at`
// (activity heatmap) + `valid_until` (a fact expiring) + the intention-time
// `Goal.target_date`. No writes; `date()` normalizes datetime|date alike.
async function calendar({ from, to } = {}) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? String(from) : null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? String(to) : null;
  if (!f || !t) return { items: [] };
  const q = `
    MATCH (n) WHERE n.created_at IS NOT NULL AND date(n.created_at) >= date($from) AND date(n.created_at) <= date($to)
    RETURN toString(date(n.created_at)) AS date, 'created' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label
    UNION
    MATCH (n) WHERE n.valid_until IS NOT NULL AND date(n.valid_until) >= date($from) AND date(n.valid_until) <= date($to)
    RETURN toString(date(n.valid_until)) AS date, 'expiry' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label
    UNION
    MATCH (g:Goal) WHERE g.target_date IS NOT NULL AND date(g.target_date) >= date($from) AND date(g.target_date) <= date($to)
    RETURN toString(g.target_date) AS date, 'target' AS kind, elementId(g) AS id,
           coalesce(g.name, g.title) AS name, 'Goal' AS label
    UNION
    MATCH (n) WHERE n.due_at IS NOT NULL AND date(n.due_at) >= date($from) AND date(n.due_at) <= date($to)
    RETURN toString(date(n.due_at)) AS date, 'due' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label
    UNION
    MATCH (n) WHERE n.review_at IS NOT NULL AND date(n.review_at) >= date($from) AND date(n.review_at) <= date($to)
    RETURN toString(date(n.review_at)) AS date, 'review' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label`;
  return { items: rows(await run(driver, q, { from: f, to: t })) };
}

// Roadmap / timeline lens (#28): the quarters × goals zoom. Per project that has a goal,
// its goals (with timeframe + intention dates for placement) + the project's milestone Ideas
// (CONTAINS, revealed on lane expand). Read-only; the client does all date placement.
async function roadmap() {
  const q = `
    MATCH (p:Project)<-[:ACHIEVED_BY]-(:Goal)
    WITH DISTINCT p
    OPTIONAL MATCH (p)<-[:ACHIEVED_BY]-(g:Goal)
    WITH p, collect(DISTINCT { id: elementId(g), name: g.name, status: coalesce(g.status,''),
         timeframe: g.timeframe, target_date: toString(g.target_date), due_at: toString(g.due_at) }) AS goals
    OPTIONAL MATCH (p)-[:CONTAINS]->(i:Idea)
    WITH p, goals, collect(DISTINCT { id: elementId(i), name: i.name, status: coalesce(i.status,'') })[0..20] AS milestones
    RETURN { id: elementId(p), name: p.name, status: coalesce(p.status,'') } AS project, goals, milestones
    ORDER BY p.name`;
  return { projects: rows(await run(driver, q)) };
}

// ── Code review (ROADMAP #34) ───────────────────────────────────────────────
// A Review pins a repo to an immutable git ref (resolved to a full SHA at creation,
// so the viewer reads files frozen at that commit and line comments never drift).
// Comments are Notes PART_OF the Review (see addNote's reviewId). Durable in Neo4j;
// the code files themselves stay ephemeral (read live via /api/file/version).
async function createReview({ repo, gitRef } = {}) {
  const dir = String(repo || '').trim();
  if (!dir || !isWithinRoots(dir, SOURCE_ROOTS)) return { error: 'repo not allowed' };
  const refIn = String(gitRef || 'HEAD').trim() || 'HEAD';
  const rp = git(['-C', dir, 'rev-parse', refIn]);          // resolve branch/HEAD/short → full SHA
  if (!rp.ok || !/^[0-9a-fA-F]{40}$/.test(rp.out.trim())) return { error: 'not a git repo or bad ref' };
  const sha = rp.out.trim();
  const recs = await run(driver,
    `MERGE (rv:Review {repo: $repo, git_ref: $sha})
     ON CREATE SET rv.id = randomUUID(), rv.status = 'open', rv.ref_label = $refLabel, rv.created_at = datetime()
     RETURN rv.id AS id, rv.repo AS repo, rv.git_ref AS git_ref, rv.ref_label AS ref_label,
            rv.status AS status, rv.verdict AS verdict, toString(rv.created_at) AS created_at`,
    { repo: dir, sha, refLabel: refIn });
  return { review: toPlain(recs[0].toObject()) };
}
// Open a review surface WITHOUT persisting a node (lazy creation, #34): resolve repo@ref
// → sha, load an existing Review if one already has comments, else return a stub with
// id:null. The node is only created on the first comment (createReview), so opening to
// browse never leaves an empty Review to clean up.
async function resolveReview({ repo, gitRef } = {}) {
  const dir = String(repo || '').trim();
  if (!dir || !isWithinRoots(dir, SOURCE_ROOTS)) return { error: 'repo not allowed' };
  const refIn = String(gitRef || 'HEAD').trim() || 'HEAD';
  const rp = git(['-C', dir, 'rev-parse', refIn]);
  if (!rp.ok || !/^[0-9a-fA-F]{40}$/.test(rp.out.trim())) return { error: 'not a git repo or bad ref' };
  const sha = rp.out.trim();
  const existing = (await getReview({ repo: dir, gitRef: sha })).review;
  const review = existing || { id: null, repo: dir, git_ref: sha, ref_label: refIn, status: 'open', verdict: null, project: null, comments: [] };
  if (!review.ref_label) review.ref_label = refIn;
  return { review };
}
async function getReview({ id, repo, gitRef } = {}) {
  const match = id ? 'MATCH (rv:Review {id: $id})' : 'MATCH (rv:Review {repo: $repo, git_ref: $sha})';
  const recs = await run(driver,
    `${match}
     OPTIONAL MATCH (rv)<-[:PART_OF]-(n:Note)
     OPTIONAL MATCH (rv)-[:ABOUT]->(p:Project)
     RETURN rv.id AS id, rv.repo AS repo, rv.git_ref AS git_ref, rv.ref_label AS ref_label,
            rv.status AS status, rv.verdict AS verdict, toString(rv.created_at) AS created_at,
            head(collect(DISTINCT p.name)) AS project,
            collect(n{ .id, .text, .state, .anchor_kind, .locator, .snippet, .author, .file_path, created_at: toString(n.created_at) }) AS comments`,
    { id: id ? String(id) : null, repo: repo ? String(repo) : null, sha: gitRef ? String(gitRef) : null });
  if (!recs.length) return { review: null };
  const o = toPlain(recs[0].toObject());
  o.comments = (o.comments || []).filter((c) => c && c.id);
  return { review: o };
}
async function listReviews() {
  const recs = await run(driver,
    `MATCH (rv:Review)
     OPTIONAL MATCH (rv)<-[:PART_OF]-(n:Note)
     RETURN rv.id AS id, rv.repo AS repo, rv.git_ref AS git_ref, rv.ref_label AS ref_label,
            rv.status AS status, count(n) AS comments, toString(rv.created_at) AS created_at
     ORDER BY created_at DESC LIMIT 50`);
  return { reviews: rows(recs) };
}
// Changed-file list for a review (so a reviewer sees what to look at, not the whole
// repo). Diffs the reviewed commit against a BASE: defaults to the commit's parent
// (= "this recent commit"), or pass a base branch/SHA for a PR/branch range. Returns
// [{ status: A|M|D|R, rel }] — repo-relative paths with their change type.
async function reviewChanges({ id, repo, ref, base } = {}) {
  if (id) { const r = (await getReview({ id })).review; if (!r) return { error: 'review not found' }; repo = r.repo; ref = r.git_ref; }
  repo = String(repo || ''); ref = String(ref || '');
  if (!repo || !ref || !isWithinRoots(repo, SOURCE_ROOTS)) return { error: 'repo and ref required' };
  const baseIn = (base && String(base).trim()) || (ref + '^');
  const rpBase = git(['-C', repo, 'rev-parse', baseIn]);
  if (!rpBase.ok || !/^[0-9a-fA-F]{40}$/.test(rpBase.out.trim())) return { changes: [], base: null, note: 'no base to diff against (first commit?)' };
  const baseSha = rpBase.out.trim();
  // Resolve ref to a full SHA and hard-validate BOTH endpoints as 40-hex before they reach
  // `git diff` — a crafted ref/base like `--output=…` is a git OPTION, not a commit, so an
  // unvalidated value lets git write an arbitrary file (argument injection). Mirrors line 966.
  const rpRef = git(['-C', repo, 'rev-parse', ref]);
  if (!rpRef.ok || !/^[0-9a-fA-F]{40}$/.test(rpRef.out.trim())) return { error: 'bad ref' };
  const refSha = rpRef.out.trim();
  const d = git(['-C', repo, 'diff', '--name-status', baseSha, refSha]);
  if (!d.ok) return { changes: [], base: baseSha, error: d.error };
  const changes = d.out.split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    return { status: parts[0][0], rel: parts[parts.length - 1] };   // R100 old new → take new path
  });
  return { changes, base: baseSha, baseLabel: baseIn };
}
// Git refs to offer as diff bases in the review (so the user PICKS instead of typing
// git syntax): local branches + recent commits. Read-only, sandboxed.
async function reviewRefs({ id, repo, ref } = {}) {
  if (id) { const r = (await getReview({ id })).review; if (!r) return { error: 'review not found' }; repo = r.repo; ref = r.git_ref; }
  repo = String(repo || '');
  if (!repo || !isWithinRoots(repo, SOURCE_ROOTS)) return { error: 'repo required' };
  const b = git(['-C', repo, 'branch', '--format=%(refname:short)']);
  const branches = b.ok ? b.out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const c = git(['-C', repo, 'log', '-15', '--format=%h%x1f%s']);
  const commits = c.ok ? c.out.split('\n').filter(Boolean).map((l) => { const p = l.split('\x1f'); return { sha: p[0], subject: p.slice(1).join('\x1f') }; }) : [];
  return { ref: ref || null, branches, commits };
}
async function setReviewVerdict({ id, verdict, status } = {}) {
  if (!id) return { error: 'id required' };
  if (status && status !== 'open' && status !== 'resolved') return { error: 'bad status' };
  const recs = await run(driver,
    `MATCH (rv:Review {id: $id})
     SET rv.verdict = coalesce($verdict, rv.verdict)${status ? ', rv.status = $status' : ''}
     RETURN rv.id AS id, rv.verdict AS verdict, rv.status AS status`,
    { id: String(id), verdict: verdict != null ? String(verdict) : null, status: status || null });
  return recs.length ? { ok: true, review: toPlain(recs[0].toObject()) } : { error: 'not found' };
}

// ── System status (ROADMAP #27 settings pane) ───────────────────────────────
// READ-ONLY health for the settings pane: Neo4j up?, bolt URI, counts, last backup,
// allowlisted-folder count. Deliberately no container control (stays local-only,
// no side-effects) — the settings pane links out to the Neo4j browser instead.
async function status() {
  let ok = false, nodes = 0, edges = 0, indexed = 0;
  try {
    const h = toPlain((await run(driver, Q_HEALTH))[0].toObject());
    nodes = h.total; indexed = h.indexed; ok = true;
    edges = toPlain((await run(driver, `MATCH ()-[r]->() RETURN count(r) AS edges`))[0].toObject()).edges;
  } catch (e) { ok = false; }
  let lastBackup = null;
  const backupPath = path.join(__dirname, '..', 'backups', 'graph.json');
  try { lastBackup = fs.statSync(backupPath).mtime.toISOString(); } catch { /* none yet */ }
  return {
    neo4j: { ok, uri: process.env.NEO4J_URI || 'bolt://localhost:7687', browser: process.env.NEO4J_BROWSER || 'http://localhost:7474' },
    counts: { nodes, edges, indexed },
    backup: { lastModified: lastBackup },
    folders: SOURCE_ROOTS.length,
  };
}

// ── Markdown editing: lock + save + git versioning ──────────────────────────
// The Studio's only write-to-disk path. Markdown-only; the lock lives on the file's
// :Source node (the graph is where every agent session is told to look first); each save
// is a git commit on the file's current branch (a revert point), scoped to the one file.
const GIT_TIMEOUT = 5000;
function git(args, trim = true) {
  // Never throws — git is best-effort; a failed commit must not fail a save.
  try { const out = execFileSync('git', args, { encoding: 'utf8', timeout: GIT_TIMEOUT }); return { ok: true, out: trim ? out.trim() : out }; }
  catch (err) { return { ok: false, out: '', error: String((err && err.stderr) || (err && err.message) || err).trim() }; }
}
function repoOf(fp) { const r = git(gitArgs.repoRoot(path.dirname(fp))); return r.ok && r.out ? r.out : null; }

// Advisory edit lock — a local JSON lockfile (NOT Neo4j: a lock is ephemeral operational
// state, doesn't belong in the lifelong graph, and a lockfile works when Neo4j is down and
// is readable by the agent hook in pure shell). Self-pruning on every read.
const LOCKS_PATH = path.join(os.homedir(), '.scatterbrained', 'locks.json');
function readLocks() { try { return lockPrune(JSON.parse(fs.readFileSync(LOCKS_PATH, 'utf8'))); } catch { return {}; } }
function writeLocks(map) {
  try {
    fs.mkdirSync(path.dirname(LOCKS_PATH), { recursive: true });
    const tmp = LOCKS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
    fs.renameSync(tmp, LOCKS_PATH);
  } catch { /* the lock is advisory — never fail a request on lockfile IO */ }
}
// Path relative to the git toplevel, canonicalized so a symlinked root (e.g. macOS
// /tmp → /private/tmp) doesn't produce a "../../.." relpath that breaks `git show`.
function relInRepo(repo, fp) { let real = fp; try { real = fs.realpathSync(fp); } catch { /* gone */ } return path.relative(repo, real); }

function lockFile({ path: fp, reason, force } = {}) {
  if (!fp || !isWithinRoots(fp, SOURCE_ROOTS)) return { error: 'forbidden' };
  if (detectKind(fp) !== 'markdown') return { error: 'only markdown files are editable' };
  if (!fs.existsSync(fp)) return { error: 'file not found' };
  const r = lockAcquire(readLocks(), fp, { holder: HOLDER_STUDIO, reason: String(reason || 'editing'), force: !!force });
  if (!r.acquired) return { acquired: false, holder: r.holder, lockAt: r.lockAt, reason: r.reason };
  writeLocks(r.map);
  // Return the current disk bytes + baseHash so the editor can detect later drift on save.
  try { const text = fs.readFileSync(fp).toString('utf8'); return { acquired: true, holder: HOLDER_STUDIO, text, baseHash: hashText(text) }; }
  catch (err) { return { error: 'could not read file: ' + String(err.message || err) }; }
}

function unlockFile({ path: fp } = {}) {
  if (!fp) return { error: 'path required' };
  writeLocks(lockRelease(readLocks(), fp, HOLDER_STUDIO));
  return { released: true };
}

// SAFETY: never let a Studio save destroy at-risk on-disk content (an agent's or another
// tool's uncommitted work). Before overwriting, preserve whatever is on disk — commit it in
// a git repo (the dirty-tree tripwire is universal: it fires for ANY tool, not just agents
// that honored the lock), else copy it to a timestamped backup. This is the real guarantee;
// the lock is only friction-reduction.
function snapshotBeforeOverwrite(fp, onDisk, text) {
  if (onDisk === null || onDisk === text) return null;        // nothing on disk, or no change → nothing at risk
  const repo = repoOf(fp);
  if (repo) {
    const dirty = git(gitArgs.status(repo, fp));
    if (dirty.ok && dirty.out.trim()) {                       // modified or untracked → preserve it first
      if (git(gitArgs.add(repo, fp)).ok) {
        const c = git(gitArgs.commit(repo, `studio: snapshot ${relInRepo(repo, fp)} before save (uncommitted — possible external/agent edit)`, fp));
        if (c.ok) { const h = git(gitArgs.headRev(repo, fp)); return { method: 'commit', rev: h.ok ? h.out : null }; }
      }
    }
    return null;                                              // clean tree → the prior bytes are already safe in HEAD
  }
  try {                                                       // non-repo → backup outside the project tree
    const dir = path.join(os.homedir(), '.scatterbrained', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const bak = path.join(dir, `${path.basename(fp)}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
    fs.writeFileSync(bak, onDisk);
    return { method: 'backup', path: bak };
  } catch { return null; }
}

async function saveFile({ path: fp, text, baseHash, restoreOf, overwrite } = {}) {
  const v = validateSave({ path: fp, text, roots: SOURCE_ROOTS, maxBytes: SOURCE_MAX_BYTES });
  if (!v.ok) return { error: v.error };
  if (typeof text !== 'string') return { error: 'text required' };
  // The lock must still be mine (a stale-takeover could have happened mid-edit).
  const st = lockStatus(readLocks(), fp);
  if (st && st.holder && st.holder !== HOLDER_STUDIO && !st.stale) return { lockLost: true, holder: st.holder };
  // Read the current disk bytes ONCE, immediately before writing (tightest conflict window).
  let onDisk = null; try { onDisk = fs.readFileSync(fp, 'utf8'); } catch { onDisk = null; }
  if (!overwrite && baseHash && onDisk !== null && hashText(onDisk) !== baseHash) return { conflict: true, currentText: onDisk };
  // Preserve any at-risk on-disk content BEFORE clobbering it.
  const snapshot = snapshotBeforeOverwrite(fp, onDisk, text);
  // Atomic write: temp + rename (no torn writes; .sbtmp is outside TEXT_KINDS → ingest ignores).
  const tmp = fp + '.sbtmp';
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, fp); }
  catch (err) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } return { error: 'write failed: ' + String(err.message || err) }; }
  const newHash = hashText(text);
  const mtime = new Date(fs.statSync(fp).mtimeMs).toISOString();
  // Git commit — best-effort, NEVER fatal (the file is already saved).
  let committed = false, rev = null, gitError = null;
  const repo = repoOf(fp);
  if (repo) {
    const relpath = relInRepo(repo, fp);
    const add = git(gitArgs.add(repo, fp));
    if (add.ok) {
      const c = git(gitArgs.commit(repo, commitMessage(relpath, restoreOf ? 'restore' : 'edit', restoreOf || ''), fp));
      if (c.ok) { committed = true; const h = git(gitArgs.headRev(repo, fp)); rev = h.ok ? h.out : null; }
      else if (!/nothing to commit/i.test(c.error || '')) gitError = c.error;
    } else gitError = add.error;
  } else gitError = 'not a git repo';
  try { await run(driver, 'MATCH (s:Source {file_path: $fp}) SET s.content_hash = $h, s.file_mtime = $m', { fp, h: newHash, m: mtime }); } catch { /* graph is secondary; the file is saved */ }
  writeLocks(lockRelease(readLocks(), fp, HOLDER_STUDIO));
  return { saved: true, committed, rev, content_hash: newHash, gitError, snapshot };
}

function fileHistory(fp) {
  if (!fp || !isWithinRoots(fp, SOURCE_ROOTS)) return { error: 'forbidden' };
  const repo = repoOf(fp);
  if (!repo) return { versions: [], repo: null };
  const r = git(gitArgs.log(repo, fp, 50));
  return { repo, versions: r.ok ? parseLog(r.out) : [], error: r.ok ? undefined : r.error };
}
function fileVersion(fp, rev) {
  if (!fp || !isWithinRoots(fp, SOURCE_ROOTS)) return { error: 'forbidden' };
  if (!/^[0-9a-fA-F]{4,40}$/.test(String(rev || ''))) return { error: 'bad rev' };
  const repo = repoOf(fp);
  if (!repo) return { error: 'not a git repo' };
  const r = git(gitArgs.show(repo, relInRepo(repo, fp), rev), false);   // untrimmed: exact bytes
  return r.ok ? { rev, text: r.out } : { error: r.error || 'not found' };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript', '.map': 'application/json' };
const RAW_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

// Baseline defense-in-depth headers for the app document. script/style keep 'unsafe-inline'
// because the UI uses inline event handlers — the real XSS sinks are scheme-gated at the
// source (provenance/miniMarkdown/link). object-src 'none' + frame-ancestors 'none' close the
// <object>/<embed> SVG vector and clickjacking; frame-src is limited to the video embed hosts.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

// Read a request body with a hard BYTE cap. Resolves on 'end'; rejects on overflow or abort.
// A destroyed stream never emits 'end', so we must also settle on 'close'/'error' — otherwise
// the handler's await hangs forever and the socket leaks. Byte-counted (Buffer.length), not chars.
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    let body = '', len = 0, settled = false;
    // Reject (don't destroy the socket — that would also kill the response, so the caller's
    // 413 never reaches the client) and stop buffering once over cap; later chunks are dropped.
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    req.on('data', (c) => { len += c.length; if (len > cap) done(reject, new Error('too large')); else if (!settled) body += c; });
    req.on('end', () => done(resolve, body));
    req.on('close', () => done(reject, new Error('aborted')));
    req.on('error', () => done(reject, new Error('aborted')));
  });
}

// DNS-rebinding / CSRF guard: a state-changing request must arrive with a loopback Host.
// (Strips the :port and any [::1] brackets.) Defense-in-depth on top of the loopback bind.
function isLocalHost(req) {
  const h = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    // Every state-changing request is a POST; reject any that didn't arrive with a loopback
    // Host (DNS-rebinding / cross-site). The loopback bind is the primary control; this is depth.
    if (req.method === 'POST' && !isLocalHost(req)) return send(res, 403, { error: 'forbidden' });
    // Raw byte stream for in-app binary viewers (PDF/images), sandboxed to the allowlist.
    if (url.pathname === '/api/raw') {
      const fp = String(url.searchParams.get('path') || '');
      const ext = (/\.([a-z0-9]+)$/i.exec(fp) || [, ''])[1].toLowerCase();
      if (!fp || !isWithinRoots(fp, SOURCE_ROOTS) || !RAW_TYPES[ext]) return send(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(fp)) return send(res, 404, { error: 'not found' });
      // SVG can carry <script> that runs as THIS origin if navigated to directly. Browsers
      // ignore Content-Disposition on <img> (inline viewers still render it) but honor it on
      // top-level navigation — so `attachment` neutralizes the script vector; nosniff stops
      // MIME-confusion on the rest.
      const svg = ext === 'svg';
      res.writeHead(200, {
        'Content-Type': RAW_TYPES[ext],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': svg ? 'attachment' : 'inline',
      });
      const rs = fs.createReadStream(fp);
      rs.on('error', () => { if (!res.headersSent) send(res, 500, { error: 'read failed' }); else res.destroy(); });
      return rs.pipe(res);
    }
    // Mutate the folder allowlist (grant/revoke). The one write endpoint; guardrailed.
    if (url.pathname === '/api/roots' && req.method === 'POST') {
      let body; try { body = await readBody(req, 4096); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = mutateRoots(String(p.action || ''), String(p.path || ''), p.tags);
      return send(res, result.error ? 400 : 200, result);
    }
    // Notes: add a note to a node, or change a note's state.
    if ((url.pathname === '/api/note' || url.pathname === '/api/note/state') && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/note' ? await addNote(p) : await setNoteState(p.id, p.state);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Markdown editing: acquire/release the edit lock, or save (write + git commit).
    if ((url.pathname === '/api/file/lock' || url.pathname === '/api/file/unlock' || url.pathname === '/api/file/save') && req.method === 'POST') {
      const cap = url.pathname === '/api/file/save' ? SOURCE_MAX_BYTES + 16 * 1024 : 8192;
      let body; try { body = await readBody(req, cap); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      if (p && p.path) p.path = absSrc(p.path);   // resolve repo-relative paths (e.g. demo files)
      const result = url.pathname === '/api/file/lock' ? await lockFile(p)
        : url.pathname === '/api/file/unlock' ? await unlockFile(p)
          : await saveFile(p);
      const code = result.error ? 400 : result.conflict ? 409 : (result.lockLost || result.acquired === false) ? 423 : 200;
      if (url.pathname === '/api/file/save' && code === 200) broadcast('graph-changed');
      return send(res, code, result);
    }
    // Link intake: save a web link (+ fuzzy associate), or attach an existing link.
    if ((url.pathname === '/api/link' || url.pathname === '/api/link/attach') && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/link' ? await addLink(p) : await attachLink(p.linkId, p.targetId);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Code review (#34): create a review, or set its verdict/status.
    if ((url.pathname === '/api/review' || url.pathname === '/api/review/verdict') && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/review' ? await createReview(p) : await setReviewVerdict(p);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Inline associate (#29): wire / remove a typed edge between two existing nodes.
    if ((url.pathname === '/api/relate' || url.pathname === '/api/relate/remove') && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/relate' ? await relate(p) : await unrelate(p);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Goal target_date (#25 P1) + intention-time scheduler (#25 P2): narrow scalar setters.
    if ((url.pathname === '/api/goal/target-date' || url.pathname === '/api/schedule') && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/schedule' ? await setSchedule(p) : await setGoalTargetDate(p);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Protected key-facts (#23): pin/unpin a fact, check a rewrite (optionally queue), resolve.
    if (url.pathname.startsWith('/api/protected-fact/') && url.pathname !== '/api/protected-fact/suggest' && req.method === 'POST') {
      let body; try { body = await readBody(req, 64 * 1024); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/protected-fact/pin' ? await pinProtectedFact(p)
        : url.pathname === '/api/protected-fact/unpin' ? await unpinProtectedFact(p)
          : url.pathname === '/api/protected-fact/check' ? await checkProtectedFacts(p)
            : url.pathname === '/api/protected-fact/update' ? await updateProtectedFact(p)
              : url.pathname === '/api/protected-fact/restore' ? await restoreProtectedFact(p)
                : url.pathname === '/api/protected-fact/resolve' ? await resolveProtectedFact(p)
                  : { error: 'unknown protected-fact action' };
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const data = await api(url.pathname, Object.fromEntries(url.searchParams));
      if (data === null) return send(res, 404, { error: 'not found' });
      return send(res, 200, data);
    }
    // static
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain', ...SECURITY_HEADERS });
    const rs = fs.createReadStream(file);
    rs.on('error', () => { if (!res.headersSent) send(res, 500, { error: 'read failed' }); else res.destroy(); });
    rs.pipe(res);
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
});

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

// Bind loopback only — this BFF reads/writes local files and the graph with NO auth, so it
// must never be reachable from the LAN (the file-header "only ever talks to localhost" intent).
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Scatterbrained Studio  ·  observatory`);
  console.log(`  ▸ http://127.0.0.1:${PORT}`);
  console.log(`  ▸ Neo4j: ${process.env.NEO4J_URI || 'bolt://localhost:7687'}\n`);
});

const bye = async () => { await driver.close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
