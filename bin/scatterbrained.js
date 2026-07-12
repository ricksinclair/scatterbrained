#!/usr/bin/env node
// scatterbrained — the published CLI. Deliberately small: the three commands a new
// user needs to get going via `npx scatterbrained <command>` (or globally as
// `scatterbrained`). The full ~18-command graph toolkit is for repo-clone
// contributors and lives in package.json scripts — run it with `npm run <command>`.
//
//   studio    launch the Studio (auto-starts Neo4j + demo graph)
//   capture   drop a note or a web link into a running Studio
//   status    is the Studio up? what's in the graph? am I on the newest release?
//   backup    export the whole graph to a JSON file (your pre-upgrade safety net)
//
// Zero deps, Node stdlib only (http). For the full setup — docker-compose Neo4j,
// schema, demo graph, and the whole toolkit — clone the repo:
// https://github.com/ricksinclair/scatterbrained
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { captureRequest, studioBaseUrl } from '../lib/cli-capture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = (() => {
  try { return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || null; }
  catch { return null; }
})();

const HELP = `scatterbrained — a second brain you can see

Usage:  scatterbrained <command> [args]

Commands:
  studio                 launch the Studio (auto-starts Neo4j + a demo graph)
  capture "<text|url>"   drop a note or a web link into the running Studio
  status                 is the Studio up? what's in the graph? newest release?
  backup [--output <f>]  export the whole graph to a JSON file (default:
                         ./scatterbrained-backup-<date>.json) — restore with the
                         repo toolkit's \`npm run import\`

Capture a note anchored to a node:  scatterbrained capture "…" --on <nodeId>

Connection (env, sane local defaults):
  STUDIO_PORT (4317)   NEO4J_URI (bolt://localhost:7687)   NEO4J_USER (neo4j)   NEO4J_PASSWORD

The full toolkit (lint, resume, search, context, new-project, embed, supersede, …)
ships with the repo — clone it and run \`npm run <command>\`:
  https://github.com/ricksinclair/scatterbrained   ·   https://ulrictodman.com/scatterbrained
`;

// POST JSON to a running Studio; GET when body is null. Resolves to { status, json }
// or rejects with a code we translate to a friendly message (ECONNREFUSED → "run
// `scatterbrained studio` first", never a raw stack trace).
function request(pathname, body, method) {
  const base = new URL(studioBaseUrl());
  const payload = body == null ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: base.hostname, port: base.port, path: pathname, method: method || (body ? 'POST' : 'GET'),
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch { /* non-JSON */ }
          resolve({ status: res.statusCode, json }); });
      });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const studioDownMsg =
  `  ✗ The Studio isn't running at ${studioBaseUrl()}.\n` +
  `    Start it first:  scatterbrained studio\n` +
  `    (or set STUDIO_PORT if you launched it on another port.)`;

function isDown(err) { return err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EADDRNOTAVAIL'); }

async function capture(args) {
  // args: the capture string, plus optional `--on <nodeId>` to anchor a note.
  const onIdx = args.indexOf('--on');
  const target = onIdx >= 0 ? args[onIdx + 1] : undefined;
  const text = (onIdx >= 0 ? args.slice(0, onIdx) : args).join(' ');
  const plan = captureRequest(text, { target });
  if (plan.error) { console.error(`  ✗ ${plan.error}`); process.exit(1); }

  let res;
  try { res = await request(plan.path, plan.body); }
  catch (err) { console.error('\n' + (isDown(err) ? studioDownMsg : `  ✗ ${err.message}`)); process.exit(1); }

  const j = res.json || {};
  if (res.status !== 200 || j.error) { console.error(`  ✗ ${j.error || `Studio returned ${res.status}`}`); process.exit(1); }

  if (plan.path === '/api/link') {
    const n = j.node || {};
    const where = j.attached ? ` → attached to ${j.attached.name}` : '';
    console.log(`  ${j.kind === 'video' ? '🎬' : '🔗'} saved: ${n.title || n.url}${where}`);
  } else {
    const anchored = target ? ` (on ${target})` : '';
    console.log(`  📝 note captured${anchored}: "${(j.note && j.note.text) || text}"`);
  }
}

// Registry freshness — a single anonymous dist-tags GET, ONLY here (an explicit
// `status` invocation): the Studio itself never touches the network beyond localhost.
// Best-effort: offline / slow / registry-down all resolve to null silently.
function newestPublished(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = https.get('https://registry.npmjs.org/-/package/scatterbrained/dist-tags',
      { timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function status() {
  if (VERSION) {
    console.log(`  ● Scatterbrained: v${VERSION}`);
    const tags = await newestPublished();
    const newest = tags && (tags.alpha || tags.latest);
    if (newest && newest !== VERSION) {
      console.log(`    newest published: v${newest} — upgrade with \`npm i -g scatterbrained@alpha\` (npx users get it automatically)`);
    }
  }
  let res;
  try { res = await request('/api/health', null); }
  catch (err) {
    if (isDown(err)) { console.log('  ● Studio: down\n' + studioDownMsg); process.exit(1); }
    console.error(`  ✗ ${err.message}`); process.exit(1);
  }
  // The Studio answered — it's up. A 500 here means the server is running but Neo4j
  // (which every health query hits) is unreachable; report that distinctly.
  if (res.status !== 200) {
    console.log(`  ● Studio: up (${studioBaseUrl()})`);
    console.log('  ● Neo4j:  unreachable — the Studio is running but can\'t reach the graph.');
    console.log('    Check NEO4J_URI / NEO4J_PASSWORD, or run `scatterbrained studio` to auto-start one.');
    process.exit(1);
  }
  const h = res.json || {};
  console.log(`  ● Studio: up (${studioBaseUrl()})`);
  console.log('  ● Neo4j:  reachable');
  const bits = [];
  if (h.total != null) bits.push(`${h.total} nodes`);
  if (h.indexed != null) bits.push(`${h.indexed} indexed`);
  if (h.superseded != null) bits.push(`${h.superseded} superseded`);
  if (h.orphans != null) bits.push(`${h.orphans} orphans`);
  if (bits.length) console.log(`    graph: ${bits.join(' · ')}`);
  if (h.newest && h.newest.name) console.log(`    newest insight: ${h.newest.name}`);
  if (h.last_sync) console.log(`    last sync: ${h.last_sync}`);
  process.exit(0);
}

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(HELP);
  process.exit(cmd ? 0 : 1);
}

if (cmd === '--version' || cmd === '-v' || cmd === 'version') {
  console.log(VERSION || 'unknown');
  process.exit(0);
}

if (cmd === 'backup') {
  // Wraps the toolkit's export (ships in the package) with a cwd-relative default,
  // so npx users get a visible file — the package's own dir is hidden in npx's cache.
  const oi = rest.indexOf('--output');
  const out = path.resolve(oi >= 0 && rest[oi + 1] ? rest[oi + 1]
    : `scatterbrained-backup-${new Date().toISOString().slice(0, 10)}.json`);
  const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts/export-graph.js'), '--output', out], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

if (cmd === 'studio') {
  // Launch the observatory (auto-Neo4j + demo seed). Same entry as `npm start`.
  const res = spawnSync(process.execPath, [path.join(ROOT, 'studio-scripts/start.mjs'), ...rest], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

if (cmd === 'capture') { capture(rest); }
else if (cmd === 'status') { status(); }
else {
  console.error(`scatterbrained: unknown command "${cmd}". Run \`scatterbrained help\`.`);
  process.exit(1);
}
