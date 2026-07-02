// Pure logic for the `capture` and `status` CLI subcommands — no I/O, so it's
// unit-testable. The bin (bin/scatterbrained.js) does the actual HTTP; this file
// only decides *where* to talk (base URL) and *what* to send (note vs link payload).

// Is this a real http(s) web URL (vs a note body)? Mirrors public/lib/links.js
// isWebUrl — kept as a tiny standalone copy so the bin has ZERO import surface into
// the browser code (which the CLI never otherwise loads).
export function looksLikeUrl(s) {
  try { const u = new URL(String(s).trim()); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// Resolve the running Studio's base URL from the same env the server reads
// (STUDIO_PORT), bound to loopback like server.js. Host is fixed to 127.0.0.1 —
// the server binds loopback-only, so anything else can't reach it anyway.
export function studioBaseUrl(env = process.env) {
  const port = Number(env.STUDIO_PORT) || 4317;
  return `http://127.0.0.1:${port}`;
}

// Turn the capture argument into { path, body } for the Studio API.
//   a URL              → POST /api/link  { url }
//   anything else      → POST /api/note  { text, target }   (target may be undefined)
// `target` is an optional node elementId to anchor a note to (a note needs an anchor;
// the server rejects an unanchored note with a clear message we surface as-is).
export function captureRequest(arg, { target } = {}) {
  const text = String(arg == null ? '' : arg).trim();
  if (!text) return { error: 'nothing to capture — pass a note or a URL' };
  if (looksLikeUrl(text)) return { path: '/api/link', body: { url: text } };
  const body = { text };
  if (target) body.target = String(target);
  return { path: '/api/note', body };
}
