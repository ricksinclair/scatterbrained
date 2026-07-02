import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureRequest, looksLikeUrl, studioBaseUrl } from '../../lib/cli-capture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = path.join(root, 'bin/scatterbrained.js');

test('help lists exactly the three published commands', () => {
  const out = execFileSync('node', [bin, 'help'], { encoding: 'utf8' });
  for (const c of ['studio', 'capture', 'status']) assert.match(out, new RegExp(`\\b${c}\\b`));
  // and points repo-clone users at the full toolkit via npm run
  assert.match(out, /npm run/);
});

test('help does NOT advertise the removed toolkit commands as bin subcommands', () => {
  const out = execFileSync('node', [bin, 'help'], { encoding: 'utf8' });
  // these live under `npm run <x>` now, not as `scatterbrained <x>` — the usage
  // block must not present them as top-level commands.
  for (const c of ['lint', 'resume', 'search', 'new-project', 'setup-notion', 'supersede']) {
    assert.doesNotMatch(out, new RegExp(`^  ${c}\\b`, 'm'), `\`${c}\` should not be a bin command`);
  }
});

test('an unknown command exits non-zero', () => {
  assert.throws(() => execFileSync('node', [bin, 'definitely-not-a-command'], { stdio: 'pipe' }));
});

test('removed toolkit commands are no longer dispatched by the bin', () => {
  // `lint` used to be a subcommand; it must now be rejected as unknown.
  assert.throws(() => execFileSync('node', [bin, 'lint'], { stdio: 'pipe' }));
});

test('looksLikeUrl: http(s) only', () => {
  assert.equal(looksLikeUrl('https://example.com'), true);
  assert.equal(looksLikeUrl('http://example.com/x?y=1'), true);
  assert.equal(looksLikeUrl('  https://example.com  '), true);
  assert.equal(looksLikeUrl('a plain note'), false);
  assert.equal(looksLikeUrl('file:///etc/passwd'), false);
  assert.equal(looksLikeUrl('ftp://host/x'), false);
  assert.equal(looksLikeUrl(''), false);
});

test('captureRequest: URL routes to /api/link', () => {
  const r = captureRequest('https://example.com/post');
  assert.equal(r.path, '/api/link');
  assert.deepEqual(r.body, { url: 'https://example.com/post' });
});

test('captureRequest: text routes to /api/note (trimmed, unanchored)', () => {
  const r = captureRequest('  remember the milk  ');
  assert.equal(r.path, '/api/note');
  assert.deepEqual(r.body, { text: 'remember the milk' });
});

test('captureRequest: text with --on target anchors the note', () => {
  const r = captureRequest('a thought', { target: '4:abc:12' });
  assert.equal(r.path, '/api/note');
  assert.deepEqual(r.body, { text: 'a thought', target: '4:abc:12' });
});

test('captureRequest: empty input is an error', () => {
  assert.ok(captureRequest('').error);
  assert.ok(captureRequest('   ').error);
});

test('studioBaseUrl: default and STUDIO_PORT override, loopback host', () => {
  assert.equal(studioBaseUrl({}), 'http://127.0.0.1:4317');
  assert.equal(studioBaseUrl({ STUDIO_PORT: '5000' }), 'http://127.0.0.1:5000');
});
