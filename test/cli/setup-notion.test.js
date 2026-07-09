import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databases, manifestBlock, createWorkspace } from '../../scripts/setup-notion.js';

test('databases() returns the 4 default databases (Problem Tests is opt-in), each with one title + a description', () => {
  const dbs = databases(['Backend', 'Frontend']);
  assert.equal(dbs.length, 4);
  const keys = dbs.map((d) => d.key);
  for (const k of ['Development Tracker', 'Documentation Index', 'Changelog', 'Test Run Metrics'])
    assert.ok(keys.includes(k), `missing database: ${k}`);
  assert.ok(!keys.includes('Problem Tests'), 'Problem Tests must NOT be scaffolded by default');
  for (const d of dbs) {
    const titles = Object.values(d.props).filter((p) => p.title);
    assert.equal(titles.length, 1, `${d.key} must have exactly one title property`);
    assert.ok(d.description && d.description.length > 20, `${d.key} must carry a human-facing description`);
  }
});

test('databases() includes Problem Tests only when opted in', () => {
  const optedIn = databases(['Backend'], { problemTests: true });
  assert.equal(optedIn.length, 5);
  assert.ok(optedIn.map((d) => d.key).includes('Problem Tests'));
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

test('createWorkspace dry-run builds workspace + 4 default dbs + 3 pages, creates nothing', async () => {
  const { entries, dryPayloads, workspaceUrl } = await createWorkspace({ name: 'Demo', goal: 'g', modules: ['A', 'B'], dryRun: true });
  assert.equal(dryPayloads.length, 8, '1 workspace page + 4 databases + 3 pages (Implementation Progress, Architecture, Capture)');
  assert.equal(Object.keys(entries).length, 8);
  assert.equal(workspaceUrl, '', 'dry-run creates nothing, so no real url');
  const labels = dryPayloads.map((p) => p.label);
  assert.ok(labels[0].startsWith('page: Demo'), 'workspace page is created first');
  assert.ok(labels.includes('database: Development Tracker'));
  assert.ok(!labels.includes('database: Problem Tests'), 'Problem Tests is opt-in, not scaffolded by default');
  assert.ok(labels.includes('page: Implementation Progress'));
  assert.ok(labels.includes('page: Capture'), 'capture page for ingestible notes');
  // The Changelog DB payload carries its human-facing description (written onto the Notion DB).
  const changelog = dryPayloads.find((p) => p.label === 'database: Changelog');
  assert.ok(changelog.body.description?.[0]?.text?.content?.length > 20, 'DB body includes a description');
  assert.equal(entries['Development Tracker'].kind, 'data_source');
  assert.equal(entries['Architecture'].kind, 'page');
  assert.equal(entries['Capture'].kind, 'page');
});

test('createWorkspace dry-run with --with-problem-tests adds the opt-in DB (9 payloads)', async () => {
  const { dryPayloads } = await createWorkspace({ name: 'Demo', goal: 'g', modules: ['A'], problemTests: true, dryRun: true });
  assert.equal(dryPayloads.length, 9);
  assert.ok(dryPayloads.map((p) => p.label).includes('database: Problem Tests'));
});
