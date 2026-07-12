import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// Upgrade contract (painless-version-upgrades): an in-place upgrade re-runs the schema
// and the start sequence against a graph created by any earlier version, and must never
// destroy data. Text-shaped guards over the files that enforce it — same technique as
// test/demo-seed.test.js, no database needed.

test('schema is additive-only: every CREATE is IF NOT EXISTS', () => {
  const statements = read('scripts/seed-schema.cypher')
    .split(';')
    .map((s) => s.replace(/\/\/[^\n]*/g, '').trim())
    .filter((s) => /^CREATE\b/i.test(s));
  assert.ok(statements.length > 0, 'schema has CREATE statements');
  for (const s of statements) {
    assert.match(s, /IF NOT EXISTS/i, `not idempotent: ${s.slice(0, 70)}…`);
  }
});

test('demo seed is gated on fresh-container AND empty graph — upgrades never re-seed', () => {
  const start = read('studio-scripts/start.mjs');
  assert.match(
    start,
    /spun && process\.env\.SB_NO_DEMO !== '1'[\s\S]{0,80}nodeCount\(driver\)\) === 0/,
    'the seed gate (spun && !SB_NO_DEMO && nodeCount===0) must guard the demo load'
  );
});

test('--version prints the package version', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/scatterbrained.js'), '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), JSON.parse(read('package.json')).version);
});

test('help documents the backup command', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/scatterbrained.js'), 'help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /backup \[--output <f>\]/);
});
