import { describe, it, expect } from 'vitest';
import { highlightCode, jsonDepths } from '../public/lib/codehl.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('codehl — lexical highlighter', () => {
  it('highlights JS keywords, strings, numbers, line comments', () => {
    const h = highlightCode('const x = 42; // note', 'js', esc);
    expect(h).toContain('<span class="hl-kw">const</span>');
    expect(h).toContain('<span class="hl-num">42</span>');
    expect(h).toContain('<span class="hl-com">// note</span>');
  });

  it('highlights strings (single/double/template)', () => {
    expect(highlightCode('let s = "hi"', 'js', esc)).toContain('<span class="hl-str">"hi"</span>');
    expect(highlightCode("x = 'a'", 'js', esc)).toContain("<span class=\"hl-str\">'a'</span>");
    expect(highlightCode('y = `t`', 'js', esc)).toContain('<span class="hl-str">`t`</span>');
  });

  it('treats # as a comment only for hash-comment langs (py), not js', () => {
    expect(highlightCode('x = 1 # py comment', 'py', esc)).toContain('<span class="hl-com"># py comment</span>');
    // in js, # is not a line comment → not highlighted as a comment
    expect(highlightCode('a # b', 'js', esc)).not.toContain('hl-com');
  });

  it('marks types distinctly from keywords (ts)', () => {
    const h = highlightCode('let n: number', 'ts', esc);
    expect(h).toContain('<span class="hl-kw">let</span>');
    expect(h).toContain('<span class="hl-type">number</span>');
  });

  it('distinguishes function calls, members, classes, and constants (One Dark style)', () => {
    const h = highlightCode('UserService.getById(MAX_ID)', 'js', esc);
    expect(h).toContain('<span class="hl-type">UserService</span>');   // Capitalized → class/type
    expect(h).toContain('<span class="hl-fn">getById</span>');         // method call (foo()
    expect(h).toContain('<span class="hl-const">MAX_ID</span>');       // SCREAMING_SNAKE → constant
    // a plain member access (no call) → hl-prop
    expect(highlightCode('a.length', 'js', esc)).toContain('<span class="hl-prop">length</span>');
    // a plain local variable stays default-colored (no span)
    const local = highlightCode('foo + bar', 'js', esc);
    expect(local).not.toContain('hl-fn');
    expect(local).not.toContain('hl-prop');
  });

  it('escapes source so it never emits raw HTML', () => {
    const h = highlightCode('const a = b < c && d > e;', 'js', esc);
    expect(h).toContain('&lt;');
    expect(h).toContain('&gt;');
    expect(h).not.toContain('<c');           // the literal "< c" must be escaped
  });

  it('non-token text and unknown identifiers pass through escaped, unwrapped', () => {
    const h = highlightCode('foo.bar(baz)', 'js', esc);
    expect(h).toContain('foo');              // plain identifiers not keyword-wrapped
    expect(h).not.toContain('hl-kw');
  });

  it('handles empty / null input', () => {
    expect(highlightCode('', 'js', esc)).toBe('');
    expect(highlightCode(null, 'js', esc)).toBe('');
  });
});

describe('codehl — JSON keys tinted by depth', () => {
  it('jsonDepths tracks nesting at line start, ignoring braces in strings', () => {
    const text = '{\n  "a": {\n    "b": 1\n  },\n  "c": "x{y}z"\n}';
    expect(jsonDepths(text)).toEqual([0, 1, 2, 2, 1, 1]);   // line 5 stays depth 1 despite { } in the string
  });
  it('colors a key per its depth and a value string as a plain string', () => {
    expect(highlightCode('"a": 1', 'json', esc, 0)).toContain('<span class="hl-key hl-key-0">"a"</span>');
    expect(highlightCode('"b": 2', 'json', esc, 1)).toContain('hl-key-1');
    expect(highlightCode('"k": "v"', 'json', esc, 0)).toContain('<span class="hl-str">"v"</span>');  // value, not key
    expect(highlightCode('"x": true', 'json', esc, 0)).toContain('<span class="hl-kw">true</span>');
  });
  it('cycles key colors past the level count', () => {
    expect(highlightCode('"z": 1', 'json', esc, 5)).toContain('hl-key-0');   // 5 % 5
    expect(highlightCode('"z": 1', 'json', esc, 7)).toContain('hl-key-2');
  });
});
