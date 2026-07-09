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
// This is the canonical (private-workspace) build. The sanitized, generic version
// ports to the public Scatterbrained mirror via scripts/sync-scatterbrained.sh.
// ============================================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { autostartDecision, slipwayCommand, slipwayDirCandidates } from './lib/slipway-boot.js';
import neo4j from 'neo4j-driver';
import { acquire as lockAcquire, release as lockRelease, status as lockStatus, prune as lockPrune, HOLDER_STUDIO } from './lib/filelock.js';
import { hashText, validateSave, gitArgs, parseLog, commitMessage } from './lib/save.js';
import { getDriver, run, toPlain } from './scripts/lib/db.js';
import { IDENTITY_LABELS as ALIAS_LABELS, NAME_FIELDS as ALIAS_NAME_FIELDS, brandRegexCypher } from './scripts/lib/aliases.js';
import { keysLookAlike } from './scripts/lib/identity.js';
import { REL_TYPES, REL_SHAPES, isValidRelType, isValidRelShape, isProvenanceRelType } from './scripts/lib/vocab.js';
import { isScheduleKind, isIsoDate, isRecurKind } from './public/lib/schedule.js';
import { effectiveDate, recurLabel } from './public/lib/recurrence.js';
import { detectCandidates, normalizeValue, isProtectedFactKind, checkRewrite } from './public/lib/protected-facts.js';
import { NOTE_CYCLE_STATES } from './public/lib/docnotes.js';
import { VERIFY_STATES, shapeCriteriaLane } from './public/lib/criteria.js';
import { isWebUrl, isVideoUrl } from './public/lib/links.js';
import { buildBriefMarkdown, deriveBriefInput, cwdHint } from './public/lib/brief.js';
import { resolveProvider, resolveProviderDetailed, generate, unloadModel } from './lib/inference.js';
import { available as pumlAvailable, render as pumlRender } from './lib/plantuml.js';
import { prepareSvg } from './public/lib/diagram-svg.js';
import { toPlantuml } from './public/lib/graph-puml.js';
import { aiDiagram as aiDiagramLane } from './lib/ai-diagram.js';
import { buildDocTree } from './public/lib/docsite.js';
import { buildLocalSystemPrompt, digestBlock, overviewBlock, recentBlock, findingsBlock, PERSONA_BRIEF } from './lib/persona.js';
import { fetchDigestRows } from './scripts/lib/digest-query.js';
import { createVoiceSession, LISTEN_DEFAULT_S, LISTEN_MAX_S, LISTEN_IDLE_S } from './lib/voice-session.js';
import { createMcp } from './lib/mcp.js';
import { validatePanel } from './lib/panels.js';
import { recommendChartFromObjects } from './public/lib/dataviz.js';
import { validateChartSpec } from './public/lib/chart-spec.js';
import { ttsAvailable, synth as ttsSynth, TTS_VOICES, TTS_DEFAULT } from './lib/tts.js';
import { sttAvailable as sttLocalAvailable, transcribe as sttTranscribe, installedModels as sttInstalledModels, STT_DEFAULT } from './lib/stt.js';
import { addSession, markCaptured, pruneSessions, sessionsView } from './lib/agent-sessions.js';
import { resolveReviewProject } from './lib/review-project.js';
import { cleanTranscript } from './lib/ansi.js';
import { detectKind, expandRoots, isWithinRoots, pickPrimarySource, excerptAround, TEXT_KINDS } from './lib/source.js';
import { buildModuleGraph, repoInsights, langOf, resolveImport } from './lib/codebase.js';
import { parseImportBindings, callSites } from './public/lib/symbols.js';
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
// Resolve symlinks before a sandbox check or read, so a symlink INSIDE an allowlisted root can't
// point outside it (path.resolve is purely lexical — it normalizes `..` but follows no links).
// realpath throws on a missing path → fall back to the lexical path so the endpoints' normal
// existsSync/"missing" handling still runs. Roots are realpath'd too (below) so a root that is
// itself under a symlink (e.g. macOS /tmp -> /private/tmp) still matches a realpath'd file.
function realOf(fp) { try { return fs.realpathSync(fp); } catch { return fp; } }
function loadRoots() {
  try { ROOTS_CFG = JSON.parse(fs.readFileSync(ROOTS_PATH, 'utf8')); } catch { ROOTS_CFG = { roots: [] }; }
  try { SOURCE_ROOTS = expandRoots(ROOTS_CFG, os.homedir()).map(realOf); } catch { SOURCE_ROOTS = []; }
  try { if (fs.existsSync(DEMO_DIR) && !SOURCE_ROOTS.some((r) => r === realOf(DEMO_DIR))) SOURCE_ROOTS.push(realOf(DEMO_DIR)); } catch { /* ignore */ }
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

// Intelligence layer (M-E) — LLM-OPTIONAL, LOCAL-ONLY. Provider resolution + both wire
// formats live in lib/inference.js (Act plane Phase 4): Slipway-managed MLX when running,
// else Ollama; a Slipway 'cloud' backend is treated as unavailable (no external API calls).
// Every endpoint still degrades to { available:false } when no local model is up.
const nodeText = (n) => (n ? [n.name, n.desc].filter(Boolean).join('\n\n') : '');

// ── Act plane (Phase 2, "Open agent here") ───────────────────────────────────
// Slipway = the local agent runtime (http://127.0.0.1:8765). We reach it SERVER-SIDE
// (never the browser): a Node fetch sends no Origin, so Slipway's Origin allowlist —
// which only rejects a PRESENT, non-allowlisted Origin — is satisfied. Optional +
// usually-not-running, so same degrade-to-null discipline as the Ollama helper.
const SLIPWAY = process.env.SLIPWAY_HOST || 'http://127.0.0.1:8765';
async function slipwayPing(timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { const r = await fetch(SLIPWAY + '/api/status', { signal: ctrl.signal }); return r.ok; }
  catch { return false; } finally { clearTimeout(t); }
}
async function slipwayLaunch(body, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(SLIPWAY + '/api/term/launch', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) return { error: `slipway returned ${r.status}` };
    return await r.json();
  } catch { return { error: 'slipway unreachable' }; } finally { clearTimeout(t); }
}
// Model loading through Slipway — the one-click remedy for the voice panel's 'no-model'
// empty state. GET /api/models lists what Slipway can serve; POST /api/switch loads one.
// TRUST BOUNDARY: the browser's model string is never forwarded as-is — it must match an
// id in Slipway's own list (local backends only; 'cloud' is never loadable from here, the
// inference lane refuses cloud anyway).
async function slipwayModels(timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(SLIPWAY + '/api/models', { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const models = (Array.isArray(j.models) ? j.models : []).filter((m) => m && (m.backend === 'mlx' || m.backend === 'ollama'));
    return models;
  } catch { return null; } finally { clearTimeout(t); }
}
async function slipwayLoad(model, timeoutMs = 15000) {
  const models = await slipwayModels();
  if (!models) return { error: 'slipway unreachable' };
  const entry = models.find((m) => m.id === model);
  if (!entry) return { error: 'unknown model' };          // never forward an unlisted id
  const post = async (pathSuffix, body) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(SLIPWAY + pathSuffix, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
      if (!r.ok) return { error: `slipway returned ${r.status}` };
      return await r.json();
    } catch { return { error: 'slipway unreachable' }; } finally { clearTimeout(t); }
  };
  // switch() only SELECTS when nothing is serving (lazy by design) — start() does the load.
  const sw = await post('/api/switch', { model: entry.id, backend: entry.backend });
  if (sw.error) return sw;
  const st = await post('/api/start');
  if (st.error) return st;
  if (st.ok === false) return { error: st.msg || 'start refused' };
  return st;
}
// Thin passthrough to Slipway's archive endpoints (source of truth = Slipway's session
// index; the Studio never persists archive state). Same server-side, no-Origin posture as
// slipwayLaunch — the browser can't reach :8765 cross-origin. Rail-VISIBILITY only: Slipway
// never deletes a session, so a captured session's graph Source/INFORMS edges are untouched.
async function slipwayArchive(pathSuffix, body, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(SLIPWAY + pathSuffix, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    if (!r.ok) return { error: `slipway returned ${r.status}` };
    return await r.json();
  } catch { return { error: 'slipway unreachable' }; } finally { clearTimeout(t); }
}

// Resolve a node's path hint to a real, IN-SANDBOX working directory. Prefers the file's
// git repo root, else its own directory — whichever lives inside an allowlisted SOURCE_ROOT.
// Returns null when nothing resolves in-sandbox (→ the node has no launchable local dir).
function resolveAgentCwd(hint) {
  if (!hint) return null;
  let p = realOf(absSrc(String(hint)));
  try { if (fs.existsSync(p) && fs.statSync(p).isFile()) p = path.dirname(p); } catch { /* ignore */ }
  let gitRoot = null, dir = p;
  for (let i = 0; i < 12 && dir && dir !== path.dirname(dir); i++) {
    try { if (fs.existsSync(path.join(dir, '.git'))) { gitRoot = dir; break; } } catch { /* ignore */ }
    dir = path.dirname(dir);
  }
  for (const c of [gitRoot, p].filter(Boolean)) {
    const rc = realOf(c);
    try { if (isWithinRoots(rc, SOURCE_ROOTS) && fs.statSync(rc).isDirectory()) return rc; } catch { /* ignore */ }
  }
  return null;
}

// The graph→agent plan: given a node id, resolve its working dir + compose a brief +
// choose the launcher kind — WITHOUT writing or launching (that's POST /api/agent/launch).
// "preset else hosted": a repo with a .slipway.json pins its own model (kind=launcher →
// claude-local reads the preset); otherwise launch hosted Claude Code (kind=hosted).
async function buildAgentPlan(id) {
  if (!id) return { error: 'missing id' };
  const node = rows(await run(driver, Q_NODE, { id: String(id) }))[0];
  if (!node) return { error: 'node not found' };
  const cwd = resolveAgentCwd(cwdHint(node));
  if (!cwd) return { error: 'no local working directory for this node' };
  // Code-graph tie-in: map the resolved repo so the brief can point the agent at the hub files
  // first. Best-effort — a walk failure (huge/odd repo) must never fail the brief; skip the map.
  let repoMap = null;
  try { const ins = repoInsights(buildModuleGraph(walkRepo(cwd).files)); if (ins.fileCount) repoMap = ins; }
  catch { /* brief works without a map */ }
  const brief = buildBriefMarkdown(deriveBriefInput(node), cwd, repoMap);
  // "preset else hosted" is decided INSIDE claude-local (which always runs, so the brief always
  // loads): a repo with .slipway.json uses its pinned model; otherwise hosted Claude Code. We only
  // surface which one for the popover's label here.
  let preset = false;
  try { preset = fs.existsSync(path.join(cwd, '.slipway.json')); } catch { /* ignore */ }
  return { node, cwd, preset, brief };
}

const BRIEF_FILE = 'SLIPWAY_BRIEF.md';
const BRIEF_MAX_BYTES = 64 * 1024;
// Write the brief into the resolved cwd, then launch. Trust-boundary rigor (never minimized):
// re-validate cwd ∈ SOURCE_ROOTS, force a FIXED basename (no client-influenced path), re-assert
// the final path stays inside the realpath'd cwd (defeats symlink/traversal), and cap the size.
async function agentLaunch(id) {
  const plan = await buildAgentPlan(id);
  if (plan.error) return plan;
  const dir = realOf(plan.cwd);
  if (!isWithinRoots(dir, SOURCE_ROOTS)) return { error: 'forbidden' };
  const briefPath = path.join(dir, BRIEF_FILE);
  if (path.dirname(briefPath) !== dir || path.basename(briefPath) !== BRIEF_FILE) return { error: 'forbidden' };
  const content = String(plan.brief || '').slice(0, BRIEF_MAX_BYTES);
  try {
    // O_NOFOLLOW: refuse to follow a symlink at the leaf. The DIR is realpath-validated in-sandbox,
    // but writeFileSync would follow a planted SLIPWAY_BRIEF.md symlink and clobber its out-of-sandbox
    // target; O_NOFOLLOW makes the open fail (ELOOP) instead.
    const fd = fs.openSync(briefPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o644);
    try { fs.writeSync(fd, content); } finally { fs.closeSync(fd); }
  } catch (e) {
    return { error: (e && e.code === 'ELOOP') ? 'refusing to write the brief through a symlink' : 'could not write brief: ' + String(e.message || e) };
  }
  // Always launch via claude-local (kind='launcher') so it runs and loads SLIPWAY_BRIEF.md; claude-local
  // itself resolves "project preset (.slipway.json) else hosted Claude Code subscription".
  const launch = await slipwayLaunch({ kind: 'launcher', cwd: dir });
  if (launch.error) return { error: launch.error, cwd: dir, preset: plan.preset, briefPath };
  // Phase 3: remember which node this session came from (sid → origin), so the ended session
  // can be captured back into the graph. Bookkeeping must NEVER fail the launch — it happened.
  // VALIDATE the sid at this trust boundary: a spoofed/hostile Slipway on :8765 could return a
  // non-hex id that would otherwise become a map key rendered into the dock (XSS) and joined into
  // a transcript path (traversal). A real sid is 16 hex chars; anything else just isn't recorded.
  if (SID_RE.test(String(launch.id || ''))) {
    try {
      writeAgentSessions(addSession(readAgentSessions(), {
        sid: launch.id, nodeId: plan.node.id, nodeName: plan.node.name, nodeLabel: plan.node.label,
        cwd: dir, briefPath, label: launch.label, launchedAt: new Date().toISOString(),
      }));
    } catch { /* dock row lost at worst */ }
  }
  return { ok: true, cwd: dir, preset: plan.preset, briefPath, launch };
}

// ── Act plane (Phase 3, capture sessions back) ───────────────────────────────
// The return path of the graph↔agent loop: an ended Slipway session becomes a Source node
// (metadata + file_path to the transcript — the text stays on disk; the inspector reads the
// .log through the /api/source sandbox), INFORMS its origin node/project, and can be
// summarized into an Insight — always user-triggered, never automatic (graph discipline).
const AGENT_SESSIONS_PATH = path.join(os.homedir(), '.scatterbrained', 'agent-sessions.json');
// CONTRACT with Slipway (mlx-control/CLAUDE.md "Federation contract"): transcripts live at
// ~/.claude-code-router/terminals/<sid>.log; deep-links are #terminals / #term:<sid>.
const SLIPWAY_TERM_DIR = path.join(os.homedir(), '.claude-code-router', 'terminals');
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;   // capture reads at most the last 1 MB
const SID_RE = /^[0-9a-f]{1,32}$/;           // Slipway sids are 16 hex chars
// Edge targets derived from the closed vocab — never hardcoded (lint shape discipline).
const INFORMS_TARGETS = new Set(REL_SHAPES.INFORMS.map((s) => s.split('>')[1]));
const INSIGHT_ABOUT_TARGETS = new Set(REL_SHAPES.ABOUT.filter((s) => s.startsWith('Insight>')).map((s) => s.split('>')[1]));

function readAgentSessions() { try { return pruneSessions(JSON.parse(fs.readFileSync(AGENT_SESSIONS_PATH, 'utf8'))); } catch { return {}; } }
function writeAgentSessions(map) {
  fs.mkdirSync(path.dirname(AGENT_SESSIONS_PATH), { recursive: true });
  const tmp = AGENT_SESSIONS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(pruneSessions(map), null, 2));
  fs.renameSync(tmp, AGENT_SESSIONS_PATH);
}

async function slipwayHistory(timeoutMs = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(SLIPWAY + '/api/term/history', { signal: ctrl.signal });
    if (!r.ok) return null;
    return (await r.json()).sessions || [];
  } catch { return null; } finally { clearTimeout(t); }
}

// Primary transcript path: direct tail-read from disk (works with Slipway down — the main
// capture window — and isn't capped at the API's 256 KB). Sandbox-disciplined like every
// file read: realpath + isWithinRoots (the ~/.claude-code-router/terminals root grant).
function readTranscriptTail(sid) {
  const fp = realOf(path.join(SLIPWAY_TERM_DIR, sid + '.log'));
  if (!isWithinRoots(fp, SOURCE_ROOTS)) return { blocked: true };
  let st; try { st = fs.statSync(fp); } catch { return { error: 'no transcript on disk for this session' }; }
  const start = Math.max(0, st.size - TRANSCRIPT_TAIL_BYTES);
  const buf = Buffer.alloc(st.size - start);
  const fd = fs.openSync(fp, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  return { text: buf.toString('utf8'), bytes: st.size, mtimeMs: st.mtimeMs, truncated: start > 0, filePath: fp };
}
// Fallback when the read-sandbox grant hasn't reached this checkout: Slipway's own transcript
// API (capped at its last 256 KB — still plenty for a capture).
async function slipwayTranscript(sid, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(SLIPWAY + '/api/term/transcript?id=' + encodeURIComponent(sid), { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.error || j.text == null) return null;
    return { text: j.text, bytes: j.text.length, mtimeMs: null, truncated: !!j.truncated, filePath: path.join(SLIPWAY_TERM_DIR, sid + '.log') };
  } catch { return null; } finally { clearTimeout(t); }
}

// (primary-label expression inlined — PRIMARY_LABEL is declared later in the module, and a
// template literal here would hit its temporal dead zone at module evaluation.)
const AGENT_LABEL_EXPR = `head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n))`;
const Q_AGENT_ORIGIN_BY_ID = `MATCH (n) WHERE elementId(n) = $id
  RETURN elementId(n) AS id, coalesce(n.name, n.title) AS name, ${AGENT_LABEL_EXPR} AS label`;
// elementIds are not durable across export/import — fall back by stored name + label.
const Q_AGENT_ORIGIN_BY_NAME = `MATCH (n) WHERE coalesce(n.name, n.title) = $name AND $label IN labels(n)
  RETURN elementId(n) AS id, coalesce(n.name, n.title) AS name, ${AGENT_LABEL_EXPR} AS label LIMIT 1`;
const Q_AGENT_PROJECT = `MATCH (n) WHERE elementId(n) = $id
  OPTIONAL MATCH (n)-[:PART_OF]->(p:Project)
  RETURN CASE WHEN 'Project' IN labels(n) THEN elementId(n) ELSE elementId(p) END AS pid,
         CASE WHEN 'Project' IN labels(n) THEN coalesce(n.name, n.title) ELSE p.name END AS pname`;
const Q_AGENT_SOURCE = `MERGE (s:Source {title: $title})
  SET s.created_at = coalesce(s.created_at, datetime()),
      s.source_kind = 'agent_session', s.type = 'agent_session',
      s.file_path = $fp, s.display_title = $dt, s.session_id = $sid,
      s.model = CASE WHEN $model <> '' THEN $model ELSE coalesce(s.model, '') END,
      s.launcher = CASE WHEN $launcher <> '' THEN $launcher ELSE coalesce(s.launcher, '') END,
      s.cwd = $cwd, s.launched_at = $launchedAt,
      s.captured_at = datetime(), s.last_synced_at = datetime(),
      s.content_hash = $hash, s.file_mtime = $mtime, s.transcript_bytes = $bytes, s.tags = $tags
  RETURN elementId(s) AS id`;
const Q_AGENT_INFORMS = `MATCH (s:Source {title: $title}) MATCH (n) WHERE elementId(n) = $nid MERGE (s)-[:INFORMS]->(n)`;

async function resolveAgentOrigin(entry) {
  let origin = rows(await run(driver, Q_AGENT_ORIGIN_BY_ID, { id: String(entry.nodeId || '') }))[0];
  if (!origin && entry.nodeName) {
    origin = rows(await run(driver, Q_AGENT_ORIGIN_BY_NAME, { name: entry.nodeName, label: entry.nodeLabel || '' }))[0];
  }
  return origin || null;
}

async function agentCapture(p) {
  const sid = String(p.sid || '');
  if (!SID_RE.test(sid)) return { error: 'bad sid' };
  const map = readAgentSessions();
  const entry = map[sid];
  if (!entry) return { error: 'not a graph-launched session (no origin node recorded)' };
  let t = readTranscriptTail(sid);
  if (t.blocked) t = (await slipwayTranscript(sid)) || { error: 'transcript outside the read sandbox and Slipway is down — grant ~/.claude-code-router/terminals in folder permissions' };
  if (t.error) return { error: t.error };
  const text = cleanTranscript(t.text);
  if (!text) return { error: 'transcript is empty — nothing to capture' };
  const origin = await resolveAgentOrigin(entry);
  if (!origin) return { error: `origin node not found (was: ${entry.nodeName || entry.nodeId})` };
  const title = 'agent-session/' + sid;
  const dt = `Agent session — ${origin.name} (${String(entry.launchedAt || '').slice(0, 10) || 'undated'})`;
  // model/launcher come from Slipway's own history (never the client body — untrusted). May be {}
  // if Slipway is down / the row was pruned; the query then preserves any previously-captured value.
  const hist = ((await slipwayHistory()) || []).find((h) => h.id === sid) || {};
  // Track "grown since capture" against RAW on-disk bytes. The fallback (slipwayTranscript) returns
  // decoded, 256KB-capped char length, so prefer Slipway history's raw transcript_bytes there.
  const rawBytes = (hist.transcript_bytes != null ? hist.transcript_bytes : t.bytes) || 0;
  await run(driver, Q_AGENT_SOURCE, {
    title, fp: t.filePath, dt, sid,
    model: hist.model || '', launcher: hist.launcher || '', cwd: entry.cwd || '',
    launchedAt: entry.launchedAt || null, hash: hashText(text),
    mtime: t.mtimeMs != null ? new Date(t.mtimeMs).toISOString() : null,
    bytes: rawBytes, tags: ['agent-session', 'slipway'],
  });
  // Provenance edges, gated by the closed shape vocab (Source>Project always legal; the
  // origin edge only when its label is a legal INFORMS target).
  if (INFORMS_TARGETS.has(origin.label)) await run(driver, Q_AGENT_INFORMS, { title, nid: origin.id });
  const proj = rows(await run(driver, Q_AGENT_PROJECT, { id: origin.id }))[0];
  if (proj && proj.pid && proj.pid !== origin.id) await run(driver, Q_AGENT_INFORMS, { title, nid: proj.pid });
  const recaptured = !!entry.captured;
  // Re-read the map at write time — capture spans several awaits, and a concurrent launch/capture
  // must not be clobbered by persisting a stale snapshot (lost update).
  writeAgentSessions(markCaptured(readAgentSessions(), sid, {
    capturedAt: new Date().toISOString(), sourceTitle: title,
    transcriptBytes: rawBytes, contentHash: hashText(text),
  }));
  return { ok: true, sourceTitle: title, bytes: rawBytes, truncated: !!t.truncated, recaptured };
}

// Summarize a CAPTURED session's transcript into an Insight via the local inference lane.
// Separate endpoint (retry a summary without re-capturing); never automatic.
async function agentSummarize(p) {
  const sid = String(p.sid || '');
  if (!SID_RE.test(sid)) return { error: 'bad sid' };
  const map = readAgentSessions();
  const entry = map[sid];
  if (!entry) return { error: 'not a graph-launched session' };
  if (!entry.captured || !entry.sourceTitle) return { error: 'capture this session first' };
  const prov = await resolveProvider();
  if (!prov) return { available: false };
  let t = readTranscriptTail(sid);
  if (t.blocked) t = (await slipwayTranscript(sid)) || { error: 'transcript unreachable' };
  if (t.error) return { error: t.error };
  const cleaned = cleanTranscript(t.text);
  const tail = cleaned.slice(-12000);   // local models: bounded context, newest work wins
  const prompt = `Below is the tail of a coding-agent terminal session that worked on "${entry.nodeName || 'a project'}". `
    + `Summarize what the session DID, DECIDED, and CONCLUDED in 3-6 concrete sentences (name files/features/outcomes; no fluff). `
    + `If it's just a startup banner or noise, say so plainly.\n\n---\n${tail}\n---\n\nSummary:`;
  const text = await generate(prov, prompt, { timeoutMs: 120000 });
  if (text == null) return { available: true, error: 'generation failed' };
  const summary = text.trim();
  const existing = rows(await run(driver,
    `MATCH (i:Insight {session_id: $sid})-[:DERIVED_FROM]->(:Source {title: $title}) RETURN i.id AS id LIMIT 1`,
    { sid, title: entry.sourceTitle }))[0];
  const iid = existing ? existing.id : crypto.randomUUID();
  await run(driver, `MERGE (i:Insight {id: $iid})
    SET i.created_at = coalesce(i.created_at, datetime()),
        i.summary = $summary, i.full_text = $full, i.session_id = $sid, i.tags = $tags`,
  { iid, summary: summary.slice(0, 200), full: summary, sid, tags: ['agent-session', 'slipway'] });
  await run(driver, `MATCH (i:Insight {id: $iid}) MATCH (s:Source {title: $title}) MERGE (i)-[:DERIVED_FROM]->(s)`,
    { iid, title: entry.sourceTitle });
  const origin = await resolveAgentOrigin(entry);
  if (origin && INSIGHT_ABOUT_TARGETS.has(origin.label)) {
    await run(driver, `MATCH (i:Insight {id: $iid}) MATCH (n) WHERE elementId(n) = $nid MERGE (i)-[:ABOUT]->(n)`,
      { iid, nid: origin.id });
  }
  return { ok: true, available: true, insightId: iid, model: prov.model, text: summary };
}

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
     OR toLower(coalesce(n.former_name, '')) CONTAINS toLower($q)
  WITH n, COUNT { (n)--() } AS degree
  RETURN elementId(n) AS id, ${PRIMARY_LABEL} AS label,
         coalesce(n.name, n.title, n.summary, n.id) AS name,
         n.former_name AS former_name,
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
         n.due_every AS due_every, n.review_every AS review_every,
         n.status AS status, n.jurisdiction AS jurisdiction,
         n.source_kind AS source_kind, n.file_path AS file_path, n.url AS url, n.tags AS tags,
         n { .*, embedding: NULL } AS props,
         size([(s2:Source)-[:INFORMS]->(n) | 1]) AS source_count,
         [(s3:Source)-[:INFORMS]->(n) | { id: elementId(s3), name: coalesce(s3.title, s3.name, s3.id),
            source_kind: s3.source_kind, url: s3.url, file_path: s3.file_path }][0..500] AS all_sources,
         [(nt:Note)-[:ABOUT]->(n) | { id: nt.id, text: nt.text, state: nt.state,
            anchor_kind: nt.anchor_kind, locator: nt.locator, created_at: toString(nt.created_at),
            last_verified_at: toString(nt.last_verified_at), evidence: nt.evidence,
            verifications: nt.verifications }][0..200] AS notes,
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
            dir: CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END }][0..60] AS edges,
         ([(n)-[:ACHIEVED_BY]->(gp:Project)-[:CONTAINS]->(gm:Idea) | { id: elementId(gm), name: coalesce(gm.name, gm.title), status: coalesce(gm.status, ''), valid_until: toString(gm.valid_until) }]
          + [(n)-[:ACHIEVED_BY]->(gp2:Project)<-[:PART_OF]-(gm2:Idea) | { id: elementId(gm2), name: coalesce(gm2.name, gm2.title), status: coalesce(gm2.status, ''), valid_until: toString(gm2.valid_until) }])[0..40] AS goal_milestones,
         [(n)-[:BLOCKED_BY]->(gb) | { id: elementId(gb), name: coalesce(gb.name, gb.title, gb.id),
            label: head([l IN labels(gb) WHERE l <> 'Embeddable'] + labels(gb)) }][0..20] AS goal_blockers`;

// ── Pulse (status board) ────────────────────────────────────────────────────
const Q_GOALS = `
  MATCH (g:Goal)
  OPTIONAL MATCH (g)-[:ACHIEVED_BY|SUPPORTS]-(p:Project)
  WITH g, collect(DISTINCT p.name) AS projects
  RETURN elementId(g) AS id, g.name AS name, g.timeframe AS timeframe, coalesce(g.status,'active') AS status,
         toString(g.target_date) AS target_date,
         left(coalesce(g.description,''), 200) AS desc, projects[0..5] AS projects
  ORDER BY CASE g.timeframe WHEN '30_days' THEN 0 WHEN 'short_term' THEN 1 WHEN '90_days' THEN 2
                            WHEN '1_year' THEN 3 WHEN 'long_term' THEN 5 ELSE 4 END`;
// (Q_PROJECTS / Q_BLOCKED / Q_NEXT removed — the dock's "Now · Next · Blocked" section was
//  retired as redundant with the command bar, which surfaces next/blocked on demand via INTENT_Q.)
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
// generalized lesson from the Engram→Scatterbrained cleanup). Mirrors lint-graph's
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

// Notes awaiting curation (#note loop): a Note is jotted on a node (state 'raw'), a later sync
// pass cues/addresses it. Until now the inspector could WRITE notes but nothing surfaced the
// open ones, so they rotted. Surface raw/cued notes in the dock + resume so the loop closes.
const Q_NOTES_REVIEW = `
  MATCH (nt:Note)-[:ABOUT]->(n)
  WHERE nt.state IN ['raw', 'cued'] AND NOT (nt)-[:PART_OF]->(:Review)
  RETURN nt.id AS id, nt.text AS text, nt.state AS state, toString(nt.created_at) AS created_at,
         coalesce(n.name, n.title, n.summary, n.id) AS anchor_name,
         head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS anchor_label,
         elementId(n) AS anchor_id
  ORDER BY nt.created_at DESC LIMIT 20`;

// Acceptance criteria needing attention (criteria lane, dock): regressed (fail) or
// verified-then-stale. Over-fetches fail+pass rows; the tested staleness math
// (criteria.js shapeCriteriaLane, STALE_DAYS) prunes — one source for the threshold.
const Q_CRITERIA_REVIEW = `
  MATCH (c:Note {anchor_kind: 'criterion'})-[:ABOUT]->(n)
  WHERE c.state IN ['fail', 'pass']
  RETURN c.id AS id, c.text AS text, c.state AS state,
         toString(c.last_verified_at) AS last_verified_at,
         coalesce(n.name, n.title, n.summary, n.id) AS anchor_name,
         head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS anchor_label,
         elementId(n) AS anchor_id
  ORDER BY c.last_verified_at LIMIT 100`;

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
// Goal's target_date — plus any recurrence cadence (due_every/review_every, rank 8). This
// query RAW-SELECTS the intention dates + cadences (a small set — few nodes are scheduled);
// rollDueRows() below does the recurrence rolling + overdue/within-14d window in JS, reusing
// the tested recurrence engine (recurring anchors roll to their next occurrence ≥ today, so
// the "due" lane — and the Daily Brief that counts it — never runs dry after one clear).
const QI_DUE = `
  MATCH (n) WHERE n.valid_until IS NULL
    AND (n.due_at IS NOT NULL OR n.review_at IS NOT NULL OR (n:Goal AND n.target_date IS NOT NULL))
  RETURN elementId(n) AS id, coalesce(n.name,n.title,n.summary) AS name, ${PLABEL} AS label,
         toString(date(n.due_at)) AS due_at, toString(date(n.review_at)) AS review_at,
         toString(CASE WHEN n:Goal THEN date(n.target_date) ELSE null END) AS target_date,
         n.due_every AS due_every, n.review_every AS review_every`;
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

const DAY_MS = 86400000;
const _dayNum = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY_MS);
const todayISO = () => new Date().toISOString().slice(0, 10);

// Roll the raw QI_DUE rows into the "due" lane. Each node's SOONEST effective intention
// date wins: a recurring anchor (due_every/review_every) advances to its next occurrence
// ≥ today; a plain date passes through. Keep overdue-or-within-14d, soonest-first, top 20.
// `sub` stays exactly "overdue · DATE" / "due · DATE" (daybrief.js parses it); the cadence
// rides a separate optional `recur` field the dock renders as a chip.
function rollDueRows(rawRows, today = todayISO()) {
  const HORIZON = 14;
  const scored = [];
  for (const r of rawRows) {
    const parts = [
      { d: effectiveDate(r.due_at, r.due_every, today), recur: r.due_every },
      { d: effectiveDate(r.review_at, r.review_every, today), recur: r.review_every },
      { d: effectiveDate(r.target_date, null, today), recur: null },   // goals don't recur
    ].filter((p) => p.d);
    if (!parts.length) continue;
    parts.sort((a, z) => a.d.localeCompare(z.d));
    const s = parts[0];
    if (_dayNum(s.d) - _dayNum(today) > HORIZON) continue;
    const row = { id: r.id, name: r.name, label: r.label, sub: (s.d < today ? 'overdue · ' : 'due · ') + s.d, _s: s.d };
    if (recurLabel(s.recur)) row.recur = recurLabel(s.recur);
    scored.push(row);
  }
  scored.sort((a, z) => a._s.localeCompare(z._s));
  return scored.slice(0, 20).map(({ _s, ...row }) => row);
}

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
    // 'now/next/blocked' dropped from the dock (the command bar covers next/blocked on demand),
    // so the pulse no longer computes Q_PROJECTS/Q_BLOCKED/Q_NEXT.
    const [goals, due, whatsNew, superseded, lowConf, orphans, aliasDrift, protectedFactsReview, notesReview, criteriaReview] = await Promise.all([
      run(driver, Q_GOALS),
      run(driver, QI_DUE),
      run(driver, Q_WHATSNEW), run(driver, Q_SUPERSEDED), run(driver, Q_LOWCONF), run(driver, Q_ORPHAN_LIST),
      run(driver, Q_ALIAS_DRIFT, { aliasLabels: ALIAS_LABELS, aliasNameFields: ALIAS_NAME_FIELDS, brandRe: brandRegexCypher() }),
      run(driver, Q_PROTECTED_FACT_REVIEW), run(driver, Q_NOTES_REVIEW), run(driver, Q_CRITERIA_REVIEW),
    ]);
    return {
      goals: rows(goals),
      due: rollDueRows(rows(due)),
      whatsNew: rows(whatsNew),
      review: { superseded: rows(superseded), lowConfidence: rows(lowConf), orphans: rows(orphans), aliasDrift: rows(aliasDrift), protectedFacts: rows(protectedFactsReview), notes: rows(notesReview),
        criteria: shapeCriteriaLane(rows(criteriaReview), Date.now()) },
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
  if (pathname === '/api/lens/run') return await runLens(params.id);   // re-run a saved Lens live → { chart, row_count }
  if (pathname === '/api/agent/ping') {
    return { available: await slipwayPing() };   // is the Slipway runtime up? (gates the launch button)
  }
  if (pathname === '/api/agent/plan') {
    // Dry-run: resolve cwd + compose the brief + pick the kind, WITHOUT writing or launching.
    // Powers the launch popover's preview.
    const plan = await buildAgentPlan(String(params.id || ''));
    if (plan.error) return { ok: false, reason: plan.error };
    return { ok: true, cwd: plan.cwd, preset: plan.preset, brief: plan.brief };
  }
  if (pathname === '/api/agent/sessions') {
    // The sessions lane: graph-launched sessions (mapped, capturable) joined with Slipway's
    // history (incl. Slipway-native ones — listed, not capturable). Works with Slipway down:
    // the mapping + on-disk transcripts are exactly the post-mortem capture window.
    const history = await slipwayHistory();
    const map = readAgentSessions();
    const stats = {};
    for (const sid of Object.keys(map)) {
      if (!SID_RE.test(sid)) continue;                        // never stat a poisoned key
      try {
        const fp = realOf(path.join(SLIPWAY_TERM_DIR, sid + '.log'));
        if (!isWithinRoots(fp, SOURCE_ROOTS)) continue;       // same sandbox as every file read
        const st = fs.statSync(fp); stats[sid] = { bytes: st.size, mtimeMs: st.mtimeMs };
      } catch { /* no transcript yet */ }
    }
    return { available: history !== null, sessions: sessionsView(map, history, stats) };
  }
  if (pathname === '/api/ai/ping') {
    // Voice-lane truth: only a RESIDENT model counts (see resolveProviderDetailed) — the
    // orb must never wear a model name that isn't actually in memory.
    const { provider: prov, reason, slipway } = await resolveProviderDetailed({ requireResident: true });
    return prov
      ? { available: true, provider: prov.label, model: prov.model, models: prov.models, host: prov.base }
      : { available: false, models: [], reason, selected: (slipway && slipway.model) || null };
  }
  if (pathname === '/api/docs') {
    // The Docs lens. No params → projects with ingested doc Sources (markdown/text with
    // a file_path, current only). ?project= → that project's classified doc tree
    // (docsite.js taxonomy — built entirely from what the document lane already recorded;
    // no re-ingestion). Each doc carries `readable` (inside the granted read roots) so a
    // blocked doc shows the grant on-ramp instead of a dead-end click.
    if (!params.project) {
      const recs = await run(driver, `
        MATCH (s:Source)-[:INFORMS]->(p:Project)
        WHERE s.source_kind IN ['markdown', 'text'] AND s.file_path IS NOT NULL
          AND s.valid_until IS NULL
        RETURN p.name AS name, count(DISTINCT s) AS doc_count ORDER BY doc_count DESC`);
      return { projects: recs.map((r) => toPlain(r.toObject())) };
    }
    const recs = await run(driver, `
      MATCH (s:Source)-[:INFORMS]->(p:Project {name: $project})
      WHERE s.source_kind IN ['markdown', 'text'] AND s.file_path IS NOT NULL
        AND s.valid_until IS NULL
      RETURN DISTINCT elementId(s) AS id, s.title AS title, s.display_title AS display_title,
             s.file_path AS file_path, s.source_kind AS source_kind`,
    { project: String(params.project) });
    const docs = recs.map((r) => toPlain(r.toObject())).map((d) => {
      let readable = false;
      try { readable = isWithinRoots(realOf(absSrc(d.file_path)), SOURCE_ROOTS); } catch { readable = false; }
      return { ...d, readable };
    });
    return { project: String(params.project), tree: buildDocTree(docs), doc_count: docs.length };
  }
  if (pathname === '/api/diagram/ping') {
    // The local PlantUML lane (brew install plantuml). Rendering is ALWAYS local —
    // diagram text never leaves the machine (no plantuml.com fallback, by design).
    const st = await pumlAvailable({ refresh: params.refresh === '1' });
    return st.ok ? { available: true, version: st.version } : { available: false };
  }
  if (pathname === '/api/diagram/from-graph') {
    // "Explain this cluster as a diagram": walk the node's neighborhood (depth 1|2,
    // annotation labels skipped) → PlantUML (graph-puml.js) → local render.
    const id = String(params.id || '');
    const kind = params.kind === 'component' ? 'component' : 'mindmap';
    const depth = params.depth === '2' ? 2 : 1;
    const recs = await run(driver, `
      MATCH (n) WHERE elementId(n) = $id
      OPTIONAL MATCH (n)-[r]-(m)
      WHERE none(l IN labels(m) WHERE l IN ['Note', 'ProtectedFact', 'Review'])
      WITH n, collect({ id: elementId(m), name: coalesce(m.name, m.title, m.summary, m.id),
                        label: head([l IN labels(m) WHERE l <> 'Embeddable'] + labels(m)),
                        relType: type(r),
                        dir: CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END })[0..60] AS d1
      RETURN elementId(n) AS id, coalesce(n.name, n.title, n.summary, n.id) AS name,
             head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS label, d1`,
    { id });
    const row = recs[0] ? toPlain(recs[0].toObject()) : null;
    if (!row) return { error: 'node not found' };
    let neighbors = (row.d1 || []).filter((x) => x.id);
    if (depth === 2 && neighbors.length) {
      const recs2 = await run(driver, `
        MATCH (m) WHERE elementId(m) IN $ids
        MATCH (m)-[r2]-(k)
        WHERE elementId(k) <> $id AND NOT elementId(k) IN $ids
          AND none(l IN labels(k) WHERE l IN ['Note', 'ProtectedFact', 'Review'])
        RETURN elementId(m) AS parentId, elementId(k) AS id,
               coalesce(k.name, k.title, k.summary, k.id) AS name,
               head([l IN labels(k) WHERE l <> 'Embeddable'] + labels(k)) AS label,
               type(r2) AS relType,
               CASE WHEN startNode(r2) = m THEN 'out' ELSE 'in' END AS dir
        LIMIT 40`,
      { ids: neighbors.map((x) => x.id), id });
      neighbors = neighbors.concat(recs2.map((r) => ({ ...toPlain(r.toObject()), depth: 2 })));
    }
    const puml = toPlantuml({ focus: { id: row.id, name: row.name, label: row.label }, neighbors }, { kind });
    const st = await pumlAvailable();
    if (!st.ok) return { puml, error: 'PlantUML is not installed (brew install plantuml)', unavailable: true };
    const rendered = await pumlRender(puml, { postProcess: prepareSvg });
    return rendered.svg
      ? { puml, svg: rendered.svg, node_count: neighbors.length + 1, edge_count: neighbors.length }
      : { puml, ...rendered };
  }
  if (pathname === '/api/slipway/models') {
    // What could the voice panel load? (local backends only — see slipwayModels)
    const models = await slipwayModels();
    return models ? { available: true, models } : { available: false, models: [] };
  }
  if (pathname === '/api/voice/status') {
    // The panel's brain picture: the MCP agent (if connected) + the connect command.
    return { agent: voiceSession.status(), mcp: { url: `http://127.0.0.1:${PORT}/mcp`, token_path: MCP_TOKEN_PATH } };
  }
  if (pathname === '/api/digest') {
    // The bucketed intention clock — the agenda panel + local-mode chips read this.
    return voiceDigest(params.project ? String(params.project) : null);
  }
  if (pathname === '/api/voice/tts/ping') {
    // The local-TTS lane (Kokoro-82M): available → the browser prefers it over Web Speech.
    return { available: ttsAvailable(), voices: TTS_VOICES, default: TTS_DEFAULT };
  }
  if (pathname === '/api/voice/stt/ping') {
    // The on-device recognition lane (mlx-whisper): available → the browser records WAV
    // and transcribes here instead of shipping audio to Google/Apple.
    return { available: sttLocalAvailable(), models: sttInstalledModels(), default: STT_DEFAULT };
  }
  if (pathname === '/api/ai/diagram') {
    // "Diagram this": local model → PlantUML → VALIDATE BY RENDERING → one retry with
    // the render error fed back → honest structured failure (never a spinner). The
    // response carries `attempts` so criterion #4 (≤2 attempts) is directly observable.
    const prov = await resolveProvider();
    if (!prov) return { available: false };
    const st = await pumlAvailable();
    if (!st.ok) return { available: false, error: 'PlantUML is not installed' };
    const node = rows(await run(driver, Q_NODE, { id: String(params.id || '') }))[0];
    if (!node) return { available: true, error: 'node not found' };
    const kind = ['mindmap', 'component', 'sequence'].includes(params.kind) ? params.kind : 'mindmap';
    const result = await aiDiagramLane(prov, nodeText(node), kind, {
      generateImpl: generate,
      renderImpl: (puml) => pumlRender(puml, { postProcess: prepareSvg }),
    });
    return { available: true, model: prov.model, ...result };
  }
  if (pathname === '/api/ai/summary' || pathname === '/api/ai/ask') {
    const prov = await resolveProvider();
    if (!prov) return { available: false };
    // An explicit ?model= is honored only on Ollama (multi-model host); MLX serves one model.
    if (params.model && prov.kind === 'ollama' && prov.models.includes(params.model)) prov.model = params.model;
    const node = rows(await run(driver, Q_NODE, { id: String(params.id || '') }))[0];
    if (!node) return { available: true, error: 'node not found' };
    const ctx = nodeText(node);
    const prompt = pathname === '/api/ai/ask'
      ? `Using ONLY the context below, answer the question concisely. If the context doesn't cover it, say so.\n\nContext:\n${ctx}\n\nQuestion: ${String(params.q || '').slice(0, 400)}\n\nAnswer:`
      : `Summarize the following knowledge-graph node in 2-3 sentences, grounded only in this text. Be concrete.\n\n${ctx}\n\nSummary:`;
    const out = await generate(prov, prompt, { timeoutMs: 60000 });
    return out == null ? { available: true, error: 'generation failed' } : { available: true, model: prov.model, text: out.trim() };
  }
  if (pathname === '/api/intent') {
    const q = INTENT_Q[String(params.kind || '')];
    if (!q) return { results: [] };
    const raw = rows(await run(driver, q));
    // the 'due' lane shares QI_DUE's raw shape → roll recurrence the same way the pulse does
    return { kind: params.kind, results: params.kind === 'due' ? rollDueRows(raw) : raw };
  }
  if (pathname === '/api/source') {
    // The "See" layer: read a node's primary file, sandboxed to the allowlist. Returns
    // { source: null } when there is no file, or a typed payload otherwise.
    const node = rows(await run(driver, Q_NODE, { id: String(params.id || '') }))[0];
    if (!node) return { source: null };
    const primary = pickPrimarySource(node, node.edges || [], (p) => isWithinRoots(realOf(absSrc(p)), SOURCE_ROOTS));
    if (!primary) return { source: null };
    const fp = realOf(absSrc(primary.filePath));
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
    const fp = realOf(absSrc(params.path));
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
    if (!TEXT_KINDS.has(kind)) {
      // Not a document-lane kind (md/csv/pdf/office), but source code / config / other text is
      // still readable — return it as text with its `lang` so the client syntax-highlights it the
      // same way the review tab does. Only true binaries (image/font/media) stay unsupported.
      const lang = langOf(fp);
      if (['image', 'font', 'media'].includes(lang)) return { file: { ...base, unsupported: true } };
      try {
        if (fs.statSync(fp).size > SOURCE_MAX_BYTES) return { file: { ...base, tooLarge: true } };
        const text = fs.readFileSync(fp, 'utf8');
        return { file: { ...base, kind: lang, lang, text, lines: text.split('\n').length, notes: await fileNotes(fp) } };
      } catch (err) { return { file: { ...base, error: String(err.message || err) } }; }
    }
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
  if (pathname === '/api/file/history') return fileHistory(realOf(absSrc(params.path)));
  if (pathname === '/api/file/version') return fileVersion(realOf(absSrc(params.path)), String(params.rev || ''));
  if (pathname === '/api/file/stat') {
    // Cheap liveness probe for the editor: has the file changed on disk under you?
    const fp = realOf(absSrc(params.path));
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
  if (pathname === '/api/criteria') return await projectCriteria(params.project);
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
    const graph = buildModuleGraph(files);
    const { nodes, links } = graph;
    const byRel = Object.fromEntries(files.map((f) => [f.rel, f.path]));
    nodes.forEach((n) => { n.path = byRel[n.rel]; });   // absolute path so clicking loads the file
    // The ranked view (Code lens) reads `insights`; Review still reads `nodes` — keep both.
    // Attach the absolute path to each ranked file so a list click can open it.
    const ins = repoInsights(graph);
    const withPath = (e) => ({ ...e, path: byRel[e.file] });
    const insights = {
      languages: ins.languages,
      hubs: ins.hubs.map(withPath),
      unreferenced: ins.unreferenced.map(withPath),
      cycles: ins.cycles.map((c) => c.map((file) => ({ file, path: byRel[file] }))),
    };
    return { repo: { name: dir.split('/').pop() || dir, path: dir, nodes, links, fileCount: nodes.length, edgeCount: links.length, truncated, insights } };
  }
  if (pathname === '/api/repo/callsites') {
    // "Which FUNCTIONS call this file" — for a target rel `file`, read each importer and extract
    // the call sites of the symbols it binds from the target (symbols.js). Same sandbox as /api/repo.
    const dir = String(params.repo || '');
    const file = String(params.file || '');
    if (!dir || !isWithinRoots(dir, SOURCE_ROOTS)) return { callers: [], blocked: true };
    const { files } = walkRepo(dir);
    const relSet = new Set(files.map((f) => f.rel));
    if (!relSet.has(file)) return { callers: [] };
    const callers = [];
    for (const f of files) {
      if (f.rel === file || !f.text) continue;
      const lang = langOf(f.rel);
      if (!(lang === 'js' || lang === 'ts' || lang === 'vue' || lang === 'svelte')) continue;
      const binds = parseImportBindings(f.text).filter((b) => resolveImport(f.rel, b.specifier, relSet) === file);
      if (!binds.length) continue;
      const names = [...new Set(binds.flatMap((b) => b.names))];
      const sites = names.length ? callSites(f.text, names, new Set(binds.map((b) => b.line))) : [];
      callers.push({ file: f.rel, path: f.path, symbols: names, sites });
    }
    callers.sort((a, b) => a.file.localeCompare(b.file));
    return { callers };
  }
  return null;
}

// ── Notes (deferred-instruction inbox; ROADMAP #15) ─────────────────────────
// Any node can carry freeform Notes; a later sync pass evaluates them (raw →
// cued → addressed/skipped). Local-first write endpoint, mirrors /api/roots.
// The cycle set comes from the shared vocab (docnotes.js). Criterion states
// (unverified/pass/fail) are deliberately NOT settable here — see verifyCriterion.
const NOTE_STATES = new Set(NOTE_CYCLE_STATES);
// VOICE Phase 1 — the built-in local chat lane. One turn in ({q, node_id?, history?, model?}),
// grounded spoken-style reply out. Context is SERVER-INJECTED (digest + selected node), not
// tool-called — the honest capability split: the MCP lane (Phase 3) gets real tools; this
// lane gets reports. History arrives flattened from the browser (voice-thread's msg shape).
let lastLocalModel = null;   // one resident chat model: switching unloads the old KV cache
async function voiceChat({ q, node_id, history, model } = {}) {
  const utterance = String(q || '').trim().slice(0, 2000);
  if (!utterance) return { error: 'q required' };
  // requireResident: a voice turn must answer in seconds — never trigger a cold multi-GB
  // Ollama load mid-conversation. An explicit ?model= pick below is the user opting in.
  const { provider: prov, reason, slipway } = await resolveProviderDetailed({ requireResident: !model });
  // No provider: tell the panel WHY — 'no-slipway' (runtime down) vs 'no-model' (runtime up,
  // nothing loaded; models are never loaded by default). selected = the model Slipway would
  // load, so the empty state can offer one-click "Load <model>".
  if (!prov) return { available: false, reason, selected: (slipway && slipway.model) || null };
  if (model && prov.kind === 'ollama' && prov.models.includes(model)) prov.model = model;
  if (prov.kind === 'ollama' && lastLocalModel && lastLocalModel !== prov.model) {
    unloadModel(prov, lastLocalModel).catch(() => {});   // fire-and-forget; never blocks the turn
  }
  if (prov.kind === 'ollama') lastLocalModel = prov.model;
  let digest = '';
  try { digest = digestBlock(await fetchDigestRows(driver)); } catch { /* agenda-less reply beats no reply */ }
  // Recall is INJECTED in the local lane (it has no tools): the newest captured
  // Insights answer "what did we do recently", and a keyword pass over the utterance
  // pulls matching nodes with a bite of their text — the stand-in for search_nodes.
  let recent = '';
  try { recent = recentBlock(rows(await run(driver, Q_WHATSNEW))); } catch { /* optional */ }
  // Live aggregate counts — "how many active projects?" is answerable without tools.
  let overview = '';
  try {
    overview = overviewBlock(rows(await run(driver,
      `CALL { MATCH (p:Project) WHERE p.valid_until IS NULL RETURN 'project:' + coalesce(p.status, 'unset') AS k
        UNION ALL MATCH (g:Goal) WHERE g.valid_until IS NULL RETURN 'goal:' + coalesce(g.status, 'unset') AS k
        UNION ALL MATCH (i:Idea) WHERE i.valid_until IS NULL RETURN 'idea:' + coalesce(i.status, 'unset') AS k }
       RETURN k, count(*) AS c ORDER BY k`)));
  } catch { /* optional */ }
  let findings = '';
  try {
    const q = utterance.replace(/[^\w\s'-]/g, ' ').trim().slice(0, 120);
    if (q.length > 3) {
      const hits = rows(await run(driver, Q_SEARCH, { q })).slice(0, 3);
      if (hits.length) {
        const withText = rows(await run(driver,
          `UNWIND $ids AS id MATCH (n) WHERE elementId(n) = id
           RETURN coalesce(n.name, n.title, n.summary) AS name,
                  head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS label,
                  left(coalesce(n.description, n.summary, n.full_text, ''), 400) AS text`,
          { ids: hits.map((h) => h.id) }));
        findings = findingsBlock(withText);
      }
    }
  } catch { /* retrieval is a bonus, never a blocker */ }
  let node = null;
  if (node_id) {
    const n = rows(await run(driver, Q_NODE, { id: String(node_id) }))[0];
    if (n) node = nodeText(n);
  }
  const turns = Array.isArray(history)
    ? history.slice(-8).map((m) => ({ role: m && m.role === 'assistant' ? 'assistant' : 'you', text: String((m && m.text) || '').slice(0, 1000) }))
    : [];
  const prompt = buildLocalSystemPrompt({ digest, overview, recent, findings, node, history: turns, utterance });
  const out = await generate(prov, prompt, { timeoutMs: 60000, maxTokens: 256 });
  if (out == null) return { available: true, error: 'generation failed' };
  return { available: true, provider: prov.label, model: prov.model, text: out.trim() };
}

// ── VOICE Phase 3: the MCP lane ──────────────────────────────────────────────────────
// The Studio is the "phone"; a connected MCP agent (the user's own Claude Code session,
// subscription-billed — no `claude -p` spawns, no API keys) is the brain. The endpoint
// lives in-process because the listen loop's pending promises must be shared with the
// browser's /api/voice/* calls.

// Bearer token for /mcp — generated once, 0600, shown in Settings with the connect command.
const MCP_TOKEN_PATH = path.join(os.homedir(), '.scatterbrained', 'mcp-token');
function loadMcpToken() {
  try { const t = fs.readFileSync(MCP_TOKEN_PATH, 'utf8').trim(); if (t) return t; } catch { /* first run */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(MCP_TOKEN_PATH), { recursive: true });
  fs.writeFileSync(MCP_TOKEN_PATH, t + '\n', { mode: 0o600 });
  return t;
}
const MCP_TOKEN = loadMcpToken();
const mcpTokenOk = (header) => {
  const got = Buffer.from(String(header || ''));
  const want = Buffer.from(`Bearer ${MCP_TOKEN}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
};

const voiceSession = createVoiceSession({ onEvent: (name, data) => broadcast('voice-' + name, data) });
// Staleness watchdog: an agent that stopped polling (no parked listen, quiet >60s) gets
// its badge dimmed — the honest v1 answer to "nothing forces the agent to keep listening".
let voiceWasStale = false;
setInterval(() => {
  const s = voiceSession.status();
  const nowStale = !!(s.connected && s.stale);
  if (nowStale && !voiceWasStale) broadcast('voice-agent', { state: 'stale', model: s.model });
  voiceWasStale = nowStale;
}, 15000).unref();

// MCP transport sessions (issued at initialize) → the voice session bound by voice_connect.
// A superseded agent keeps its transport session; its stale voice sessionId makes
// voice_listen/voice_say answer {kind:'superseded'}/{error} — the honest goodbye.
const mcpSessions = new Map();
function newMcpSession() {
  const id = crypto.randomUUID();
  mcpSessions.set(id, { voiceSid: null });
  if (mcpSessions.size > 50) mcpSessions.delete(mcpSessions.keys().next().value);
  return id;
}
const voiceSidOf = (ctx) => (mcpSessions.get(ctx.sessionId) || {}).voiceSid;

// VOICE Phase 6: explicit save-to-graph. The transcript lands on disk, the graph gets a
// voice_session Source (metadata only) + INFORMS edges to the session's touched nodes —
// the same posture and shape-gating as agentCapture above. Never automatic.
const VOICE_SESSIONS_DIR = path.join(os.homedir(), '.scatterbrained', 'voice-sessions');
async function voiceCapture({ transcript, model } = {}) {
  const text = String(transcript || '').trim();
  if (!text) return { error: 'transcript required — nothing to save' };
  const status = voiceSession.status();
  const modelName = String((status.connected && status.model) || model || 'assistant').slice(0, 120);
  const sid = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
  fs.mkdirSync(VOICE_SESSIONS_DIR, { recursive: true });
  const fp = path.join(VOICE_SESSIONS_DIR, sid + '.md');
  const header = `# Voice session — ${modelName} — ${sid.slice(0, 10)}\n\n`;
  fs.writeFileSync(fp, header + text + '\n');
  const title = 'voice-session/' + sid;
  await run(driver,
    `MERGE (s:Source {title: $title})
     SET s.created_at = coalesce(s.created_at, datetime()),
         s.source_kind = 'voice_session', s.type = 'voice_session',
         s.file_path = $fp, s.display_title = $dt, s.model = $model,
         s.captured_at = datetime(), s.last_synced_at = datetime(),
         s.content_hash = $hash, s.transcript_bytes = $bytes, s.tags = $tags
     RETURN elementId(s) AS id`,
    { title, fp, dt: `Voice session — ${modelName} (${sid.slice(0, 10)})`, model: modelName, hash: hashText(text), bytes: text.length, tags: ['voice-session'] });
  // INFORMS to touched nodes, shape-gated exactly like agentCapture; labels missing on
  // tool-side touches (capture_note/schedule pass only ids) resolve here.
  let informs = 0;
  for (const t of voiceSession.touchedNodes()) {
    let label = t.label;
    if (!label) {
      const o = rows(await run(driver, Q_AGENT_ORIGIN_BY_ID, { id: t.id }))[0];
      if (!o) continue;
      label = o.label;
    }
    if (!INFORMS_TARGETS.has(label)) continue;
    await run(driver, Q_AGENT_INFORMS, { title, nid: t.id });
    informs++;
  }
  return { ok: true, title, file_path: fp, informs };
}

// Bucketed intention-clock digest — one implementation, two consumers: the get_briefing
// tool and GET /api/digest (the agenda panel + local-mode chips).
async function voiceDigest(project = null) {
  const rowsD = await fetchDigestRows(driver, { project });
  const buckets = { overdue: [], today: [], this_week: [], upcoming: [] };
  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  for (const r of rowsD) {
    const item = { name: r.name, label: r.label, kind: r.kind, date: r.date, projects: r.projects, id: r.id };
    (r.date < today ? buckets.overdue : r.date === today ? buckets.today : r.date <= weekEnd ? buckets.this_week : buckets.upcoming).push(item);
  }
  return { now: today, due: buckets };
}

// Shared read-only Cypher runner (query_graph tool + show_panel kind:viz + a Lens's live re-run).
// A READ session + executeRead makes Neo4j reject any write clause server-side; 50-row cap, 10s
// timeout. Returns { rows, truncated } or { error } (message capped for a spoken/echoed context).
async function runReadCypher(cypher, params) {
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const res = await session.executeRead((tx) => tx.run(String(cypher).slice(0, 2000), params || {}), { timeout: 10000 });
    return { rows: res.records.slice(0, 50).map((r) => toPlain(r.toObject())), truncated: res.records.length > 50 };
  } catch (e) {
    return { error: String((e && e.message) || 'query failed').slice(0, 300) };
  } finally {
    await session.close();
  }
}

// Save a live LENS (Studio saved-query view): a stored read-only Cypher + chart spec, never the
// data. Keyed on a UUID (l.id); may attach ABOUT the node it concerns. Re-run live via runLens.
async function saveLens({ name, cypher, spec, about_node_id, author } = {}) {
  const nm = String(name || '').trim().slice(0, 200);
  const cy = String(cypher || '').trim().slice(0, 2000);
  if (!nm || !cy) return { error: 'name and cypher are required' };
  const v = validateChartSpec(spec || {});
  if (v.error) return { error: v.error.message };
  const a = (String(author || 'you').trim() || 'you').slice(0, 80);
  const recs = await run(driver, `
    CREATE (l:Lens {id: randomUUID()})
    SET l.name = $name, l.cypher = $cypher, l.spec_json = $spec_json,
        l.created_by = $author, l.created_at = datetime(), l.tags = ['scatterbrained', 'lens']
    WITH l
    OPTIONAL MATCH (t) WHERE $about IS NOT NULL AND elementId(t) = $about
    FOREACH (_ IN CASE WHEN t IS NOT NULL THEN [1] ELSE [] END | MERGE (l)-[:ABOUT]->(t))
    RETURN l.id AS id, l.name AS name`,
  { name: nm, cypher: cy, spec_json: JSON.stringify(v.spec), author: a, about: about_node_id ? String(about_node_id) : null });
  return { lens: toPlain(recs[0].toObject()) };
}

// Run a saved Lens live: re-execute its stored Cypher and build the chart from the FRESH rows (the
// point of a live lens — it reflects current graph state). The stored spec provides the human title
// and is the fallback when the fresh rows can't be auto-charted. A query error renders an honest strip.
async function runLens(id) {
  const recs = await run(driver, 'MATCH (l:Lens) WHERE elementId(l) = $id RETURN l.name AS name, l.cypher AS cypher, l.spec_json AS spec_json', { id: String(id || '') });
  const lens = recs[0] ? toPlain(recs[0].toObject()) : null;
  if (!lens) return { error: 'lens not found' };
  const r = await runReadCypher(lens.cypher, {});
  if (r.error) return { chart: { error: r.error, title: lens.name }, row_count: 0 };
  let stored = null; try { stored = lens.spec_json ? JSON.parse(lens.spec_json) : null; } catch { stored = null; }
  let chart = recommendChartFromObjects(r.rows);
  if (chart && stored && stored.title) chart.title = stored.title;
  if (!chart) chart = stored || { error: 'the query returned no chartable rows', title: lens.name };
  return { chart, row_count: r.rows.length, truncated: r.truncated };
}

// Deterministic graph-statistic facets — fixed read-only Cyphers, each returning ALREADY
// chart-shaped rows ([{label, value}]) so the agent pipes them straight into show_panel kind:viz
// (or just narrates). The model picks a facet name; it never writes the Cypher.
const STAT_FACETS = {
  labels: 'MATCH (n) WITH labels(n)[0] AS label, count(*) AS c WHERE label IS NOT NULL RETURN label, c AS value ORDER BY value DESC LIMIT 20',
  growth: "MATCH (n) WHERE n.created_at IS NOT NULL AND n.created_at >= datetime() - duration('P84D') WITH date.truncate('week', date(n.created_at)) AS wk, count(*) AS c RETURN toString(wk) AS label, c AS value ORDER BY label",
  stale: 'MATCH (n) WITH sum(CASE WHEN n.valid_until IS NOT NULL THEN 1 ELSE 0 END) AS stale, count(*) AS total UNWIND [{l: "current", v: total - stale}, {l: "superseded", v: stale}] AS r RETURN r.l AS label, r.v AS value',
  hubs: 'MATCH (n) WITH n, COUNT { (n)--() } AS deg ORDER BY deg DESC LIMIT 10 RETURN coalesce(n.name, n.title, n.summary, "(unnamed)") AS label, deg AS value',
  tags: 'MATCH (n) UNWIND coalesce(n.tags, []) AS t WITH t AS label, count(*) AS c RETURN label, c AS value ORDER BY value DESC LIMIT 12',
};
async function graphStats(facet) {
  const oneFacet = async (q) => {
    const r = await runReadCypher(q, {});
    return r.error ? [] : r.rows.map((x) => ({ label: String(x.label), value: Number(x.value) })).filter((x) => Number.isFinite(x.value));
  };
  if (facet && STAT_FACETS[facet]) return { facet, rows: await oneFacet(STAT_FACETS[facet]) };
  const stats = {};
  for (const k of Object.keys(STAT_FACETS)) stats[k] = await oneFacet(STAT_FACETS[k]);
  return { stats };
}

const VOICE_LOOP_PROTOCOL =
  'You are connected to Scatterbrained Studio\'s voice loop. The Studio is the phone; you are the brain. ' +
  'FIRST call voice_connect({model: "<your exact model id>"}). Then LOOP: voice_listen() → think (use tools) → voice_say({text}) → voice_listen() again. ' +
  'voice_listen returning {kind:"timeout"} means the user hasn\'t spoken yet — call voice_listen AGAIN immediately; this re-poll IS the heartbeat, never stop polling. ' +
  `BUDGET DISCIPLINE: after two consecutive timeouts, pass timeout_s: ${LISTEN_IDLE_S} on every further listen (long, cache-warm waits are far cheaper than rapid re-polls); drop back to the default the moment an utterance arrives. ` +
  '{kind:"superseded"} means another brain took over — stop gracefully. ' +
  'A voice_say result of {interrupted:true, spoken_chars:N} means the user cut you off after N characters — your next voice_listen returns what they said instead; be brief and responsive to it. ' +
  'Spoken replies must be SHORT (under ~3 sentences, no markdown — they are read aloud).';

const MCP_TOOLS = [
  {
    name: 'voice_connect',
    description: 'Join the Studio voice loop as the active assistant brain. Self-report your exact model id — it becomes the on-screen badge and picks your voice. Call this once, first.',
    inputSchema: { type: 'object', properties: { model: { type: 'string', description: 'your exact model id, e.g. claude-fable-5' }, persona_name: { type: 'string', description: 'optional display name' } }, required: ['model'] },
    handler: async (args, ctx) => {
      const m = mcpSessions.get(ctx.sessionId);
      if (!m) return { isError: true, error: 'no transport session' };
      const { sessionId, superseded } = voiceSession.connect(args);
      m.voiceSid = sessionId;
      return { ok: true, session: 'connected', superseded_previous: superseded, persona_brief: PERSONA_BRIEF, hint: 'now loop: voice_listen → think → voice_say → voice_listen' };
    },
  },
  {
    name: 'voice_listen',
    description: `Wait for the user's next utterance (spoken or typed). Long-polls up to timeout_s (default ${LISTEN_DEFAULT_S}, max ${LISTEN_MAX_S}); {kind:"timeout"} → call voice_listen again immediately (the re-poll is the heartbeat). After two consecutive timeouts, pass timeout_s: ${LISTEN_IDLE_S} — long waits are cache-warm and cheap, rapid idle polling burns your budget. The result carries ui context (the node the user is looking at) and interrupted:true when it barged in on your last voice_say.`,
    inputSchema: { type: 'object', properties: { timeout_s: { type: 'number' } }, required: [] },
    handler: (args, ctx) => voiceSession.listen(voiceSidOf(ctx), { timeoutS: args.timeout_s }),
  },
  {
    name: 'voice_say',
    description: 'Speak to the user (rendered in the thread + read aloud). BLOCKS until spoken: {spoken:true} = fully heard; {interrupted:true, spoken_chars:N} = user barged in after N chars (listen for what they said next); {spoken:false, reason} = rendered as text only (muted / no TTS). Keep it under ~3 sentences.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handler: (args, ctx) => voiceSession.say(voiceSidOf(ctx), { text: args.text }),
  },
  {
    name: 'voice_disconnect',
    description: 'Leave the voice loop gracefully (the user said goodbye or you are done). The Studio reverts to its local brain.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    handler: (args, ctx) => voiceSession.disconnect(voiceSidOf(ctx)),
  },
  // ── Phase 4: the project toolset — reports + narrow actions, nothing speculative ──
  {
    name: 'get_briefing',
    description: 'The project pulse: what is overdue / due today / due this week / upcoming (30-day intention clock), review-queue counts (superseded, orphans), and what is new. Ground every spoken agenda claim in this.',
    inputSchema: { type: 'object', properties: { project: { type: 'string', description: 'optional project-name filter' } }, required: [] },
    handler: async (args) => {
      const digest = await voiceDigest(args.project || null);
      const [sup, orph, wnew] = await Promise.all([run(driver, Q_SUPERSEDED), run(driver, Q_ORPHAN_LIST), run(driver, Q_WHATSNEW)]);
      return {
        ...digest,
        review: { superseded_count: rows(sup).length, orphan_count: rows(orph).length },
        whats_new: rows(wnew).slice(0, 8).map((n) => ({ name: n.name, label: n.label, created_at: n.created_at })),
      };
    },
  },
  {
    name: 'search_nodes',
    description: 'Find nodes in the knowledge graph by keyword (names, descriptions, former names). Your entry point — get a node id here before get_node / capture_note / schedule / navigate_studio.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    handler: async (args) => {
      const q = String(args.q || '').trim().slice(0, 200);
      if (!q) return { results: [] };
      return { results: rows(await run(driver, Q_SEARCH, { q })).map((r) => ({ id: r.id, name: r.name, label: r.label, superseded: r.superseded })) };
    },
  },
  {
    name: 'get_node',
    description: 'Read one node deeply: text, status, dates, tags, and its relationships. Use the id from search_nodes.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    handler: async (args, ctx) => {
      const node = rows(await run(driver, Q_NODE, { id: String(args.id) }))[0];
      if (!node) return { isError: true, code: 'node_not_found', message: 'no node with that id' };
      voiceSession.touch(node.id, { name: node.name, label: node.label });
      return {
        node: {
          id: node.id, name: node.name, label: node.label, desc: node.desc, status: node.status,
          tags: node.tags, created_at: node.created_at, due_at: node.due_at, review_at: node.review_at,
          target_date: node.target_date, superseded: !!node.valid_until,
          edges: (node.edges || []).slice(0, 40).map((e) => ({ type: e.type, dir: e.dir, name: e.name, label: e.label, id: e.id })),
        },
      };
    },
  },
  {
    name: 'capture_note',
    description: 'Attach a note to a node (id from search_nodes) — where long content belongs instead of speech. Notes land in the user\'s review inbox attributed to you.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'node id' }, text: { type: 'string' } }, required: ['target', 'text'] },
    handler: async (args, ctx) => {
      const model = (voiceSession.status().model || 'agent').slice(0, 80);
      const result = await addNote({ target: String(args.target), text: String(args.text).slice(0, 4000), author: 'agent:' + model });
      if (result.error) return { isError: true, code: 'bad_target', message: result.error };
      voiceSession.touch(String(args.target));
      broadcast('graph-changed');
      return { ok: true, note_id: result.note.id };
    },
  },
  {
    name: 'schedule',
    description: 'Set (or clear, with an empty date) a due_at or review_at intention date on a node, optionally recurring. Confirm with the user by voice BEFORE scheduling.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, kind: { enum: ['due_at', 'review_at'] }, date: { type: 'string', description: 'YYYY-MM-DD, empty to clear' }, every: { enum: ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] } }, required: ['id', 'kind'] },
    handler: async (args) => {
      const result = await setSchedule({ id: args.id, kind: args.kind, when: args.date || '', every: args.every || '' });
      if (result.error) return { isError: true, code: 'bad_schedule', message: result.error };
      voiceSession.touch(String(args.id));
      broadcast('graph-changed');
      return { ok: true, ...result };
    },
  },
  {
    name: 'show_panel',
    description: 'Render a rich card inline in the conversation while you speak — show while you tell. kind:"agenda" (what\'s due, optional project filter), kind:"node" (a node id from search_nodes, optional components subset), kind:"search" (result list for q), kind:"viz" (a CHART of graph data — pass a read-only cypher to run live, OR rows you already have from query_graph/get_graph_stats; an optional spec {kind:bar|histogram|line|scatter,…} styles it, else a sensible default is chosen). Errors echo the allowed values.',
    inputSchema: { type: 'object', properties: { kind: { enum: ['agenda', 'node', 'search', 'viz'] }, title: { type: 'string' }, node_id: { type: 'string' }, components: { type: 'array', description: 'optional subset of the voice-panel component set' }, q: { type: 'string' }, project: { type: 'string' }, cypher: { type: 'string', description: 'viz: a read-only Cypher to run for the chart data' }, rows: { type: 'array', description: 'viz: result objects to chart (instead of cypher)' }, params: { type: 'object', description: 'viz: parameters for the cypher' }, spec: { type: 'object', description: 'viz: an explicit chart spec; omit to auto-pick' } }, required: ['kind'] },
    handler: async (args) => {
      const v = validatePanel(args);
      if (v.error) return { isError: true, ...v.error };
      if (v.spec.kind === 'node') {
        const node = rows(await run(driver, Q_NODE, { id: v.spec.node_id }))[0];
        if (!node) return { isError: true, code: 'node_not_found', message: 'no node with that id' };
        voiceSession.touch(node.id, { name: node.name, label: node.label });
        v.spec.node_name = node.name;                  // the card header shows it without a refetch
      } else if (v.spec.kind === 'viz') {
        // Resolve to a rendered chart spec: run the cypher live, or use the given rows; then the
        // explicit spec if provided, else a deterministic default. The card gets a ready chart —
        // the cypher rides along so "save that" needs nothing re-sent.
        let dataRows = v.spec.rows || [];
        let truncated = false;
        if (v.spec.cypher) {
          const r = await runReadCypher(v.spec.cypher, v.spec.params);
          if (r.error) return { isError: true, code: 'cypher_error', message: r.error };
          dataRows = r.rows; truncated = r.truncated;
        }
        const chart = v.spec.spec || recommendChartFromObjects(dataRows);
        if (!chart) return { isError: true, code: 'not_chartable', message: 'these rows have no numeric/categorical column to chart — give a spec or different rows' };
        v.spec = { kind: 'viz', title: v.spec.title, chart, cypher: v.spec.cypher || null, row_count: dataRows.length, truncated };
      }
      const panel_id = crypto.randomUUID();
      broadcast('voice-panel', { panel_id, spec: v.spec });
      return { ok: true, panel_id };
    },
  },
  {
    name: 'query_graph',
    description: 'Run a READ-ONLY Cypher query for aggregate/analytical questions search_nodes cannot answer — counts, groupings, status breakdowns (e.g. "how many active projects"). Writes are rejected by the database itself. Results cap at 50 rows. Labels: Person, Organization, Project, Idea, Rule, Resource, Source, Insight, Skill, Goal (+ Note, Review annotations); superseded nodes carry valid_until (filter with "WHERE n.valid_until IS NULL" for current truth). Key rel types: PART_OF, ABOUT, INFORMS, CONTAINS, REQUIRES, DEPENDS_ON, ACHIEVED_BY.',
    inputSchema: { type: 'object', properties: { cypher: { type: 'string' }, params: { type: 'object', description: 'optional query parameters' } }, required: ['cypher'] },
    handler: async (args) => {
      // Added 2026-07-04 after twice being the missing capability ("how many active
      // projects"). Enforcement is the database's, not a regex: a READ session +
      // executeRead makes Neo4j reject any write clause server-side.
      const r = await runReadCypher(args.cypher, args.params);
      if (r.error) return { isError: true, code: 'cypher_error', message: r.error };
      return { rows: r.rows, count: r.rows.length, truncated: r.truncated };
    },
  },
  {
    name: 'write_graph',
    description: `Run a WRITE Cypher statement against the knowledge graph — full session parity for trusted agents (safety net: the graph is git-backed-up on every sync). HOUSE RULES, non-negotiable: (1) MERGE on natural keys, never bare CREATE — re-runs must not duplicate (Project/Idea/Goal/Person/Organization/Skill key on name, Resource/Source on title, Insight on id); set created_at = coalesce(n.created_at, datetime()). (2) Pass ALL text values as $parameters, never inline literals. (3) Relationship types are a CLOSED vocabulary: ${REL_TYPES.join(', ')} — anything else fails lint. (4) Connect every new node with at least one edge (orphans are invisible). (5) NEVER delete to correct — supersede: set valid_until = datetime() and superseded_by. Prefer capture_note/schedule for their cases; this is for Insights, Ideas, and structure.`,
    inputSchema: { type: 'object', properties: { cypher: { type: 'string' }, params: { type: 'object', description: 'query parameters — all text values go here' } }, required: ['cypher'] },
    handler: async (args) => {
      // Added 2026-07-04 at Rick's direction: the voice-loop agent gets the same graph
      // reach as an interactive session; backups + lint are the recovery story.
      const session = driver.session();
      try {
        const res = await session.executeWrite((tx) => tx.run(String(args.cypher).slice(0, 4000), args.params || {}), { timeout: 15000 });
        const c = res.summary.counters.updates();
        broadcast('graph-changed');
        return {
          ok: true,
          nodes_created: c.nodesCreated, nodes_deleted: c.nodesDeleted,
          relationships_created: c.relationshipsCreated, properties_set: c.propertiesSet,
          rows: res.records.slice(0, 20).map((r) => toPlain(r.toObject())),
        };
      } catch (e) {
        return { isError: true, code: 'cypher_error', message: String((e && e.message) || 'write failed').slice(0, 300) };
      } finally {
        await session.close();
      }
    },
  },
  {
    name: 'get_graph_stats',
    description: 'Deterministic graph statistics, ALREADY chart-shaped ([{label, value}]) — pipe straight into show_panel({kind:"viz", rows, title}) to visualize, or just narrate the numbers. facet: "labels" (node counts by type), "growth" (nodes created per week, last 12 weeks), "stale" (current vs superseded), "hubs" (most-connected nodes), "tags" (most-used tags). Omit facet for a compact all-facets digest. Cheaper and safer than writing your own aggregate Cypher for these common questions.',
    inputSchema: { type: 'object', properties: { facet: { enum: ['labels', 'growth', 'stale', 'hubs', 'tags'] } }, required: [] },
    handler: async (args) => graphStats(args.facet),
  },
  {
    name: 'save_lens',
    description: 'Save a chart as a reusable LIVE LENS — a named node storing a read-only cypher + chart spec (never the data) that RE-RUNS against the graph whenever opened, so it always reflects current state. Use after show_panel kind:"viz" when the user says "save that" / "keep this". Confirm the name by voice first. Optionally pass about_node_id (from search_nodes) to attach it to the node/project it concerns.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, cypher: { type: 'string', description: 'the read-only Cypher the lens re-runs' }, spec: { type: 'object', description: 'the chart spec {kind:bar|histogram|line|scatter,…}' }, about_node_id: { type: 'string', description: 'optional node id this lens is about' } }, required: ['name', 'cypher', 'spec'] },
    handler: async (args) => {
      const model = (voiceSession.status().model || 'agent').slice(0, 80);
      const result = await saveLens({ name: args.name, cypher: args.cypher, spec: args.spec, about_node_id: args.about_node_id, author: 'agent:' + model });
      if (result.error) return { isError: true, code: 'bad_lens', message: result.error };
      broadcast('graph-changed');
      return { ok: true, lens_id: result.lens.id, name: result.lens.name };
    },
  },
  {
    name: 'create_diagram',
    description: 'Create a PlantUML diagram for a node ("diagram this"): deterministic graph-neighborhood map by default (kind: mindmap | component), or brainstorm:true to have the LOCAL model draw from the node\'s text (kind also allows sequence). Renders locally and theme-matched — content never leaves the machine. save:true persists it as a diagram Source the user can reopen (give it a spoken-confirmed title). Follow with navigate_studio({node_id: source_id}) to show it.',
    inputSchema: { type: 'object', properties: {
      node_id: { type: 'string', description: 'the node to diagram (from search_nodes)' },
      kind: { enum: ['mindmap', 'component', 'sequence'] },
      brainstorm: { type: 'boolean', description: 'true = LLM from node text; default = deterministic graph walk' },
      save: { type: 'boolean' },
      title: { type: 'string', description: 'title for the saved Source (required when save:true)' },
    }, required: ['node_id'] },
    handler: async (args) => {
      const node = rows(await run(driver, Q_NODE, { id: String(args.node_id) }))[0];
      if (!node) return { isError: true, code: 'node_not_found', message: 'no node with that id' };
      const st = await pumlAvailable();
      if (!st.ok) return { isError: true, code: 'no_plantuml', message: 'PlantUML is not installed (brew install plantuml)' };
      let puml, rendered, attempts;
      if (args.brainstorm) {
        const prov = await resolveProvider();
        if (!prov) return { isError: true, code: 'no_model', message: 'no local model connected' };
        const kind = ['mindmap', 'component', 'sequence'].includes(args.kind) ? args.kind : 'mindmap';
        const r = await aiDiagramLane(prov, nodeText(node), kind, { generateImpl: generate, renderImpl: (p) => pumlRender(p, { postProcess: prepareSvg }) });
        if (!r.svg) return { isError: true, code: 'generation_failed', message: r.error };
        puml = r.puml; rendered = true; attempts = r.attempts;
      } else {
        const kind = args.kind === 'component' ? 'component' : 'mindmap';
        const fg = await api('/api/diagram/from-graph', { id: String(args.node_id), kind });
        if (fg.error && !fg.svg) return { isError: true, code: 'render_failed', message: fg.error };
        puml = fg.puml; rendered = !!fg.svg;
      }
      let source_id = null;
      if (args.save) {
        const title = String(args.title || '').trim();
        if (!title) return { isError: true, code: 'bad_params', message: 'title is required when save:true' };
        const recs = await run(driver, `
          MERGE (s:Source {title: $title})
          SET s.source_kind = 'diagram', s.puml = $puml, s.diagram_kind = $kind,
              s.tags = coalesce(s.tags, ['scatterbrained', 'diagram']),
              s.last_synced_at = datetime(), s.created_at = coalesce(s.created_at, datetime())
          WITH s MATCH (t) WHERE elementId(t) = $about
          MERGE (s)-[:INFORMS]->(t)
          RETURN elementId(s) AS id`,
        { title: title.slice(0, 200), puml, kind: args.kind || 'mindmap', about: String(args.node_id) });
        source_id = recs[0] ? toPlain(recs[0].toObject()).id : null;
        broadcast('graph-changed');
      }
      return { ok: true, rendered, puml, ...(attempts ? { attempts } : {}), ...(source_id ? { source_id } : {}) };
    },
  },
  {
    name: 'navigate_studio',
    description: 'Move the Studio UI the user is looking at: focus a node (id from search_nodes) and/or switch lens. Pairs with voice_say — show while you tell.',
    inputSchema: { type: 'object', properties: { node_id: { type: 'string' }, lens: { enum: ['graph', 'time', 'code', 'agents'] } }, required: [] },
    handler: async (args) => {
      if (!args.node_id && !args.lens) return { isError: true, code: 'bad_params', message: 'node_id or lens required' };
      if (args.node_id) {
        const node = rows(await run(driver, Q_NODE, { id: String(args.node_id) }))[0];
        if (!node) return { isError: true, code: 'node_not_found', message: 'no node with that id' };
        voiceSession.touch(node.id, { name: node.name, label: node.label });
      }
      broadcast('voice-navigate', { node_id: args.node_id || null, lens: args.lens || null });
      return { ok: true };
    },
  },
];

const mcp = createMcp({
  serverInfo: { name: 'scatterbrained', version: '1.0.0' },
  instructions: PERSONA_BRIEF + '\n\n' + VOICE_LOOP_PROTOCOL,
  tools: MCP_TOOLS,
  newSession: newMcpSession,
  isSession: (id) => mcpSessions.has(id),
});

async function addNote({ target, filePath, text, anchor_kind, locator, snippet, author, reviewId } = {}) {
  const t = String(text || '').trim();
  if (!t || (!target && !filePath && !reviewId)) return { error: 'text and (target, filePath, or reviewId) required' };
  // author: 'you' (default) or 'agent:<model>' — the seam for a later multi-team tier (#34).
  const a = String(author || 'you').trim() || 'you';
  const RET = `RETURN n.id AS id, n.text AS text, n.state AS state, n.anchor_kind AS anchor_kind,
               n.locator AS locator, n.snippet AS snippet, n.author AS author, toString(n.created_at) AS created_at,
               toString(n.last_verified_at) AS last_verified_at, n.evidence AS evidence, n.verifications AS verifications`;
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
  // An acceptance criterion (anchor_kind 'criterion') is born 'unverified' — its state then
  // moves only through explicit verification events (verifyCriterion), never the inbox cycle.
  const match = target ? 'MATCH (tg) WHERE elementId(tg) = $target' : 'MATCH (tg:Source) WHERE tg.file_path = $filePath';
  const recs = await run(driver,
    `${match}
     CREATE (n:Note {id: randomUUID()})
     SET n.text = $text, n.state = CASE WHEN $anchor_kind = 'criterion' THEN 'unverified' ELSE 'raw' END,
         n.anchor_kind = coalesce($anchor_kind, 'node'),
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
  // Criterion notes are excluded here BY the match: their state changes only via an explicit
  // verification event (POST /api/criterion/verify) — never the generic cycle (criterion 2).
  const recs = await run(driver,
    `MATCH (n:Note {id: $id}) WHERE coalesce(n.anchor_kind, '') <> 'criterion'
     SET n.state = $state, n.state_changed_at = datetime()
     RETURN n.id AS id, n.state AS state`, { id: String(id), state });
  if (!recs.length) return { error: 'note not found (criterion states change only via /api/criterion/verify)' };
  return toPlain(recs[0].toObject());
}

// ── Acceptance criteria (regression guardrails) ─────────────────────────────
// A criterion is a Note (anchor_kind 'criterion') ABOUT an Idea/Project; created via the
// existing POST /api/note. THIS is the one write path for its state: an explicit verification
// event {id, state: pass|fail, evidence?} → state + last_verified_at + a verifications
// counter (monotonic — how many events this criterion has absorbed). The update is in-place,
// matching how Notes mutate today (setNoteState); the EVENT is the POST, so "changed only via
// explicit verification events — never silently" holds. Full state history in v1 = the graph's
// git-versioned backup snapshots (invalidate-don't-delete per event would mint a new Note id
// per verification and break the criterion's identity/anchoring — rejected for v1).
async function verifyCriterion({ id, state, evidence } = {}) {
  if (!id || !VERIFY_STATES.includes(state)) return { error: `id and state (${VERIFY_STATES.join('|')}) required` };
  const recs = await run(driver,
    `MATCH (n:Note {id: $id}) WHERE n.anchor_kind = 'criterion'
     SET n.state = $state, n.last_verified_at = datetime(), n.state_changed_at = datetime(),
         n.verifications = coalesce(n.verifications, 0) + 1,
         n.evidence = coalesce($evidence, n.evidence)
     RETURN n.id AS id, n.state AS state, toString(n.last_verified_at) AS last_verified_at,
            n.verifications AS verifications, n.evidence AS evidence`,
    { id: String(id), state, evidence: evidence != null && String(evidence).trim() ? String(evidence).trim() : null });
  if (!recs.length) return { error: 'criterion not found' };
  return { ok: true, criterion: toPlain(recs[0].toObject()) };
}

// All criteria for a Project — its own plus its Ideas' (CONTAINS / PART_OF), for the review
// lens checklist (criterion 5). Grouping/ordering is the pure groupCriteriaByAnchor client-side.
const CRIT_RET = `
  RETURN DISTINCT c.id AS id, c.text AS text, c.state AS state,
         toString(c.last_verified_at) AS last_verified_at, c.evidence AS evidence,
         elementId(a) AS anchor_id, coalesce(a.name, a.title) AS anchor_name`;
const Q_PROJECT_CRITERIA = `
  MATCH (c:Note {anchor_kind: 'criterion'})-[:ABOUT]->(a:Project {name: $name}) ${CRIT_RET}
  UNION
  MATCH (:Project {name: $name})-[:CONTAINS]->(a:Idea)<-[:ABOUT]-(c:Note {anchor_kind: 'criterion'}) ${CRIT_RET}
  UNION
  MATCH (a:Idea)-[:PART_OF]->(:Project {name: $name}) MATCH (c:Note {anchor_kind: 'criterion'})-[:ABOUT]->(a) ${CRIT_RET}`;
async function projectCriteria(name) {
  if (!name || !String(name).trim()) return { criteria: [] };
  return { criteria: rows(await run(driver, Q_PROJECT_CRITERIA, { name: String(name).trim() })) };
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
async function setSchedule({ id, kind, when, every } = {}) {
  const nid = String(id || '');
  if (!nid) return { error: 'id required' };
  if (!isScheduleKind(kind)) return { error: 'kind must be due_at or review_at' };
  const d = (when == null || when === '') ? null : String(when);
  if (d !== null && !isIsoDate(d)) return { error: 'when must be YYYY-MM-DD (or empty to clear)' };
  // optional recurrence cadence (rank 8): a closed RECUR_KINDS token or empty to clear.
  // Stored beside the anchor as due_every / review_every; clearing the date clears its cadence.
  const ev = (every == null || every === '') ? null : String(every);
  if (ev !== null && !isRecurKind(ev)) return { error: 'every must be a cadence (daily…yearly) or empty' };
  // `kind` is allowlisted (isScheduleKind) so the derived property names are safe identifiers,
  // never user text — same trust-boundary posture as the single-prop setter it extends.
  const everyProp = kind.replace(/_at$/, '_every');   // due_at→due_every, review_at→review_every
  const recs = await run(driver,
    `MATCH (n) WHERE elementId(n) = $id
     SET n.\`${kind}\` = CASE WHEN $d IS NULL THEN null ELSE date($d) END,
         n.\`${everyProp}\` = CASE WHEN $d IS NULL THEN null ELSE $ev END
     RETURN toString(n.\`${kind}\`) AS value, n.\`${everyProp}\` AS every`,
    { id: nid, d, ev });
  if (!recs.length) return { error: 'node not found' };
  const rec = toPlain(recs[0].toObject());
  return { ok: true, kind, value: rec.value, every: rec.every };
}

// First-run onboarding (#6): bootstrap ONE root owner node on a fresh/empty graph so every later
// Project/Insight has a hub to hang off instead of accumulating as disconnected islands. The single
// sanctioned node-authoring path in the UI — MERGE-keyed (can't duplicate), is_self:true marks the
// owner. kind is a closed choice (person|org); name is the only free text and is just a node key.
async function createRoot({ kind, name } = {}) {
  const nm = String(name || '').trim();
  if (!nm) return { error: 'name required' };
  const org = kind === 'org' || kind === 'organization';
  const recs = await run(driver,
    org
      ? `MERGE (o:Organization {name: $name}) ON CREATE SET o.created_at = datetime() SET o.is_self = true
         RETURN elementId(o) AS id, o.name AS name`
      : `MERGE (p:Person {name: $name}) ON CREATE SET p.created_at = datetime() SET p.is_self = true
         RETURN elementId(p) AS id, p.name AS name`,
    { name: nm });
  return recs.length ? { ok: true, root: toPlain(recs[0].toObject()) } : { error: 'could not create root' };
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
  // `recur` (due_every/review_every, rank 8) rides along on the due/review rows so the client
  // can expand occurrences within the window; null on the record-time / target branches. Every
  // UNION branch returns the same columns (date, kind, id, name, label, recur).
  const q = `
    MATCH (n) WHERE n.created_at IS NOT NULL AND date(n.created_at) >= date($from) AND date(n.created_at) <= date($to)
    RETURN toString(date(n.created_at)) AS date, 'created' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label, null AS recur
    UNION
    MATCH (n) WHERE n.valid_until IS NOT NULL AND date(n.valid_until) >= date($from) AND date(n.valid_until) <= date($to)
    RETURN toString(date(n.valid_until)) AS date, 'expiry' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label, null AS recur
    UNION
    MATCH (g:Goal) WHERE g.target_date IS NOT NULL AND date(g.target_date) >= date($from) AND date(g.target_date) <= date($to)
    RETURN toString(g.target_date) AS date, 'target' AS kind, elementId(g) AS id,
           coalesce(g.name, g.title) AS name, 'Goal' AS label, null AS recur
    UNION
    MATCH (n) WHERE n.due_at IS NOT NULL AND date(n.due_at) <= date($to)
      AND (n.due_every IS NOT NULL OR date(n.due_at) >= date($from))
    RETURN toString(date(n.due_at)) AS date, 'due' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label, n.due_every AS recur
    UNION
    MATCH (n) WHERE n.review_at IS NOT NULL AND date(n.review_at) <= date($to)
      AND (n.review_every IS NOT NULL OR date(n.review_at) >= date($from))
    RETURN toString(date(n.review_at)) AS date, 'review' AS kind, elementId(n) AS id,
           coalesce(n.name, n.title, n.summary, n.id) AS name,
           [l IN labels(n) WHERE l <> 'Embeddable'][0] AS label, n.review_every AS recur`;
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
  const review = toPlain(recs[0].toObject());
  // Attach the review to the Project it reviews — (Review)-[:ABOUT]->(Project) — so
  // "all reviews for X" is a graph traversal (getReview already reads the edge back).
  // Resolution (lib/review-project.js) is conservative: no/ambiguous match → NO edge
  // (a wrong project edge is worse than none); MERGE keeps re-materialization idempotent.
  const projects = rows(await run(driver, `MATCH (p:Project) RETURN p.name AS name, p.repo_url AS repo_url`));
  const projectName = resolveReviewProject(dir, projects);
  if (projectName) {
    await run(driver,
      `MATCH (rv:Review {id: $id}) MATCH (p:Project {name: $name}) MERGE (rv)-[:ABOUT]->(p)`,
      { id: review.id, name: projectName });
  } else {
    console.log(`  review ${review.id}: no Project matched repo ${dir} — ABOUT edge skipped`);
  }
  review.project = projectName;
  return { review };
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
  // Resolve the Project even for an unmaterialized review (same conservative lib the ABOUT
  // edge uses), so the summary's acceptance-criteria checklist works from the first open.
  if (!review.project) {
    const projects = rows(await run(driver, `MATCH (p:Project) RETURN p.name AS name, p.repo_url AS repo_url`));
    review.project = resolveReviewProject(dir, projects);
  }
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
  // maxBuffer: the default 1MB ENOBUFS-es on `git show` of ordinary assets (a repo screenshot
  // PNG is ~1.3MB); 8MB lets fileVersion() see the bytes and answer "binary"/"too large" itself.
  try { const out = execFileSync('git', args, { encoding: 'utf8', timeout: GIT_TIMEOUT, maxBuffer: 8 * 1024 * 1024 }); return { ok: true, out: trim ? out.trim() : out }; }
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
  // Human answers, not spawn errors: a binary blob (screenshots in a reviewed diff) or an
  // oversize file gets the same designed "couldn't read" state with a message that explains.
  if (!r.ok) return { error: /ENOBUFS/.test(r.error || '') ? 'file too large to preview' : (r.error || 'not found') };
  if (r.out.includes('\u0000')) return { error: 'binary file — no text preview' };
  if (r.out.length > SOURCE_MAX_BYTES * 2) return { error: 'file too large to preview' };
  return { rev, text: r.out };
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript', '.map': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const RAW_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };

// Baseline defense-in-depth headers for the app document. script/style keep 'unsafe-inline'
// because the UI uses inline event handlers — the real XSS sinks are scheme-gated at the
// source (provenance/miniMarkdown/link). object-src 'none' + frame-ancestors 'none' close the
// <object>/<embed> SVG vector and clickjacking; frame-src is limited to the video embed hosts
// plus the local Slipway runtime (the Agents surface) — an explicit, single localhost origin,
// never a wildcard.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' http://localhost:8765 http://127.0.0.1:8765; frame-src https://www.youtube-nocookie.com https://player.vimeo.com http://localhost:8765 http://127.0.0.1:8765; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

// Read a request body with a hard BYTE cap. Resolves on 'end'; rejects on overflow or abort.
// A destroyed stream never emits 'end', so we must also settle on 'close'/'error' — otherwise
// the handler's await hangs forever and the socket leaks. Byte-counted (Buffer.length), not chars.
// Binary twin of readBody — the audio route needs Buffers; string concat corrupts PCM.
function readBodyBuffer(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0, settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    req.on('data', (c) => { len += c.length; if (len > cap) done(reject, new Error('too large')); else if (!settled) chunks.push(c); });
    req.on('end', () => done(resolve, Buffer.concat(chunks)));
    req.on('close', () => done(reject, new Error('aborted')));
    req.on('error', () => done(reject, new Error('aborted')));
  });
}

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
      const real = realOf(fp);   // resolve symlinks so a link inside a root can't escape it
      const ext = (/\.([a-z0-9]+)$/i.exec(real) || [, ''])[1].toLowerCase();
      if (!fp || !isWithinRoots(real, SOURCE_ROOTS) || !RAW_TYPES[ext]) return send(res, 403, { error: 'forbidden' });
      if (!fs.existsSync(real)) return send(res, 404, { error: 'not found' });
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
      const rs = fs.createReadStream(real);
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
    if (url.pathname === '/api/criterion/verify' && req.method === 'POST') {
      // The explicit verification event (criterion 2/3): {id, state: pass|fail, evidence?}.
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = await verifyCriterion(p);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Save a live Lens (Studio saved-query view) — the endpoint the save_lens tool also drives.
    if (url.pathname === '/api/diagram/save' && req.method === 'POST') {
      // Persist a diagram as Source {source_kind:'diagram'} — MERGE on title (hard rule 1:
      // idempotent, re-saving updates), INFORMS the node it's about so lint never sees an
      // orphan. The puml SOURCE is stored (not the SVG) — rendering stays live + themed.
      let body; try { body = await readBody(req, 80 * 1024); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const title = String(p.title || '').trim().slice(0, 200);
      const puml = String(p.puml || '').trim();
      if (!title || !puml) return send(res, 400, { error: 'title and puml are required' });
      if (puml.length > 64 * 1024) return send(res, 400, { error: 'diagram source too large' });
      const recs = await run(driver, `
        MERGE (s:Source {title: $title})
        SET s.source_kind = 'diagram', s.puml = $puml, s.diagram_kind = $kind,
            s.file_path = coalesce($file_path, s.file_path),
            s.tags = coalesce(s.tags, ['scatterbrained', 'diagram']),
            s.last_synced_at = datetime(),
            s.created_at = coalesce(s.created_at, datetime())
        WITH s
        OPTIONAL MATCH (t) WHERE $about IS NOT NULL AND elementId(t) = $about
        FOREACH (_ IN CASE WHEN t IS NOT NULL THEN [1] ELSE [] END | MERGE (s)-[:INFORMS]->(t))
        RETURN elementId(s) AS id, s.title AS title`,
      { title, puml, kind: String(p.kind || 'uml').slice(0, 30), file_path: p.file_path ? String(p.file_path) : null, about: p.about_id ? String(p.about_id) : null });
      const saved = recs[0] ? toPlain(recs[0].toObject()) : null;
      if (saved) broadcast('graph-changed');
      return send(res, saved ? 200 : 500, saved || { error: 'save failed' });
    }
    if (url.pathname === '/api/diagram/render' && req.method === 'POST') {
      // Local PlantUML render: sentinel-themed, then rewritten to CSS vars + sanitized
      // (prepareSvg) BEFORE caching — so cached hits are ready for innerHTML and the
      // cache stays theme-agnostic (theme switches are pure CSS, zero re-renders).
      let body; try { body = await readBody(req, 80 * 1024); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad JSON' }); }
      const st = await pumlAvailable();
      if (!st.ok) return send(res, 200, { error: 'PlantUML is not installed (brew install plantuml)', unavailable: true });
      const result = await pumlRender(String(p.puml || ''), { postProcess: prepareSvg });
      return send(res, 200, result);
    }
    if (url.pathname === '/api/lens' && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = await saveLens(p);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // VOICE: the built-in local chat lane (no broadcast — a conversation mutates nothing).
    if (url.pathname === '/api/voice/chat' && req.method === 'POST') {
      let body; try { body = await readBody(req, 16384); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = await voiceChat(p);
      return send(res, result.error && !result.available ? 400 : 200, result);
    }
    // Load a model through Slipway — the empty state's one-click remedy. Validated inside
    // slipwayLoad against Slipway's own model list; the panel then polls /api/ai/ping until
    // the brain answers (an MLX load takes ~15-60s).
    if (url.pathname === '/api/slipway/load' && req.method === 'POST') {
      let body; try { body = await readBody(req, 4096); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = await slipwayLoad(String(p.model || ''));
      return send(res, result.error ? 502 : 200, result);
    }
    // VOICE Phase 3: the browser side of the rendezvous — utterances in, TTS outcomes back.
    if ((url.pathname === '/api/voice/utterance' || url.pathname === '/api/voice/say-done' || url.pathname === '/api/voice/switch-local') && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/voice/utterance' ? voiceSession.utterance(p)
        : url.pathname === '/api/voice/say-done' ? voiceSession.sayDone(p)
          : voiceSession.switchLocal();
      return send(res, 200, result);
    }
    // VOICE Phase 9: on-device recognition — WAV in (binary body), text out (whisper).
    if (url.pathname === '/api/voice/stt' && req.method === 'POST') {
      let wav; try { wav = await readBodyBuffer(req, 8 * 1024 * 1024); } catch { return send(res, 413, { error: 'request too large' }); }
      if (!wav || wav.length < 128 || wav.toString('ascii', 0, 4) !== 'RIFF') return send(res, 400, { error: 'audio/wav body required' });
      const out = await sttTranscribe(wav, String(url.searchParams.get('model') || ''));
      if (!out.ok) return send(res, 503, { error: out.error });
      return send(res, 200, { text: out.text });
    }
    // VOICE Phase 7: local TTS synthesis — text in, WAV out (Kokoro, warm child process).
    if (url.pathname === '/api/voice/tts' && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const text = String(p.text || '').trim();
      if (!text) return send(res, 400, { error: 'text required' });
      const out = await ttsSynth(text, p.voice, { speed: p.speed });
      if (!out.ok) return send(res, 503, { error: out.error });
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Duration': String(out.duration || '') });
      return res.end(out.wav);
    }
    // VOICE Phase 6: explicit save — the one voice write to the graph. 256KB cap: a whole
    // conversation transcript, not a control message.
    if (url.pathname === '/api/voice/capture' && req.method === 'POST') {
      let body; try { body = await readBody(req, 256 * 1024); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = await voiceCapture(p);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // The MCP endpoint (Streamable HTTP, plain-JSON responses). Guards: loopback Host
    // (the global POST check above) + explicit non-loopback-Origin rejection (DNS
    // rebinding) + bearer token (a hostile localhost page can't drive the tools).
    if (url.pathname === '/mcp') {
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      const origin = String(req.headers.origin || '');
      if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return send(res, 403, { error: 'forbidden' });
      if (!mcpTokenOk(req.headers.authorization)) return send(res, 401, { error: 'unauthorized — pass the bearer token from ~/.scatterbrained/mcp-token' });
      let body; try { body = await readBody(req, 65536); } catch { return send(res, 413, { error: 'request too large' }); }
      const out = await mcp.handle(body, { sessionId: String(req.headers['mcp-session-id'] || '') || undefined });
      const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
      if (out.sessionId) headers['Mcp-Session-Id'] = out.sessionId;
      res.writeHead(out.status, headers);
      return res.end(out.body === null ? undefined : JSON.stringify(out.body));
    }
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
    // First-run onboarding (#6): bootstrap a single root owner node on an empty graph.
    if (url.pathname === '/api/root' && req.method === 'POST') {
      let body; try { body = await readBody(req, 4096); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = await createRoot(p);
      if (!result.error) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Act plane (Phase 2): "Open agent here" — resolve cwd, write the graph brief into it,
    // then launch a Slipway terminal there. No broadcast — a launch mutates nothing in the graph.
    if (url.pathname === '/api/agent/launch' && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = await agentLaunch(String(p.id || ''));
      return send(res, result.error ? 400 : 200, result);
    }
    // Act plane (Phase 3): capture an ended agent session into the graph as a Source, or
    // summarize a captured one into an Insight (local inference lane; user-triggered only).
    if ((url.pathname === '/api/agent/capture' || url.pathname === '/api/agent/summarize') && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = url.pathname === '/api/agent/capture' ? await agentCapture(p) : await agentSummarize(p);
      if (result.ok) broadcast('graph-changed');
      return send(res, result.error ? 400 : 200, result);
    }
    // Rail-visibility archiving: a thin passthrough to Slipway's index (the source of truth).
    // { id, archived } toggles one; { all: true } bulk-archives every ended session. Never
    // deletes a session or touches the graph — captured Sources/INFORMS edges stay visible.
    if (url.pathname === '/api/agent/archive' && req.method === 'POST') {
      let body; try { body = await readBody(req, 8192); } catch { return send(res, 413, { error: 'request too large' }); }
      let p; try { p = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
      const result = p.all
        ? await slipwayArchive('/api/term/archive-ended', {})
        : await slipwayArchive('/api/term/archive', { id: String(p.id || ''), archived: p.archived !== false });
      return send(res, result.error ? 502 : 200, result);
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
  ensureSlipway();   // fire-and-forget; Studio never blocks on the runtime
});

// ── Slipway autostart ────────────────────────────────────────────────────────
// Bring the local-model runtime up WITH the Studio (models are not loaded by default, so
// an idle Slipway costs ~nothing). Opt out with SLIPWAY_AUTOSTART=0. Runs the copy bundled
// at ./slipway/ in a release; SLIPWAY_DIR or a ~/Projects/mlx-control dev checkout override
// it. Never loads a model — that stays an explicit user action.
async function ensureSlipway() {
  const decision = autostartDecision({ env: process.env, pingOk: await slipwayPing() });
  if (decision === 'disabled') return;
  if (decision === 'already-running') { console.log('  ▸ Slipway: already running'); return; }
  const dir = slipwayDirCandidates({ env: process.env, home: os.homedir(), root: __dirname })
    .find((d) => fs.existsSync(path.join(d, 'server.py')));
  if (!dir) { console.log('  ▸ Slipway: server.py not found (bundled slipway/ or SLIPWAY_DIR) — skipping autostart'); return; }
  const { cmd, args, cwd, serverPy } = slipwayCommand({ env: process.env, dir });
  const logPath = path.join(os.homedir(), '.scatterbrained', 'slipway.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, 'a');
  try {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', log, log] });
    child.unref();   // Slipway outlives the Studio — sessions keep their runtime
  } catch (e) {
    console.log(`  ▸ Slipway: autostart failed (${e.message}) — see ${logPath}`);
    return;
  } finally { fs.closeSync(log); }
  for (let i = 0; i < 40; i++) {           // ~20s: matches bin/mlx-control's readiness window
    await new Promise((r) => setTimeout(r, 500));
    if (await slipwayPing(800)) { console.log('  ▸ Slipway: started (no model loaded)'); return; }
  }
  console.log(`  ▸ Slipway: did not answer within 20s — see ${logPath}`);
}

const bye = async () => { await driver.close(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
