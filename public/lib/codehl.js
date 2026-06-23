// codehl.js — a tiny, zero-dep, lexical syntax highlighter for the code-review viewer.
// Not a language server (that's deliberately out of scope, see SPEC-code-review.md) —
// just a reading aid: per-line tokenizing of comments / strings / numbers / keywords /
// types, in keeping with the project's hand-rolled, local-first ethos (cf. miniMarkdown).
// Pure: (line, lang, esc) -> HTML string with <span class="hl-*">. Tested.
//
// Per-line + stateless, so a block comment / template string spanning lines isn't
// tracked across them — acceptable for a read-only review aid. The caller escapes via
// the injected `esc` so this never emits unescaped source.

const JS = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'class',
  'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'new', 'typeof', 'instanceof',
  'this', 'super', 'try', 'catch', 'finally', 'throw', 'switch', 'case', 'break', 'continue', 'yield',
  'in', 'of', 'delete', 'void', 'null', 'undefined', 'true', 'false', 'static', 'get', 'set'];
const TS = JS.concat(['interface', 'type', 'enum', 'implements', 'public', 'private', 'protected',
  'readonly', 'abstract', 'namespace', 'declare', 'as', 'keyof', 'satisfies', 'infer', 'is']);
const PY = ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as',
  'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'async', 'await', 'pass', 'break',
  'continue', 'global', 'nonlocal', 'assert', 'del', 'and', 'or', 'not', 'in', 'is', 'None', 'True',
  'False', 'self', 'cls'];
const GO = ['package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan',
  'go', 'defer', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break',
  'continue', 'select', 'nil', 'true', 'false'];
const TYPES = ['string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'object', 'int',
  'float', 'bool', 'str', 'bytes', 'list', 'dict', 'tuple'];

// lang -> { kw:Set, types:Set, hash:bool (is # a line comment?) }
function conf(lang) {
  const l = String(lang || '').toLowerCase();
  if (l === 'py' || l === 'python') return { kw: new Set(PY), types: new Set(TYPES), hash: true };
  if (l === 'go') return { kw: new Set(GO), types: new Set(TYPES), hash: false };
  if (l === 'ts' || l === 'tsx' || l === 'typescript') return { kw: new Set(TS), types: new Set(TYPES), hash: false };
  if (l === 'sh' || l === 'bash' || l === 'yaml' || l === 'yml' || l === 'toml') return { kw: new Set(), types: new Set(), hash: true };
  // js / jsx / vue / svelte / mjs / cjs and a sensible default
  return { kw: new Set(TS), types: new Set(TYPES), hash: false };
}

// One global regex per "has #-comments?" flavor (cheap to reuse). Order matters:
// comment, then string, then number, then identifier.
const RE_SLASH = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\w.]*)|([A-Za-z_$][\w$]*)/g;
const RE_HASH = /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\w.]*)|([A-Za-z_$][\w$]*)/g;

// Classify an identifier the way an editor theme (One Dark / Dracula) would, using
// only lexical cues available on a single line:
//   keyword → hl-kw · builtin type → hl-type · CALL foo( → hl-fn (method/function)
//   SCREAMING_SNAKE → hl-const · Capitalized → hl-type (class/ctor) · .member → hl-prop
//   else a plain local/var → no class (default fg, like One Dark variables).
function classifyWord(tok, prevCh, nextCh, c) {
  if (c.kw.has(tok)) return 'hl-kw';
  if (c.types.has(tok)) return 'hl-type';
  if (nextCh === '(') return 'hl-fn';
  if (/^[A-Z_][A-Z0-9_]*$/.test(tok) && tok.length > 1) return 'hl-const';
  if (/^[A-Z]/.test(tok)) return 'hl-type';
  if (prevCh === '.') return 'hl-prop';
  return '';
}

const KEY_LEVELS = 5;   // JSON keys cycle through this many depth-tinted colors

// Per-line nesting depth (at line start) for a JSON document, ignoring braces/brackets
// inside strings. Lets the highlighter tint object keys by nesting level for readability.
export function jsonDepths(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const depths = [];
  let depth = 0, inStr = false, esc = false;
  for (const line of lines) {
    depths.push(depth);
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    }
  }
  return depths;
}

function isJson(lang) { const l = String(lang || '').toLowerCase(); return l === 'json' || l === 'jsonc' || l === 'json5'; }

// depth (JSON only) tints object keys by nesting level. For non-JSON it's ignored.
export function highlightCode(line, lang, esc, depth) {
  const c = conf(lang);
  const json = isJson(lang);
  const re = c.hash ? RE_HASH : RE_SLASH;
  const s = String(line == null ? '' : line);
  let out = '', last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out += esc(s.slice(last, m.index));
    const tok = m[0];
    let cls = '';
    if (m[1]) cls = 'hl-com';
    else if (m[2]) {                                  // string
      if (json) {
        const after = s.slice(re.lastIndex).match(/^\s*:/);   // a key = string followed by ':'
        cls = after ? `hl-key hl-key-${((depth || 0) % KEY_LEVELS + KEY_LEVELS) % KEY_LEVELS}` : 'hl-str';
      } else cls = 'hl-str';
    }
    else if (m[3]) cls = 'hl-num';
    else if (m[4]) {
      if (json) cls = /^(true|false|null)$/.test(tok) ? 'hl-kw' : '';
      else {
        const prevCh = m.index > 0 ? s[m.index - 1] : '';
        const nextCh = re.lastIndex < s.length ? s[re.lastIndex] : '';
        cls = classifyWord(tok, prevCh, nextCh, c);
      }
    }
    out += cls ? `<span class="${cls}">${esc(tok)}</span>` : esc(tok);
    last = re.lastIndex;
  }
  if (last < s.length) out += esc(s.slice(last));
  return out;
}
