import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rrfFuse } from '../../scripts/search.js';

test('rrfFuse ranks a both-lanes hit above any single-lane hit', () => {
  const keyword = [{ eid: 'A' }, { eid: 'B' }];
  const semantic = [{ eid: 'B' }, { eid: 'C' }];
  const fused = rrfFuse({ keyword, semantic });
  assert.equal(fused[0].eid, 'B', 'B is found by both lanes -> top');
  assert.deepEqual(Object.keys(fused[0].lanes).sort(), ['keyword', 'semantic']);
});

test('rrfFuse with a single lane preserves that lane order', () => {
  const fused = rrfFuse({ keyword: [{ eid: 'X' }, { eid: 'Y' }, { eid: 'Z' }] });
  assert.deepEqual(fused.map((f) => f.eid), ['X', 'Y', 'Z']);
});

test('rrfFuse handles empty / missing lanes', () => {
  assert.deepEqual(rrfFuse({}), []);
  assert.deepEqual(rrfFuse({ keyword: null, semantic: [] }), []);
});
