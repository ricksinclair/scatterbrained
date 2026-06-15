import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCandidate,
  buildChangelogProperties,
  changelogId,
} from '../scripts/write-back-decisions.js';

test('toCandidate seeds description with full_text (the prose seed to rewrite)', () => {
  const c = toCandidate(
    { project: 'Engram', insight_id: 'abc', summary: 'Short summary', full_text: 'The full why behind it.', created_at: '2026-06-14T00:00:00Z' },
    '2026-06-14'
  );
  assert.equal(c.project, 'Engram');
  assert.equal(c.insight_id, 'abc');
  assert.equal(c.description, 'The full why behind it.');
  assert.equal(c.date, '2026-06-14');
  assert.equal(c.version, 'Unreleased');
  assert.equal(c.type, 'docs');
});

test('toCandidate truncates an overlong summary into the Name', () => {
  const long = 'x'.repeat(120);
  const c = toCandidate({ project: 'P', insight_id: '1', summary: long, full_text: 'f', created_at: 't' }, '2026-06-14');
  assert.equal(c.name.length, 80);
  assert.ok(c.name.endsWith('…'));
});

test('buildChangelogProperties maps to the Notion Changelog schema', () => {
  const props = buildChangelogProperties({
    name: 'Ingest CHANGELOG.md by default',
    description: 'So review:decisions can credit it.',
    date: '2026-06-14',
    type: 'fix',
    version: 'Unreleased',
  });
  assert.equal(props.Name.title[0].text.content, 'Ingest CHANGELOG.md by default');
  assert.equal(props.Description.rich_text[0].text.content, 'So review:decisions can credit it.');
  assert.equal(props.Date.date.start, '2026-06-14');
  assert.equal(props.Type.select.name, 'fix');
  assert.equal(props.Version.rich_text[0].text.content, 'Unreleased');
});

test('buildChangelogProperties omits optional fields when absent', () => {
  const props = buildChangelogProperties({ name: 'N', description: 'D' });
  assert.ok(props.Name && props.Description);
  assert.ok(!('Date' in props) && !('Type' in props) && !('Version' in props));
});

test('buildChangelogProperties requires name + description', () => {
  assert.throws(() => buildChangelogProperties({ name: 'only name' }), /name, description/);
  assert.throws(() => buildChangelogProperties({}), /name, description/);
});

test('changelogId resolves from the manifest and errors when missing', () => {
  const manifest = { projects: { Engram: { entries: { Changelog: { kind: 'data_source', id: 'cl-123' } } } } };
  assert.equal(changelogId(manifest, 'Engram'), 'cl-123');
  assert.throws(() => changelogId(manifest, 'Nope'), /No Changelog id/);
  assert.throws(() => changelogId({ projects: {} }, 'Engram'), /No Changelog id/);
});
