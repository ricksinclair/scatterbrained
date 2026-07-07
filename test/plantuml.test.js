import { describe, it, expect, beforeEach } from 'vitest';
import { composeDocument, parseError, render, cacheKey, clearCache, available, FORBIDDEN_RE, INPUT_CAP, sentinelThemeBody } from '../lib/plantuml.js';

// execImpl stub: pretends to be a healthy plantuml that echoes an SVG.
const okExec = (calls = []) => async (args, input, opts) => {
  calls.push({ args, input, opts });
  return { code: 0, stdout: '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect fill="#0A0B04"/></svg>', stderr: '' };
};

describe('plantuml — composeDocument', () => {
  it('wraps bare source in @startuml and inlines the theme (never !include)', () => {
    const doc = composeDocument('A -> B: hi', 'THEME');
    expect(doc.startsWith('@startuml\nTHEME\n')).toBe(true);
    expect(doc.endsWith('@enduml')).toBe(true);
    expect(doc).not.toContain('!include');
  });
  it('injects the theme right after an existing @start line (any dialect)', () => {
    const doc = composeDocument('@startmindmap\n* root\n@endmindmap', 'THEME');
    expect(doc).toMatch(/^@startmindmap\nTHEME\n\* root/);
  });
  it('the real sentinel theme body is available for injection', () => {
    expect(sentinelThemeBody()).toContain('#0A0B01');
  });
});

describe('plantuml — pre-flight security rejects (belt AND suspenders)', () => {
  for (const bad of ['!include /etc/passwd', '!import foo', '!theme mars', '%load("x")', '  %read("y")']) {
    it(`rejects user source containing ${bad.trim().split(/[ (]/)[0]}`, async () => {
      const r = await render(`@startuml\n${bad}\nA->B\n@enduml`, { execImpl: okExec() });
      expect(r.error).toContain('includes are disabled');
      expect(r.svg).toBeUndefined();
    });
  }
  it('does not false-positive on a "!" mid-line or in a label', async () => {
    expect(FORBIDDEN_RE.test('A -> B: really!\nnote right: includes are fine as words')).toBe(false);
  });
  it('caps input size', async () => {
    const r = await render('A'.repeat(INPUT_CAP + 1), { execImpl: okExec() });
    expect(r.error).toContain('too large');
  });
});

describe('plantuml — render lane (mocked exec)', () => {
  beforeEach(() => clearCache());
  it('renders via -tsvg -pipe -Playout=smetana with source on stdin', async () => {
    const calls = [];
    const r = await render('A -> B: hello', { execImpl: okExec(calls) });
    expect(r.svg).toContain('<svg');
    expect(calls[0].args).toEqual(['-tsvg', '-pipe', '-Playout=smetana']);
    expect(calls[0].input).toContain('A -> B: hello');   // stdin, never argv/shell
  });
  it('applies postProcess before caching, and serves the cache on repeat', async () => {
    const calls = [];
    const post = (s) => s.replace('#0A0B04', 'var(--accent)');
    const a = await render('A -> B', { execImpl: okExec(calls), postProcess: post });
    const b = await render('A -> B', { execImpl: okExec(calls), postProcess: post });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(b.svg).toContain('var(--accent)');
    expect(calls.length).toBe(1);   // second hit never spawned
  });
  it('cache key is stable for identical source', () => {
    expect(cacheKey('X')).toBe(cacheKey('X'));
    expect(cacheKey('X')).not.toBe(cacheKey('Y'));
  });
  it('surfaces structured errors with the line number', async () => {
    const badExec = async () => ({ code: 200, stdout: '', stderr: 'ERROR\n3\nSyntax Error: bad arrow' });
    const r = await render('A ->> ?? B', { execImpl: badExec });
    expect(r.error).toContain('Syntax Error');
    expect(r.line).toBe(3);
  });
  it('handles a missing plantuml binary as a plain error', async () => {
    const noExec = async () => ({ code: -1, stdout: '', stderr: 'spawn plantuml ENOENT' });
    const r = await render('A -> B', { execImpl: noExec });
    expect(r.error).toBeTruthy();
  });
});

describe('plantuml — availability probe', () => {
  it('parses the version and memoizes; refresh re-probes', async () => {
    let n = 0;
    const exec = async () => { n++; return { code: 0, stdout: 'PlantUML version 1.2026.6 / xyz', stderr: '' }; };
    const a = await available({ refresh: true, execImpl: exec });
    const b = await available({ execImpl: exec });
    expect(a).toEqual({ ok: true, version: '1.2026.6' });
    expect(b.ok).toBe(true);
    expect(n).toBe(1);
    const down = await available({ refresh: true, execImpl: async () => ({ code: -1, stdout: '', stderr: '' }) });
    expect(down.ok).toBe(false);
  });
});
