import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = path.join(root, 'bin/scatterbrained.js');

test('help lists the core commands', () => {
  const out = execFileSync('node', [bin, 'help'], { encoding: 'utf8' });
  for (const c of ['lint', 'search', 'new-project', 'setup-notion', 'context']) assert.match(out, new RegExp(`\\b${c}\\b`));
});

test('an unknown command exits non-zero', () => {
  assert.throws(() => execFileSync('node', [bin, 'definitely-not-a-command'], { stdio: 'pipe' }));
});

test('every command in the dispatcher points at a script that exists', () => {
  const src = fs.readFileSync(bin, 'utf8');
  const scripts = [...src.matchAll(/'([\w-]+\.js)'/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 10, `expected the command map, found ${scripts.length}`);
  for (const s of scripts) assert.ok(fs.existsSync(path.join(root, 'scripts', s)), `scripts/${s} should exist`);
});
