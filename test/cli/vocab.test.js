import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_KINDS, SOURCE_KIND_LIST, FILE_BACKED_KINDS, isValidSourceKind } from '../../scripts/lib/vocab.js';

test('source_kind vocabulary is a non-empty closed set', () => {
  assert.ok(SOURCE_KIND_LIST.length > 0);
  assert.deepEqual(SOURCE_KIND_LIST, Object.keys(SOURCE_KINDS));
});

test('isValidSourceKind accepts known kinds, rejects unknown/empty', () => {
  assert.ok(isValidSourceKind('notion_page'));
  assert.ok(isValidSourceKind('markdown'));
  assert.ok(!isValidSourceKind('notion'), 'the old drifted value is rejected');
  assert.ok(!isValidSourceKind(''));
  assert.ok(!isValidSourceKind(null));
  assert.ok(!isValidSourceKind(undefined));
});

test('file-backed kinds are all part of the vocabulary', () => {
  for (const k of FILE_BACKED_KINDS) assert.ok(isValidSourceKind(k), `${k} should be a known source_kind`);
});
