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

// Default-model policy (Rick, 2026-07-04): local models are for the everyday lane —
// prefer SMALL (≤ ~20B; weights ≤ this many bytes as the proxy). Horsepower comes from
// the Claude subscription over MCP, not a bigger resident model. Embedding/base models
// are never conversational defaults. Explicit ?model= picks still override.
const DEFAULT_MAX_BYTES = 14 * 1024 ** 3;   // ≈ a 20B-class quantized model
const NON_CHAT_RE = /embed|-base\b|:.*base/i;
export function pickDefaultModel(models = []) {
  const chat = models.filter((m) => !NON_CHAT_RE.test(m.name || ''));
  const small = chat.filter((m) => (m.size || 0) <= DEFAULT_MAX_BYTES);
  // best quality under the cap; nothing under it → smallest available (never silently huge)
  const pick = small.sort((a, b) => (b.size || 0) - (a.size || 0))[0]
    || chat.sort((a, b) => (a.size || 0) - (b.size || 0))[0];
  return pick ? pick.name : (models[0] && models[0].name) || null;
}

// Why is no provider available? Pure mapping over the Slipway status probe, so the UI can
// say the right thing: the runtime being DOWN and the runtime being UP WITH NOTHING LOADED
// (Slipway reports state 'stopped' while idle — models are never loaded by default) need
// different remedies (start Slipway vs. load a model).
export function absenceReason(status) {
  return status ? 'no-model' : 'no-slipway';
}

// → { provider, reason, slipway }  where provider is resolveProvider()'s value and reason
// is null when a provider exists, else 'no-slipway' | 'no-model'. slipway = the raw
// /api/status JSON (or null) for callers that want the selected-but-unloaded model name.
//
// requireResident (the voice lane): a model must actually be IN MEMORY to count. Ollama's
// library (/api/tags) is a promise, not a fact — it loads on demand, and a 10-26GB first
// load is a minute of dead air that reads as "broken" mid-conversation (observed 2026-07-07:
// the orb said gemma4:12b while nothing was resident; speaking produced nothing). /api/ps
// is the residency truth. Non-voice callers (summary/ask) keep on-demand semantics.
export async function resolveProviderDetailed({
  slipway = SLIPWAY_HOST, ollama = OLLAMA_HOST,
  fetchImpl = fetch, timeoutMs = 1500, requireResident = false,
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
    if (models) {
      return { provider: { kind: 'openai', base, model: status.model, models: [status.model], label: 'slipway-mlx' }, reason: null, slipway: status };
    }
  }
  // backend 'cloud' (or anything not a confirmed local MLX) falls through to Ollama.
  const tags = await fetchJson(fetchImpl, ollama + '/api/tags', {}, timeoutMs);
  const list = tags && tags.models;
  if (list && list.length) {
    const names = list.map((m) => m.name);
    if (requireResident) {
      const ps = await fetchJson(fetchImpl, ollama + '/api/ps', {}, timeoutMs);
      const resident = ((ps && ps.models) || []).map((m) => m.name).filter((n) => names.includes(n));
      if (!resident.length) return { provider: null, reason: 'no-model', slipway: status };
      // a resident model IS the brain — never advertise a cold one over a warm one
      return { provider: { kind: 'ollama', base: ollama, model: resident[0], models: names, label: 'ollama' }, reason: null, slipway: status };
    }
    return { provider: { kind: 'ollama', base: ollama, model: pickDefaultModel(list), models: names, label: 'ollama' }, reason: null, slipway: status };
  }
  return { provider: null, reason: absenceReason(status), slipway: status };
}

// → { kind:'openai', base, model, models:[model], label:'slipway-mlx' }
// | { kind:'ollama', base, model, models, label:'ollama' }
// | null (no local model up)
export async function resolveProvider(opts = {}) {
  return (await resolveProviderDetailed(opts)).provider;
}

// Ask Ollama to release a model's memory NOW (keep_alive:0 with an empty prompt) —
// called when the user switches models so the old KV cache never lingers.
export async function unloadModel(provider, model, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!provider || provider.kind !== 'ollama' || !model) return;
  await fetchJson(fetchImpl, provider.base + '/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }, timeoutMs);
}

// One prompt in, text out (or null) — wraps the two wire formats.
export async function generate(provider, prompt, {
  maxTokens = 512, temperature = 0.2, timeoutMs = 120000, fetchImpl = fetch,
  // Ollama allocates the model's FULL context window by default — llama3.1's 131k KV
  // cache turned a 4.9GB model into 22GB resident (observed 2026-07-04). Our prompts
  // are a few KB; 8k is generous for the chat/summary lanes and keeps residency near
  // the weights. keep_alive is explicit so idle models leave promptly.
  numCtx = 8192, keepAlive = '5m',
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
  // /api/chat, not /api/generate: chat applies the model's own template server-side.
  // Raw completion silently returns '' on template-strict models (gemma4-mlx, observed
  // 2026-07-04) — the flattened prompt still travels as one user message (v1 contract).
  const j = await fetchJson(fetchImpl, provider.base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], stream: false, keep_alive: keepAlive, options: { num_ctx: numCtx, temperature, num_predict: maxTokens } }),
  }, timeoutMs);
  const text = j && j.message && j.message.content;
  return text != null ? text : null;
}
