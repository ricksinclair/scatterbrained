import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databases, manifestBlock, createWorkspace } from '../scripts/setup-notion.js';

test('databases() returns the 5 standard databases, each with exactly one title', () => {
  const dbs = databases(['Backend', 'Frontend']);
  assert.equal(dbs.length, 5);
  const keys = dbs.map((d) => d.key);
  for (const k of ['Development Tracker', 'Documentation Index', 'Changelog', 'Test Run Metrics', 'Problem Tests'])
    assert.ok(keys.includes(k), `missing database: ${k}`);
  for (const d of dbs) {
    const titles = Object.values(d.props).filter((p) => p.title);
    assert.equal(titles.length, 1, `${d.key} must have exactly one title property`);
  }
});

test('Kanban Module options reflect the modules passed in', () => {
  const tracker = databases(['API', 'Web', 'Ops']).find((d) => d.key === 'Development Tracker');
  assert.deepEqual(tracker.props.Module.select.options.map((o) => o.name), ['API', 'Web', 'Ops']);
});

test('every select option has a name and a color', () => {
  for (const d of databases(['X'])) {
    for (const prop of Object.values(d.props)) {
      if (!prop.select) continue;
      for (const o of prop.select.options) assert.ok(o.name && o.color, `option in ${d.key} missing name/color`);
    }
  }
});

test('manifestBlock nests entries under the project name', () => {
  const block = manifestBlock('Acme', 'https://ws', { 'Development Tracker': { kind: 'data_source', id: '1', purpose: 'p' } });
  assert.ok(block.projects.Acme);
  assert.equal(block.projects.Acme.workspace_url, 'https://ws');
  assert.equal(block.projects.Acme.entries['Development Tracker'].kind, 'data_source');
});

test('createWorkspace dry-run builds workspace + 5 dbs + 2 pages, creates nothing', async () => {
  const { entries, dryPayloads, workspaceUrl } = await createWorkspace({ name: 'Demo', goal: 'g', modules: ['A', 'B'], dryRun: true });
  assert.equal(dryPayloads.length, 8, '1 workspace page + 5 databases + 2 status pages');
  assert.equal(Object.keys(entries).length, 8);
  assert.equal(workspaceUrl, '', 'dry-run creates nothing, so no real url');
  const labels = dryPayloads.map((p) => p.label);
  assert.ok(labels[0].startsWith('page: Demo'), 'workspace page is created first');
  assert.ok(labels.includes('database: Development Tracker'));
  assert.ok(labels.includes('page: Implementation Progress'));
  assert.equal(entries['Development Tracker'].kind, 'data_source');
  assert.equal(entries['Architecture'].kind, 'page');
});
