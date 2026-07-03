import { describe, it, expect } from 'vitest';
import { parseImportBindings, functionRanges, enclosingFunction, findUsages, callSites, blankLiterals } from '../public/lib/symbols.js';

describe('blankLiterals — the tokenizer that makes the rest reliable', () => {
  it('blanks strings/comments/templates/regex but keeps code + length + newlines', () => {
    const src = "const s = '}';\n// svc.foo() in a comment\nconst r = /a{b}/;\nsvc.real();";
    const out = blankLiterals(src);
    expect(out.length).toBe(src.length);                 // same length → offsets/lines map 1:1
    expect(out.split('\n').length).toBe(4);              // newlines preserved
    expect(out).not.toMatch(/[{}]/);                      // every brace here is inside a string/regex
    expect(out).toContain('const s =');                  // real code survives
    expect(out).toContain('svc');                         // the real call on the last line survives
    expect(out).not.toContain('foo');                     // the comment's svc.foo() is gone
  });
  it('neutralises braces INSIDE strings (the brace-matching killer)', () => {
    // The `}` inside the string must not close the function early.
    const src = 'function f() {\n  const s = "}";\n  use();\n}';
    const r = functionRanges(src);
    expect(r).toEqual([{ name: 'f', startLine: 1, endLine: 4 }]);   // ends at line 4, not the string
  });
  it('does not match an identifier that only appears in a string or comment', () => {
    const src = 'function f() {\n  const msg = "call svc here";  // svc note\n  return 1;\n}';
    expect(findUsages(src, ['svc'])).toEqual([]);          // svc only in a string + comment → no hit
  });
  it('does not treat a regex literal body as code', () => {
    const src = 'function f() {\n  const re = /svc}{/;\n  svc.go();\n}';
    expect(functionRanges(src)).toEqual([{ name: 'f', startLine: 1, endLine: 4 }]);  // regex braces ignored
    expect(findUsages(src, ['svc'])).toEqual([{ name: 'svc', line: 3 }]);            // only the real call
  });
});

describe('parseImportBindings', () => {
  it('binds named, aliased, default and namespace imports to their LOCAL names', () => {
    const src = [
      "import { foo, bar as baz } from './x';",
      "import Thing from './thing';",
      "import * as ns from './ns';",
      "import './side-effect';",
    ].join('\n');
    const b = parseImportBindings(src);
    expect(b.find((e) => e.specifier === './x').names.sort()).toEqual(['baz', 'foo']);
    expect(b.find((e) => e.specifier === './thing').names).toEqual(['Thing']);
    expect(b.find((e) => e.specifier === './ns').names).toEqual(['ns']);
    expect(b.find((e) => e.specifier === './side-effect').names).toEqual([]);
    expect(b.find((e) => e.specifier === './x').line).toBe(1);
  });
});

describe('functionRanges + enclosingFunction', () => {
  const src = [
    'function alpha() {',            // 1
    '  return use(1);',              // 2
    '}',                            // 3
    'const beta = (x) => {',        // 4
    '  return x + use(2);',         // 5
    '};',                          // 6
    'class C {',                    // 7
    '  gamma(a: number): void {',   // 8
    '    use(3);',                  // 9
    '  }',                         // 10
    '}',                           // 11
  ].join('\n');
  it('detects function decls, arrow consts and class methods with line ranges', () => {
    const r = functionRanges(src);
    const names = r.map((x) => x.name).sort();
    expect(names).toEqual(['alpha', 'beta', 'gamma']);
    expect(r.find((x) => x.name === 'alpha')).toMatchObject({ startLine: 1, endLine: 3 });
    expect(r.find((x) => x.name === 'gamma')).toMatchObject({ startLine: 8, endLine: 10 });
  });
  it('maps a line to its innermost enclosing function', () => {
    const r = functionRanges(src);
    expect(enclosingFunction(r, 2)).toBe('alpha');
    expect(enclosingFunction(r, 5)).toBe('beta');
    expect(enclosingFunction(r, 9)).toBe('gamma');
    expect(enclosingFunction(r, 7)).toBe(null);   // `class C {` line — module scope
  });
  it('does not mistake control-flow blocks for functions', () => {
    const r = functionRanges('function f() {\n  if (x) {\n    y();\n  }\n}');
    expect(r.map((x) => x.name)).toEqual(['f']);
  });
});

describe('findUsages', () => {
  const src = [
    "import { auth } from './auth';",   // 1 (import line — skipped)
    'function login() {',               // 2
    '  return auth.check();',           // 3  ← use
    '}',                               // 4
    'const x = obj.auth;',              // 5  ← property access, NOT the import
    '// auth here is a comment',        // 6  ← comment, skipped
  ].join('\n');
  it('finds identifier uses, skipping property access, comments and the import line', () => {
    const uses = findUsages(src, ['auth'], { skipLines: new Set([1]) });
    expect(uses).toEqual([{ name: 'auth', line: 3 }]);
  });
});

describe('callSites — the end-to-end "which functions call it"', () => {
  it('groups call sites by enclosing function with line numbers', () => {
    const importer = [
      "import { svc } from './svc';",         // 1
      'export class Page {',                  // 2
      '  load() {',                           // 3
      '    return svc.fetch();',              // 4
      '  }',                                  // 5
      '  save(v) {',                          // 6
      '    svc.put(v);',                      // 7
      '    return svc.ok;',                   // 8
      '  }',                                  // 9
      '}',                                    // 10
    ].join('\n');
    const cs = callSites(importer, ['svc'], new Set([1]));
    expect(cs).toEqual([
      { fn: 'load', lines: [4], symbols: ['svc'], members: [{ name: 'fetch', kind: 'call', lines: [4] }] },
      { fn: 'save', lines: [7, 8], symbols: ['svc'], members: [{ name: 'put', kind: 'call', lines: [7] }, { name: 'ok', kind: 'call', lines: [8] }] },
    ]);
  });
  it('resolves Angular DI: a type imported for `constructor(private x: T)` → calls via `this.x`', () => {
    const component = [
      "import { AuthService } from '../core/auth.service';",   // 1
      'export class LoginComponent {',                          // 2
      '  constructor(private auth: AuthService) {}',            // 3
      '  submit() {',                                           // 4
      '    return this.auth.login();',                          // 5
      '  }',                                                    // 6
      '  logout() {',                                           // 7
      '    this.auth.clear();',                                 // 8
      '  }',                                                    // 9
      '}',                                                      // 10
    ].join('\n');
    const cs = callSites(component, ['AuthService'], new Set([1]));
    const fns = cs.map((c) => c.fn);
    expect(fns).toContain('submit');     // this.auth.login() → submit()
    expect(fns).toContain('logout');     // this.auth.clear() → logout()
    expect(cs.find((c) => c.fn === 'submit').lines).toContain(5);
    expect(cs.find((c) => c.fn === 'logout').lines).toContain(8);
  });
  it('resolves modern Angular inject() DI: `auth = inject(AuthService)` → calls via `this.auth`', () => {
    const component = [
      "import { AuthService } from '../core/auth.service';",   // 1
      'export class LoginComponent {',                          // 2
      '  private readonly auth = inject(AuthService);',         // 3
      '  submit() {',                                           // 4
      '    return this.auth.login();',                          // 5
      '  }',                                                    // 6
      '}',                                                      // 7
    ].join('\n');
    const cs = callSites(component, ['AuthService'], new Set([1]));
    expect(cs.map((c) => c.fn)).toContain('submit');
    expect(cs.find((c) => c.fn === 'submit').lines).toContain(5);
  });
  it('labels module-scope uses with fn=null', () => {
    const importer = "import { K } from './k';\nconst v = K * 2;";
    const cs = callSites(importer, ['K'], new Set([1]));
    expect(cs).toEqual([{ fn: null, lines: [2], symbols: ['K'], members: [{ name: 'K', kind: 'type', lines: [2] }] }]);
  });
});

describe('member extraction — WHICH part of the target a call site touches', () => {
  it('captures the member after a binding or DI alias (`this.auth.login()` → login)', () => {
    const component = [
      "import { AuthService } from '../core/auth.service';",   // 1
      'export class LoginComponent {',                          // 2
      '  constructor(private auth: AuthService) {}',            // 3
      '  submit() {',                                           // 4
      '    return this.auth.login();',                          // 5
      '  }',                                                    // 6
      '}',                                                      // 7
    ].join('\n');
    const cs = callSites(component, ['AuthService'], new Set([1]));
    const submit = cs.find((c) => c.fn === 'submit');
    expect(submit.members).toEqual([{ name: 'login', kind: 'call', lines: [5] }]);
    // the constructor's bare annotation is DI plumbing → the type itself, kind 'type', not a call
    const ctor = cs.find((c) => c.fn === 'constructor');
    expect(ctor.members).toEqual([{ name: 'AuthService', kind: 'type', lines: [3] }]);
  });
  it('a direct invocation of the binding IS the member (`toast(…)` → toast, kind call)', () => {
    const src = "import { toast } from './ui';\nfunction warn() {\n  toast('hi');\n}";
    const cs = callSites(src, ['toast'], new Set([1]));
    expect(cs[0].members).toEqual([{ name: 'toast', kind: 'call', lines: [3] }]);
  });
  it('static/namespace member access resolves to the member (`Foo.bar()` → bar, `ns.helper()` → helper)', () => {
    const src = "import Foo from './foo';\nimport * as ns from './ns';\nfunction go() {\n  Foo.bar();\n  ns.helper();\n}";
    const cs = callSites(src, ['Foo'], new Set([1, 2]));
    expect(cs[0].members).toEqual([{ name: 'bar', kind: 'call', lines: [4] }]);
    const ns = callSites(src, ['ns'], new Set([1, 2]));
    expect(ns[0].members).toEqual([{ name: 'helper', kind: 'call', lines: [5] }]);
  });
  it('distinct members on ONE line are all captured; call beats type when both occur', () => {
    const src = "import { svc } from './s';\nfunction f() {\n  svc.a(); svc.b();\n  register(svc);\n  svc.a();\n}";
    const cs = callSites(src, ['svc'], new Set([1]));
    const names = cs[0].members.map((m) => m.name).sort();
    expect(names).toEqual(['a', 'b', 'svc']);                       // a, b called; bare `svc` passed as a value
    expect(cs[0].members.find((m) => m.name === 'a').lines).toEqual([3, 5]);
    expect(cs[0].members.find((m) => m.name === 'svc').kind).toBe('type');
  });
  it('findUsages members:true reports member + call flags without changing the default shape', () => {
    const src = "const x = auth.login();\nconst t = toast('x');\nconst y: AuthService = z;";
    expect(findUsages(src, ['auth'], { members: true })).toEqual([{ name: 'auth', line: 1, member: 'login', call: false }]);
    expect(findUsages(src, ['toast'], { members: true })).toEqual([{ name: 'toast', line: 2, member: null, call: true }]);
    expect(findUsages(src, ['AuthService'], { members: true })).toEqual([{ name: 'AuthService', line: 3, member: null, call: false }]);
    expect(findUsages(src, ['auth'])).toEqual([{ name: 'auth', line: 1 }]);   // legacy shape untouched
  });
});
