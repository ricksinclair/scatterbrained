import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { hashText, validateSave, gitArgs, parseLog, commitMessage } from '../lib/save.js';

const ROOTS = ['/Users/rick/Projects/notes'];

describe('save — hashText matches document-index.js', () => {
  it('is sha256 over the exact UTF-8 bytes (no newline munging)', () => {
    const text = '# Title\n\nbody — with em dash\n';
    const ref = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    expect(hashText(text)).toBe(ref);
  });
  it('distinguishes CRLF from LF (so saves never silently rewrite line endings undetected)', () => {
    expect(hashText('a\r\nb')).not.toBe(hashText('a\nb'));
  });
});

describe('save — validateSave matrix', () => {
  const base = { path: '/Users/rick/Projects/notes/x.md', text: 'hi', roots: ROOTS, maxBytes: 1000 };
  it('accepts a markdown file inside a root', () => expect(validateSave(base).ok).toBe(true));
  it('rejects a path outside the sandbox', () =>
    expect(validateSave({ ...base, path: '/etc/passwd.md' }).error).toMatch(/sandbox/));
  it('rejects non-markdown (markdown-only scope)', () =>
    expect(validateSave({ ...base, path: '/Users/rick/Projects/notes/x.txt' }).error).toMatch(/markdown/));
  it('rejects oversize content', () =>
    expect(validateSave({ ...base, text: 'x'.repeat(2000), maxBytes: 1000 }).error).toMatch(/too large/));
  it('rejects a non-string body', () => expect(validateSave({ ...base, text: null }).error).toMatch(/text required/));
});

describe('save — git argv shapes', () => {
  it('commits a single file with --no-verify and a pathspec', () => {
    expect(gitArgs.commit('/repo', 'studio: edit a.md', '/repo/a.md'))
      .toEqual(['-C', '/repo', 'commit', '--no-verify', '-m', 'studio: edit a.md', '--', '/repo/a.md']);
  });
  it('add is scoped to the one file', () =>
    expect(gitArgs.add('/repo', '/repo/a.md')).toEqual(['-C', '/repo', 'add', '--', '/repo/a.md']));
  it('status is porcelain + path-scoped (dirty detection)', () =>
    expect(gitArgs.status('/repo', '/repo/a.md')).toEqual(['-C', '/repo', 'status', '--porcelain', '--', '/repo/a.md']));
  it('show addresses rev:relpath', () =>
    expect(gitArgs.show('/repo', 'docs/a.md', 'abc123')).toEqual(['-C', '/repo', 'show', 'abc123:docs/a.md']));
  it('log uses unit-separated machine format', () => {
    const a = gitArgs.log('/repo', '/repo/a.md', 10);
    expect(a).toContain('--max-count=10');
    expect(a.join(' ')).toContain('%H%x1f%cI%x1f%s');
  });
});

describe('save — parseLog + commitMessage', () => {
  it('parses unit-separated log lines, keeping spaced subjects', () => {
    const US = '\x1f';
    const out = `abc${US}2026-06-17T12:00:00Z${US}studio: edit a.md\ndef${US}2026-06-16T09:00:00Z${US}studio: restore a.md to abc\n`;
    const rows = parseLog(out);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ rev: 'abc', date: '2026-06-17T12:00:00Z', subject: 'studio: edit a.md' });
    expect(rows[1].subject).toBe('studio: restore a.md to abc');
  });
  it('ignores blank lines', () => expect(parseLog('\n\n')).toEqual([]));
  it('builds edit + restore messages', () => {
    expect(commitMessage('docs/a.md')).toBe('studio: edit docs/a.md');
    expect(commitMessage('docs/a.md', 'restore', 'abc123')).toBe('studio: restore docs/a.md to abc123');
  });
});
