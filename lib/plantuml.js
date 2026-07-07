// plantuml.js — the Studio's LOCAL diagram-render lane (PlantUML integration).
// One owner for "can we render?" and the render call itself. PRIVACY: rendering is
// always the local `plantuml` binary (brew install plantuml) — never plantuml.com;
// diagram text must not leave the machine. Everything degrades to
// { available:false } / { error } — callers never see an exception.
//
// SECURITY (exempt from minimalism — this shells out with user-supplied text):
//   · source travels via STDIN (-pipe); it never touches a shell string or a filename
//   · PLANTUML_SECURITY_PROFILE=SANDBOX blocks !include/%load/file access inside PlantUML
//   · a pre-flight reject of !include/!import/!theme/%load/%read in USER source is the
//     second belt — the sentinel theme is injected by us, after the check
//   · -Playout=smetana: pure-Java layout, no Graphviz subprocess
//   · input cap 64 KB, output cap 4 MB, hard timeout kill
// execImpl is injectable so composition/validation/error-parsing are unit-testable
// without Java (the inference.js fetchImpl pattern).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INPUT_CAP = 64 * 1024;
export const OUTPUT_CAP = 4 * 1024 * 1024;

// Directives that reach the filesystem/network or would fight the Studio's theming.
// Checked against USER source only (our own injected theme body is trusted).
export const FORBIDDEN_RE = /^\s*(!(include|import|theme)\b|%(load|read)\b)/mi;

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SENTINEL_PATH = path.join(__dir, '..', 'public', 'plantuml', '_sentinel.puml');
let sentinelBody = null;
export function sentinelThemeBody() {
  if (sentinelBody == null) {
    try { sentinelBody = fs.readFileSync(SENTINEL_PATH, 'utf8'); } catch { sentinelBody = ''; }
  }
  return sentinelBody;
}

// Wrap user source into a full document with the theme body INLINED right after the
// @start line (never !include — the sandbox forbids file access). Source without an
// explicit @start gets the plain @startuml envelope.
export function composeDocument(userSrc, themeBody) {
  const src = String(userSrc || '').trim();
  const m = src.match(/^@start(\w+).*$/m);
  if (m) {
    const at = src.indexOf(m[0]) + m[0].length;
    return src.slice(0, at) + '\n' + themeBody + src.slice(at);
  }
  return '@startuml\n' + themeBody + '\n' + src + '\n@enduml';
}

// PlantUML syntax errors (with -pipe -tsvg) surface as stderr lines and/or an error SVG.
// → { error, line? } with line numbers mapped back to USER source where possible.
export function parseError(stderr, stdout) {
  const text = String(stderr || '') + '\n' + String(stdout || '');
  const lm = text.match(/ERROR\s*\n?\s*(\d+)/i) || text.match(/line\s+(\d+)/i);
  const msg = (text.match(/Syntax [Ee]rror[^\n]*/) || text.match(/ERROR[^\n]*/) || ['diagram failed to render'])[0];
  return { error: msg.trim(), ...(lm ? { line: Number(lm[1]) } : {}) };
}

// Default exec: spawn plantuml, feed stdin, collect stdout/stderr with caps + timeout.
function defaultExec(args, input, { timeoutMs }) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let child;
    try {
      child = spawn('plantuml', args, {
        env: { ...process.env, PLANTUML_SECURITY_PROFILE: 'SANDBOX', JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) { return finish({ code: -1, stdout: '', stderr: String(e) }); }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish({ code: -1, stdout: out, stderr: 'render timed out' }); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); finish({ code: -1, stdout: '', stderr: String(e) }); });
    child.stdout.on('data', (d) => { out += d; if (out.length > OUTPUT_CAP) { try { child.kill('SIGKILL'); } catch {} clearTimeout(timer); finish({ code: -1, stdout: '', stderr: 'output too large' }); } });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => { clearTimeout(timer); finish({ code, stdout: out, stderr: err }); });
    child.stdin.on('error', () => {});   // EPIPE when plantuml is missing/dies early
    child.stdin.end(input);
  });
}

// Memoized availability probe (re-probe with {refresh:true} after installing).
let probed = null;
export async function available({ refresh = false, execImpl = defaultExec } = {}) {
  if (probed && !refresh) return probed;
  const r = await execImpl(['-version'], '', { timeoutMs: 8000 });
  const vm = String(r.stdout || '').match(/PlantUML version (\S+)/i);
  probed = r.code === 0 && vm ? { ok: true, version: vm[1] } : { ok: false };
  return probed;
}

// Render-cache: theme-INDEPENDENT by construction (the sentinel render is the same for
// every theme; CSS vars restyle it client-side), so one entry serves all 12 theme/modes.
const cache = new Map();   // sha256 → svg (LRU, 100)
const CACHE_MAX = 100;
export function cacheKey(puml) {
  return createHash('sha256').update(sentinelThemeBody()).update('\n').update(String(puml)).digest('hex');
}
export function clearCache() { cache.clear(); }

// The single entry point: user PlantUML source → { svg, cached } | { error, line? }.
// postProcess (the sentinel→CSS-var rewriter) runs before caching so cached hits are
// already rewritten. Kept as one seam so a warm-JVM transport (picoweb) can slot in
// later without touching callers (ROADMAP).
export async function render(puml, { timeoutMs = 15000, execImpl = defaultExec, postProcess = (s) => s } = {}) {
  const src = String(puml || '');
  if (!src.trim()) return { error: 'empty diagram source' };
  if (src.length > INPUT_CAP) return { error: 'diagram source too large (64 KB cap)' };
  if (FORBIDDEN_RE.test(src)) return { error: 'includes are disabled — themes are applied by the Studio (!include/!theme/%load are rejected)' };
  const key = cacheKey(src);
  if (cache.has(key)) { const svg = cache.get(key); cache.delete(key); cache.set(key, svg); return { svg, cached: true }; }
  const doc = composeDocument(src, sentinelThemeBody());
  const r = await execImpl(['-tsvg', '-pipe', '-Playout=smetana'], doc, { timeoutMs });
  const svg = String(r.stdout || '');
  // -pipe emits the error as an SVG on stdout with exit code != 0; treat non-zero or
  // non-SVG output as failure and surface the parsed message.
  if (r.code !== 0 || !svg.includes('<svg')) return parseError(r.stderr, svg);
  const final = postProcess(svg);
  cache.set(key, final);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return { svg: final, cached: false };
}
