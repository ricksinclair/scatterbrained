import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStructural, flatten } from '../../scripts/check-notion.js';

const valid = { projects: { Acme: { entries: {
  Tracker: { kind: 'data_source', id: '78ff3733-454e-4cfc-bc08-00b4f523a91e' },
  Hub: { kind: 'page', id: '2eebe7d1114381acb1f4d1ba2bc3a2c9' },
} } } };

test('a valid manifest has no structural problems', () => {
  assert.deepEqual(validateStructural(valid), []);
});

test('an invalid kind is flagged', () => {
  const m = { projects: { A: { entries: { X: { kind: 'collection', id: '2eebe7d1114381acb1f4d1ba2bc3a2c9' } } } } };
  const probs = validateStructural(m);
  assert.equal(probs.length, 1);
  assert.match(probs[0].issue, /kind must be/);
});

test('a malformed id is flagged', () => {
  const m = { projects: { A: { entries: { X: { kind: 'page', id: 'not-a-uuid' } } } } };
  assert.ok(validateStructural(m).some((p) => /not a valid Notion UUID/.test(p.issue)));
});

test('a duplicate id is flagged', () => {
  const id = '2eebe7d1114381acb1f4d1ba2bc3a2c9';
  const m = { projects: { A: { entries: { X: { kind: 'page', id }, Y: { kind: 'page', id } } } } };
  assert.ok(validateStructural(m).some((p) => /duplicate id/.test(p.issue)));
});

test('flatten honors the onlyProject filter', () => {
  const m = { projects: { A: { entries: { X: { kind: 'page', id: '1' } } }, B: { entries: { Y: { kind: 'page', id: '2' } } } } };
  assert.equal(flatten(m, 'A').length, 1);
  assert.equal(flatten(m).length, 2);
});
