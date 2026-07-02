// inference.js — the Studio's LOCAL inference lane (Act plane, Phase 4).
// One owner for "which local model can answer?" and both wire formats. Providers, in order:
//   1. Slipway-managed MLX  — probe Slipway /api/status; state 'running' + backend 'mlx' →
//      the vllm-mlx server speaks OpenAI-compatible /v1 on its port (confirmed via GET /v1/models).
//   2. Ollama               — the pre-existing lane (GET /api/tags), used when Slipway is down,
//      stopped, or running the ollama backend (Ollama serves either way).
// A Slipway 'cloud' backend is treated as locally UNAVAILABLE — this lane never routes to an
// external API (the repo's no-external-API rule); it falls through to the Ollama probe.
// Everything degrades to null; callers keep the { available:false } contract.
// fetchImpl is injectable so the resolution logic and exact request bodies are unit-testable.

export const SLIPWAY_HOST = process.env.SLIPWAY_HOST || 'http://127.0.0.1:8765';
export const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

async function fetchJson(fetchImpl, url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// → { kind:'openai', base, model, models:[model], label:'slipway-mlx' }
// | { kind:'ollama', base, model, models, label:'ollama' }
// | null (no local model up)
export async function resolveProvider({
  slipway = SLIPWAY_HOST, ollama = OLLAMA_HOST,
  fetchImpl = fetch, timeoutMs = 1500,
} = {}) {
  const status = await fetchJson(fetchImpl, slipway + '/api/status', {}, timeoutMs);
  if (status && status.state === 'running' && status.backend === 'mlx' && status.model) {
    // vllm-mlx serves OpenAI-compatible /v1 on the port Slipway reports (8080 by default).
    // VALIDATE the port is a real integer: a hostile /api/status could send port:"@evil.com",
    // which `http://127.0.0.1:${port}/v1` would re-host to an external server (URL userinfo trick),
    // exfiltrating the transcript prompt. The 127.0.0.1 pin is only real if the port is numeric.
    const port = Number.isInteger(status.port) && status.port > 0 && status.port < 65536 ? status.port : 8080;
    const base = `http://127.0.0.1:${port}/v1`;
    const models = await fetchJson(fetchImpl, base + '/models', {}, timeoutMs);
    if (models) return { kind: 'openai', base, model: status.model, models: [status.model], label: 'slipway-mlx' };
  }
  // backend 'cloud' (or anything not a confirmed local MLX) falls through to Ollama.
  const tags = await fetchJson(fetchImpl, ollama + '/api/tags', {}, timeoutMs);
  const names = tags && (tags.models || []).map((m) => m.name);
  if (names && names.length) return { kind: 'ollama', base: ollama, model: names[0], models: names, label: 'ollama' };
  return null;
}

// One prompt in, text out (or null) — wraps the two wire formats.
export async function generate(provider, prompt, {
  maxTokens = 512, temperature = 0.2, timeoutMs = 120000, fetchImpl = fetch,
} = {}) {
  if (!provider) return null;
  if (provider.kind === 'openai') {
    const j = await fetchJson(fetchImpl, provider.base + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // Explicit max_tokens + stream:false — vLLM's defaults are "rest of context" and
      // streaming, both wrong for a bounded local summarization call.
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false, temperature }),
    }, timeoutMs);
    const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return text != null ? text : null;
  }
  const j = await fetchJson(fetchImpl, provider.base + '/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.model, prompt, stream: false }),
  }, timeoutMs);
  return j && j.response != null ? j.response : null;
}
