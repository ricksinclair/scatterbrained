import { describe, it, expect } from 'vitest';
import { esc, trunc, rgba } from '../public/lib/dom.js';

describe('esc', () => {
  it('escapes the five HTML-special characters (text + quoted-attribute contexts)', () => {
    expect(esc('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    // quotes must not survive — esc() output is interpolated into quoted attributes
    expect(esc('" onmouseover="alert(1)')).not.toContain('"');
  });
  it('stringifies non-strings and leaves safe text alone', () => {
    expect(esc(42)).toBe('42');
    expect(esc('plain text — safe')).toBe('plain text — safe');
  });
});

describe('trunc', () => {
  it('passes short and exact-length strings through', () => {
    expect(trunc('abc', 5)).toBe('abc');
    expect(trunc('abcde', 5)).toBe('abcde');
  });
  it('cuts to n-1 chars + ellipsis when too long', () => {
    expect(trunc('abcdef', 5)).toBe('abcd…');
    expect(trunc('abcdef', 5)).toHaveLength(5);
  });
  it('maps null/undefined/empty to the empty string', () => {
    expect(trunc(null, 5)).toBe('');
    expect(trunc(undefined, 5)).toBe('');
    expect(trunc('', 5)).toBe('');
  });
});

describe('rgba', () => {
  it('formats an [r,g,b] triple + alpha', () => {
    expect(rgba([1, 2, 3], 0.5)).toBe('rgba(1,2,3,0.5)');
    expect(rgba([239, 154, 91], 1)).toBe('rgba(239,154,91,1)');
  });
});
