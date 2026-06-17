import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_SIGNALS,
  ALL_SIGNAL_PROPS,
  signalsFor,
  candidateSignals,
  normalizeKey,
  keysLookAlike,
} from '../scripts/lib/identity.js';

test('every identity signal list is a non-empty array of strings', () => {
  for (const [label, props] of Object.entries(IDENTITY_SIGNALS)) {
    assert.ok(Array.isArray(props) && props.length > 0, `${label} has signals`);
    for (const p of props) assert.equal(typeof p, 'string');
  }
});

test('ALL_SIGNAL_PROPS is the de-duplicated union of every label signal', () => {
  const union = new Set(Object.values(IDENTITY_SIGNALS).flat());
  assert.deepEqual([...ALL_SIGNAL_PROPS].sort(), [...union].sort());
  assert.equal(ALL_SIGNAL_PROPS.length, union.size, 'no duplicates');
});

test('signalsFor returns a label\'s props, or [] for an unconfigured label', () => {
  assert.deepEqual(signalsFor('Project'), IDENTITY_SIGNALS.Project);
  assert.deepEqual(signalsFor('Insight'), []);
  assert.deepEqual(signalsFor('Nonexistent'), []);
});

test('candidateSignals keeps only configured props with non-empty values', () => {
  const got = candidateSignals('Project', {
    repo_url: 'https://github.com/x/y',
    file_path: '   ',          // blank -> dropped
    notion_url: null,          // null  -> dropped
    description: 'ignored',    // not a signal -> dropped
  });
  assert.deepEqual(got, [{ prop: 'repo_url', value: 'https://github.com/x/y' }]);
});

test('normalizeKey trims, lowercases, and collapses whitespace', () => {
  assert.equal(normalizeKey('  Personal   SITE  '), 'personal site');
  assert.equal(normalizeKey(null), '');
  assert.equal(normalizeKey(undefined), '');
});

test('keysLookAlike catches the containment case that bit ulrictodman.com', () => {
  assert.ok(keysLookAlike('ulrictodman.com', 'Personal Site (ulrictodman.com)'));
  assert.ok(keysLookAlike('Scatterbrained', 'scatterbrained')); // case-insensitive exact
  assert.ok(keysLookAlike('  Scatterbrained ', 'scatterbrained'));
});

test('keysLookAlike does not over-match on trivial/short overlaps', () => {
  assert.ok(!keysLookAlike('Helios', 'Borealis'));
  assert.ok(!keysLookAlike('a', 'about page'), 'shorter side must clear minLen');
  assert.ok(!keysLookAlike('', 'anything'));
});
