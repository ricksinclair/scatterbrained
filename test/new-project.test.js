import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeMd, mergeManifest } from '../scripts/new-project.js';

test('claudeMd fills the project name, workspace url, and data_source ids', () => {
  const md = claudeMd('Acme', 'https://ws', {
    'Development Tracker': { id: 'dt-id' },
    Changelog: { id: 'cl-id' },
  });
  assert.match(md, /# CLAUDE\.md — Acme/);
  assert.match(md, /https:\/\/ws/);
  assert.match(md, /data_source_id `dt-id`/);
  assert.match(md, /data_source_id `cl-id`/);
  assert.match(md, /data_source_id `<id>`/, 'missing entries fall back to a placeholder, never undefined');
});

test('mergeManifest adds a project without clobbering existing ones', () => {
  const tmp = path.join(os.tmpdir(), `engram-merge-${process.pid}-a.json`);
  fs.writeFileSync(tmp, JSON.stringify({ projects: { Existing: { workspace_url: 'u', entries: {} } } }));
  mergeManifest('New', { projects: { New: { workspace_url: 'v', entries: { X: { kind: 'page', id: '1' } } } } }, tmp);
  const result = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  assert.ok(result.projects.Existing, 'existing project preserved');
  assert.equal(result.projects.New.entries.X.id, '1', 'new project added');
  fs.unlinkSync(tmp);
});

test('mergeManifest starts fresh when the file does not exist', () => {
  const tmp = path.join(os.tmpdir(), `engram-merge-${process.pid}-b.json`);
  mergeManifest('P', { projects: { P: { workspace_url: 'w', entries: {} } } }, tmp);
  assert.ok(JSON.parse(fs.readFileSync(tmp, 'utf8')).projects.P);
  fs.unlinkSync(tmp);
});
