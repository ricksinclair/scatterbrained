// symbols.js — heuristic call-site extraction, so the impact view answers "which FUNCTIONS
// call this file", not just "which files import it". Pure + dependency-free (no AST parser →
// no build; acorn can't read TS/Angular, tree-sitter is a build-step dep), unit-tested exactly
// as shipped.
//
// The reliability trick — roll our own source tokenizer. Regex-on-raw-source lies: it matches
// identifiers inside strings/comments and miscounts braces (`const s = "}"`). So `blankLiterals`
// first neutralises comments, strings, template literals and regex literals into same-length
// blanks (newlines + real code preserved), and everything else runs on that CLEAN skeleton —
// structurally sound, not a guess. It is still scoped BY THE IMPORT BINDING (we search only the
// exact local names an importer pulls from the target), which is what keeps it precise.
// Honest limits to surface: it sees direct named usages, not dynamic/namespace-member/aliased
// access, and function boundaries are brace-matched, not type-checked.

// Keywords after which a `/` begins a regex literal (operator position), not division.
const REGEX_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'case', 'throw']);

// Return `src` with every comment / string / template / regex literal replaced by spaces
// (newlines kept, length preserved so line numbers still map 1:1). The code skeleton — braces,
// identifiers, operators — is left intact. Template interpolations are blanked too (a documented
// gap: a call that appears ONLY inside `${…}` isn't counted); this keeps brace-matching correct.
export function blankLiterals(src) {
  src = String(src || '');
  const n = src.length;
  const out = src.split('');
  const blank = (k) => { if (k < n && out[k] !== '\n') out[k] = ' '; };
  let i = 0, prevRegexOk = true;   // prevRegexOk: can a `/` here start a regex?
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { blank(i); i++; } continue; }
    if (c === '/' && d === '*') { blank(i); blank(i + 1); i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; } blank(i); blank(i + 1); i += 2; prevRegexOk = true; continue; }
    if (c === '"' || c === "'") { blank(i); i++; while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; } blank(i); i++; } if (i < n && src[i] === c) { blank(i); i++; } prevRegexOk = false; continue; }
    if (c === '`') { i = blankTemplate(src, blank, i); prevRegexOk = false; continue; }
    if (c === '/' && prevRegexOk) {
      blank(i); i++; let inClass = false;
      while (i < n) { const e = src[i]; if (e === '\n') break; if (e === '\\') { blank(i); blank(i + 1); i += 2; continue; } if (e === '[') inClass = true; else if (e === ']') inClass = false; else if (e === '/' && !inClass) { blank(i); i++; break; } blank(i); i++; }
      while (i < n && /[a-z]/i.test(src[i])) { blank(i); i++; }   // flags
      prevRegexOk = false; continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; prevRegexOk = REGEX_KW.has(src.slice(i, j)); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; prevRegexOk = false; i = j; continue; }
    prevRegexOk = !(c === ')' || c === ']' || c === '}');   // division after a value/close, regex otherwise
    i++;
  }
  return out.join('');
}
function blankTemplate(src, blank, i) {
  const n = src.length; blank(i); i++; let depth = 0;
  while (i < n) {
    const c = src[i];
    if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
    if (depth === 0 && c === '`') { blank(i); return i + 1; }
    if (c === '$' && src[i + 1] === '{') { blank(i); blank(i + 1); depth++; i += 2; continue; }
    if (depth > 0 && c === '{') { blank(i); depth++; i++; continue; }
    if (depth > 0 && c === '}') { blank(i); depth--; i++; continue; }
    blank(i); i++;
  }
  return i;
}

// Local names an importer binds from each import statement + the module specifier. Handles named
// (`{a, b as c}`), default (`import d from`) and namespace (`* as ns`). Run on the ORIGINAL source
// (it needs the specifier string, which blankLiterals would erase).
export function parseImportBindings(text) {
  const src = String(text || '');
  const lineOf = offsetToLine(src);
  const out = [];
  const re = /import\s+([^;'"]*?)\s+from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const specifier = m[2] || m[3];
    const clause = m[1] || '';
    const names = [];
    const def = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def && !clause.trimStart().startsWith('{') && !clause.trimStart().startsWith('*')) names.push(def[1]);
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) names.push(ns[1]);
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) for (const part of braced[1].split(',')) {
      const t = part.trim(); if (!t) continue;
      const as = t.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      names.push(as ? as[1] : t.replace(/\s+as\s+.*/, '').trim());
    }
    out.push({ specifier, names: [...new Set(names.filter(Boolean))], line: lineOf(m.index) });
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Angular/DI reality: an imported TYPE is usually used only as a constructor/field annotation
// (`constructor(private authService: AuthService)`) and the real calls go through THAT instance
// (`this.authService.x()`). So capture the instance identifiers declared with an imported type,
// and search for those too — otherwise every call in an Angular component is missed. Returns
// [{ alias, type }] pairs (e.g. `authService` → `AuthService`); the type is kept so a member
// found via the alias can be attributed back to the imported symbol it belongs to.
export function instanceAliasPairs(text, typeNames) {
  if (!typeNames || !typeNames.length) return [];
  const clean = blankLiterals(text);
  const set = new Set(typeNames);
  const alt = typeNames.map(escapeRe).join('|');
  const out = new Map();
  let m;
  // classic DI + typed fields: `constructor(private auth: AuthService)` / `field: AuthService`
  const anno = new RegExp('([A-Za-z_$][\\w$]*)\\s*:\\s*(' + alt + ')(?![\\w$])', 'g');
  while ((m = anno.exec(clean))) if (set.has(m[2]) && m[1] !== m[2] && !out.has(m[1])) out.set(m[1], m[2]);
  // modern DI: `private readonly auth = inject(AuthService)` (Angular's inject() pattern)
  const inj = new RegExp('([A-Za-z_$][\\w$]*)\\s*=\\s*inject\\(\\s*(' + alt + ')(?![\\w$])', 'g');
  while ((m = inj.exec(clean))) if (set.has(m[2]) && m[1] !== m[2] && !out.has(m[1])) out.set(m[1], m[2]);
  return [...out].map(([alias, type]) => ({ alias, type }));
}
export const instanceAliases = (text, typeNames) => instanceAliasPairs(text, typeNames).map((p) => p.alias);

// Named function / method / arrow declarations with line ranges, brace-matched on the CLEAN
// skeleton (so string/comment braces never mislead). Control keywords are excluded; `constructor`
// is KEPT (it's a real function where dependencies are injected and often used).
const KEYWORD = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'do', 'else', 'with', 'await', 'typeof', 'in', 'of', 'new', 'case']);
export function functionRanges(text) {
  const clean = blankLiterals(text);
  const lineOf = offsetToLine(clean);
  const decls = [];
  const push = (name, from) => { const brace = clean.indexOf('{', from); if (brace >= 0) decls.push({ name, brace }); };
  let m;
  const fn = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  while ((m = fn.exec(clean))) push(m[1], m.index + m[0].length);
  const arrow = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::\s*[^={]+?)?=>\s*\{|[A-Za-z_$][\w$]*\s*=>\s*\{)/g;
  while ((m = arrow.exec(clean))) push(m[1], m.index + m[0].length - 1);
  const method = /(?:^|\n)[ \t]*(?:public |private |protected |static |readonly |async |get |set |\* )*([A-Za-z_$][\w$]*)\s*\([^;{}()]*\)\s*(?::\s*[^{;]+?)?\{/g;
  while ((m = method.exec(clean))) if (!KEYWORD.has(m[1])) push(m[1], m.index + m[0].length - 1);
  // class-field arrows with a block body: `handleClick = (e) => { … }` (common event handlers)
  const fieldArrow = /(?:^|\n)[ \t]*(?:public |private |protected |readonly |static |override |declare )*([A-Za-z_$][\w$]*)\s*(?::[^=;{]+)?=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^={]+?)?=>\s*\{/g;
  while ((m = fieldArrow.exec(clean))) push(m[1], m.index + m[0].length - 1);

  const ranges = [];
  for (const dcl of decls) { const end = matchBrace(clean, dcl.brace); if (end > dcl.brace) ranges.push({ name: dcl.name, startLine: lineOf(dcl.brace), endLine: lineOf(end) }); }
  return ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

// The innermost named function whose range contains `line`, or null (module scope).
export function enclosingFunction(ranges, line) {
  let best = null;
  for (const r of ranges) if (line >= r.startLine && line <= r.endLine) {
    if (!best || (r.endLine - r.startLine) < (best.endLine - best.startLine)) best = r;
  }
  return best ? best.name : null;
}

// Lines where any of `names` is used as an identifier (word boundary, not a `.property`),
// on the CLEAN skeleton (so strings/comments never produce a false hit). `skipLines` = import lines.
// With `members: true` each hit also carries `member` (the identifier accessed after the name —
// `auth.login()` → 'login', else null) and `call` (the name itself is invoked — `toast(…)`),
// so a call site can say WHICH part of the target it touches, not just that it touches it.
export function findUsages(text, names, { skipLines = new Set(), member = false, members = false } = {}) {
  if (!names || !names.length) return [];
  const clean = blankLiterals(text);
  const set = new Set(names);
  const pre = member ? '(?:this\\.)?' : '';
  const re = new RegExp('(^|[^.\\w$])' + pre + '(' + names.map(escapeRe).join('|') + ')(?![\\w$])(?:\\s*\\.\\s*([A-Za-z_$][\\w$]*))?(\\s*\\()?', 'g');
  const out = [];
  clean.split('\n').forEach((line, idx) => {
    const ln = idx + 1;
    if (skipLines.has(ln)) return;
    const seen = new Set();
    let m; re.lastIndex = 0;
    while ((m = re.exec(line))) {
      if (!set.has(m[2])) continue;
      const k = members ? m[2] + '.' + (m[3] || '') : m[2];   // with members, `svc.a` and `svc.b` on one line are distinct hits
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(members ? { name: m[2], line: ln, member: m[3] || null, call: !m[3] && !!m[4] } : { name: m[2], line: ln });
    }
  });
  return out;
}

// Combine: call sites of `names` grouped by enclosing function →
// [{ fn, lines:[n], symbols:[…], members:[{ name, kind, lines }] }] sorted by first line
// (`fn` null = module scope). `skipLines` = the import-statement lines. A member is WHAT of the
// target this function touches: `auth.login()` → login (kind 'call'), a direct `toast(…)` →
// toast, while a bare type/DI reference (`x: AuthService`, providers array) attributes to the
// imported symbol itself with kind 'type' — so DI plumbing never masquerades as a real call.
export function callSites(text, names, skipLines = new Set()) {
  const ranges = functionRanges(text);
  const pairs = instanceAliasPairs(text, names);   // DI instances (this.authService) declared with these types
  const aliasType = new Map(pairs.map((p) => [p.alias, p.type]));
  const uses = [
    ...findUsages(text, names, { skipLines, members: true }),
    ...(pairs.length ? findUsages(text, [...aliasType.keys()], { skipLines, member: true, members: true }) : []),
  ];
  const lineTexts = blankLiterals(text).split('\n');
  const byFn = new Map();
  for (const u of uses) {
    // Enclosing named function; else the class member this line declares (`isAdmin = computed(…)`),
    // so expression-bodied field arrows (Angular computed/effect) read as their member, not "module".
    const fn = enclosingFunction(ranges, u.line) || memberAt(lineTexts[u.line - 1] || '');
    const k = fn || '(module)';
    if (!byFn.has(k)) byFn.set(k, { fn, lines: [], symbols: new Set(), members: new Map() });
    const e = byFn.get(k); e.lines.push(u.line); e.symbols.add(aliasType.get(u.name) || u.name);
    // Resolve the touched member: explicit `.member`, a direct call of the binding, or the
    // symbol itself as a type reference. 'call' wins over 'type' when a member sees both.
    const mm = u.member ? { name: u.member, kind: 'call' }
      : { name: aliasType.get(u.name) || u.name, kind: u.call ? 'call' : 'type' };
    const cur = e.members.get(mm.name);
    if (!cur) e.members.set(mm.name, { name: mm.name, kind: mm.kind, lines: [u.line] });
    else { if (mm.kind === 'call') cur.kind = 'call'; if (!cur.lines.includes(u.line)) cur.lines.push(u.line); }
  }
  return [...byFn.values()]
    .map((e) => ({ fn: e.fn, lines: [...new Set(e.lines)].sort((a, b) => a - b), symbols: [...e.symbols], members: [...e.members.values()] }))
    .sort((a, b) => a.lines[0] - b.lines[0]);
}

// ── helpers ──
// The class member a single line declares (`private readonly isAdmin = …` / `foo: T`), or null.
// Used to label a usage that sits in a field initializer rather than a named function body.
const MEMBER_MOD = new Set(['public', 'private', 'protected', 'readonly', 'static', 'override', 'declare', 'abstract', 'async', 'get', 'set']);
function memberAt(lineText) {
  const m = /^\s*((?:(?:public|private|protected|readonly|static|override|declare|abstract|async|get|set)\s+)*)([A-Za-z_$][\w$]*)\s*[:=]/.exec(lineText || '');
  if (!m) return null;
  const name = m[2];
  return MEMBER_MOD.has(name) ? null : name;   // guard: a bare modifier isn't a member name
}
function offsetToLine(src) {
  const nl = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') nl.push(i + 1);
  return (offset) => { let lo = 0, hi = nl.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nl[mid] <= offset) lo = mid; else hi = mid - 1; } return lo + 1; };
}
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return i; } }
  return -1;
}
