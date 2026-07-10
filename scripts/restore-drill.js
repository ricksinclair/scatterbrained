#!/usr/bin/env node
// ============================================================================
// restore-drill.js — prove the backup actually restores (C5, "untested backups
// are the classic silent failure"). "Git is the only undo" is only true if
// backups/graph.json round-trips.
//
// What it does, end to end:
//   1. read backups/graph.json (counts = ground truth)
//   2. start a THROWAWAY Neo4j container (own name, own port, --rm)
//   3. restore into it via the real scripts/import-graph.js (env-pointed)
//   4. node + relationship count parity vs the backup file
//   5. tear the container down (always — also on failure)
//   6. append the result to backups/restore-drill-log.jsonl
//
// The drill NEVER touches the canonical graph: it only reads the backup file
// and only talks to the scratch bolt port. Exit 0 = backup restores clean.
//
//   npm run restore:drill            # full drill (~60-90s, mostly Neo4j boot)
//   npm run restore:drill -- --keep  # leave the scratch container up to inspect
// ============================================================================
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import neo4j from 'neo4j-driver';
import { parseArgs } from './lib/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP = path.join(ROOT, 'backups', 'graph.json');
const LOG = path.join(ROOT, 'backups', 'restore-drill-log.jsonl');
const NAME = 'scatterbrained-restore-drill';   // never the live container's name
const PORT = 7690;                             // never the live 7687
const AUTH = 'drill-local';
const BOLT_WAIT_S = 90;

const fail = (msg) => { console.error(`✗ restore drill: ${msg}`); return msg; };
const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', ...opts });

async function boltReady(uri, password, budgetS) {
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < budgetS) {
    const driver = neo4j.driver(uri, neo4j.auth.basic('neo4j', password));
    try { await driver.getServerInfo(); await driver.close(); return true; }
    catch { await driver.close(); await new Promise((r) => setTimeout(r, 2000)); }
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  let error = null, counts = null;

  // 1. the backup file is the ground truth
  if (!existsSync(BACKUP)) { fail(`backup file missing: ${BACKUP} — run node scripts/export-graph.js first`); process.exit(1); }
  const backup = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const expected = { nodes: backup.nodes.length, relationships: backup.relationships.length };

  // 2. docker must be up
  if (docker(['info']).status !== 0) { fail('docker is not available/running'); process.exit(1); }
  docker(['rm', '-f', NAME]);   // a leftover drill container from a crashed run

  const started = docker(['run', '-d', '--rm', '--name', NAME,
    '-p', `127.0.0.1:${PORT}:7687`, '-e', `NEO4J_AUTH=neo4j/${AUTH}`, 'neo4j:5-community']);
  if (started.status !== 0) { fail(`scratch container failed to start: ${(started.stderr || '').trim()}`); process.exit(1); }

  const uri = `bolt://localhost:${PORT}`;
  try {
    // 3. wait for bolt, then restore through the REAL import path
    if (!(await boltReady(uri, AUTH, BOLT_WAIT_S))) throw new Error(`scratch bolt not ready within ${BOLT_WAIT_S}s`);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'import-graph.js'), '--input', BACKUP], {
      env: { ...process.env, NEO4J_URI: uri, NEO4J_USER: 'neo4j', NEO4J_PASSWORD: AUTH },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 4. parity
    const driver = neo4j.driver(uri, neo4j.auth.basic('neo4j', AUTH));
    try {
      const s = driver.session();
      const res = await s.run('MATCH (n) WITH count(n) AS nodes MATCH ()-[r]->() RETURN nodes, count(r) AS relationships');
      counts = { nodes: Number(res.records[0].get('nodes')), relationships: Number(res.records[0].get('relationships')) };
      await s.close();
    } finally { await driver.close(); }

    const diffs = ['nodes', 'relationships'].filter((k) => counts[k] !== expected[k]);
    if (diffs.length) throw new Error(diffs.map((k) => `${k}: restored ${counts[k]} ≠ backup ${expected[k]}`).join('; '));
  } catch (e) {
    error = fail(e.message);
  } finally {
    // 5. teardown — --rm removes on stop; --keep leaves it for inspection
    if (!args.keep) docker(['stop', NAME]);
    else console.log(`  (scratch container kept: ${NAME} on bolt ${PORT}, auth neo4j/${AUTH})`);
  }

  // 6. the drill leaves a trail either way
  const entry = { at: new Date().toISOString(), pass: !error, expected, restored: counts, seconds: Math.round((Date.now() - t0) / 1000), ...(error ? { error } : {}) };
  appendFileSync(LOG, JSON.stringify(entry) + '\n');

  if (error) process.exit(1);
  console.log(`✓ restore drill passed — ${counts.nodes} nodes / ${counts.relationships} relationships round-tripped in ${entry.seconds}s (log: backups/restore-drill-log.jsonl)`);
}

main().catch((e) => { fail(e.message); process.exit(1); });
