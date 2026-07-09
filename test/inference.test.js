import { describe, it, expect } from 'vitest';
import { resolveProvider, resolveProviderDetailed, generate } from '../lib/inference.js';

// The local inference lane (Act plane Phase 4): Slipway-managed MLX when running, else Ollama,
// never cloud. fetchImpl is injected so provider resolution and the exact wire formats are
// tested without any live server.

// A tiny fetch fixture: map of url-substring -> {ok, json} (first match wins); records calls.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    for (const [frag, res] of routes) {
      if (url.includes(frag)) {
        if (res instanceof Error) throw res;
        return { ok: res.ok !== false, json: async () => res.json };
      }
    }
    throw new Error('unroutable ' + url);
  };
  fn.calls = calls;
  return fn;
}

const MLX_UP = ['/api/status', { json: { state: 'running', backend: 'mlx', model: 'mlx-community/TestModel', port: 8080 } }];
const OLLAMA_UP = ['/api/tags', { json: { models: [{ name: 'qwen3:8b' }, { name: 'llama3:8b' }] } }];
const DOWN = (frag) => [frag, new Error('ECONNREFUSED')];

describe('resolveProvider — Slipway MLX first, Ollama fallback, never cloud', () => {
  it('picks slipway-mlx when running + /v1/models answers', async () => {
    const f = fakeFetch([MLX_UP, ['/v1/models', { json: { data: [] } }]]);
    const p = await resolveProvider({ fetchImpl: f });
    expect(p).toMatchObject({ kind: 'openai', model: 'mlx-community/TestModel', label: 'slipway-mlx' });
    expect(p.base).toBe('http://127.0.0.1:8080/v1');
  });

  it('uses the port Slipway reports', async () => {
    const f = fakeFetch([
      ['/api/status', { json: { state: 'running', backend: 'mlx', model: 'm', port: 9090 } }],
      ['/v1/models', { json: {} }],
    ]);
    expect((await resolveProvider({ fetchImpl: f })).base).toBe('http://127.0.0.1:9090/v1');
  });

  it('rejects a non-integer port (SSRF via URL userinfo) — pins to 8080', async () => {
    for (const bad of ['@evil.com', '80@evil.com', '8080/../x', -1, 70000, 1.5]) {
      const f = fakeFetch([
        ['/api/status', { json: { state: 'running', backend: 'mlx', model: 'm', port: bad } }],
        ['/v1/models', { json: {} }],
      ]);
      const p = await resolveProvider({ fetchImpl: f });
      expect(p.base).toBe('http://127.0.0.1:8080/v1');
      expect(new URL(p.base).hostname).toBe('127.0.0.1');   // never re-hosted
    }
  });

  it('falls to Ollama when the MLX /v1/models probe fails (surface missing)', async () => {
    const f = fakeFetch([MLX_UP, DOWN('/v1/models'), OLLAMA_UP]);
    const p = await resolveProvider({ fetchImpl: f });
    expect(p).toMatchObject({ kind: 'ollama', model: 'qwen3:8b', models: ['qwen3:8b', 'llama3:8b'] });
  });

  it('NEVER routes a cloud backend — falls to Ollama', async () => {
    const f = fakeFetch([
      ['/api/status', { json: { state: 'remote', backend: 'cloud', model: 'claude-something' } }],
      OLLAMA_UP,
    ]);
    const p = await resolveProvider({ fetchImpl: f });
    expect(p.kind).toBe('ollama');
    expect(f.calls.some((c) => c.url.includes('/chat/completions'))).toBe(false);
  });

  it('falls to Ollama when Slipway is stopped or down', async () => {
    for (const status of [['/api/status', { json: { state: 'stopped', backend: 'mlx', model: 'm' } }], DOWN('/api/status')]) {
      const p = await resolveProvider({ fetchImpl: fakeFetch([status, OLLAMA_UP]) });
      expect(p.kind).toBe('ollama');
    }
  });

  it('returns null when nothing local is up', async () => {
    expect(await resolveProvider({ fetchImpl: fakeFetch([DOWN('/api/status'), DOWN('/api/tags')]) })).toBeNull();
    // Ollama up but zero models is also unusable
    expect(await resolveProvider({ fetchImpl: fakeFetch([DOWN('/api/status'), ['/api/tags', { json: { models: [] } }]]) })).toBeNull();
  });
});

describe('resolveProviderDetailed — WHY there is no provider', () => {
  it("Slipway down + no Ollama → reason 'no-slipway'", async () => {
    const d = await resolveProviderDetailed({ fetchImpl: fakeFetch([DOWN('/api/status'), DOWN('/api/tags')]) });
    expect(d.provider).toBeNull();
    expect(d.reason).toBe('no-slipway');
    expect(d.slipway).toBeNull();
  });
  it("Slipway up but idle (state 'stopped' — models never load by default) → 'no-model', with the selected model", async () => {
    const d = await resolveProviderDetailed({ fetchImpl: fakeFetch([
      ['/api/status', { json: { state: 'stopped', backend: 'mlx', model: 'mlx-community/Qwen3.6-35B-A3B-6bit' } }],
      DOWN('/api/tags'),
    ]) });
    expect(d.provider).toBeNull();
    expect(d.reason).toBe('no-model');
    expect(d.slipway.model).toBe('mlx-community/Qwen3.6-35B-A3B-6bit');
  });
  it('reason is null whenever a provider resolves', async () => {
    const d = await resolveProviderDetailed({ fetchImpl: fakeFetch([MLX_UP, ['/v1/models', { json: {} }]]) });
    expect(d.provider).not.toBeNull();
    expect(d.reason).toBeNull();
  });
});

describe('resolveProviderDetailed — requireResident (the voice lane)', () => {
  it("Ollama library non-empty but NOTHING in memory (/api/ps empty) → 'no-model', never a cold promise", async () => {
    const d = await resolveProviderDetailed({ requireResident: true, fetchImpl: fakeFetch([
      DOWN('/api/status'), OLLAMA_UP, ['/api/ps', { json: { models: [] } }],
    ]) });
    expect(d.provider).toBeNull();
    expect(d.reason).toBe('no-model');
  });
  it('a resident Ollama model IS the brain — advertised over the library default', async () => {
    const d = await resolveProviderDetailed({ requireResident: true, fetchImpl: fakeFetch([
      DOWN('/api/status'), OLLAMA_UP, ['/api/ps', { json: { models: [{ name: 'llama3:8b' }] } }],
    ]) });
    expect(d.provider).toMatchObject({ kind: 'ollama', model: 'llama3:8b' });
    expect(d.provider.models).toEqual(['qwen3:8b', 'llama3:8b']);   // full library kept for the picker
  });
  it('a /api/ps ghost not in the library is ignored (stale daemon state)', async () => {
    const d = await resolveProviderDetailed({ requireResident: true, fetchImpl: fakeFetch([
      DOWN('/api/status'), OLLAMA_UP, ['/api/ps', { json: { models: [{ name: 'gone:1b' }] } }],
    ]) });
    expect(d.provider).toBeNull();
    expect(d.reason).toBe('no-model');
  });
  it('without the flag, on-demand semantics are unchanged (summary/ask lanes)', async () => {
    const d = await resolveProviderDetailed({ fetchImpl: fakeFetch([DOWN('/api/status'), OLLAMA_UP]) });
    expect(d.provider).toMatchObject({ kind: 'ollama', model: 'qwen3:8b' });
  });
  it('Slipway MLX serving always wins — residency is inherent there', async () => {
    const d = await resolveProviderDetailed({ requireResident: true, fetchImpl: fakeFetch([MLX_UP, ['/v1/models', { json: {} }]]) });
    expect(d.provider).toMatchObject({ label: 'slipway-mlx' });
  });
});

describe('generate — exact wire formats', () => {
  it('openai: POSTs /v1/chat/completions with stream:false + max_tokens, reads choices[0]', async () => {
    const f = fakeFetch([['/chat/completions', { json: { choices: [{ message: { content: 'hello' } }] } }]]);
    const out = await generate({ kind: 'openai', base: 'http://127.0.0.1:8080/v1', model: 'M' }, 'hi', { fetchImpl: f, maxTokens: 99, temperature: 0.5 });
    expect(out).toBe('hello');
    const body = JSON.parse(f.calls[0].opts.body);
    expect(body).toEqual({ model: 'M', messages: [{ role: 'user', content: 'hi' }], max_tokens: 99, stream: false, temperature: 0.5 });
  });

  it('ollama: POSTs /api/chat with a CAPPED context + explicit keep_alive, reads .message.content', async () => {
    // /api/chat (not /api/generate): template-strict models (gemma4-mlx) return '' on raw
    // completion. num_ctx matters: Ollama otherwise allocates the model's FULL window —
    // a 4.9GB llama3.1 sat at 22GB resident from its 131k KV cache (observed 2026-07-04).
    const f = fakeFetch([['/api/chat', { json: { message: { role: 'assistant', content: 'yo' } } }]]);
    const out = await generate({ kind: 'ollama', base: 'http://localhost:11434', model: 'q' }, 'hi', { fetchImpl: f });
    expect(out).toBe('yo');
    expect(JSON.parse(f.calls[0].opts.body)).toEqual({
      model: 'q', messages: [{ role: 'user', content: 'hi' }], stream: false, keep_alive: '5m',
      options: { num_ctx: 8192, temperature: 0.2, num_predict: 512 },
    });
  });

  it('degrades to null on non-200 / network error / no provider', async () => {
    expect(await generate({ kind: 'openai', base: 'b', model: 'm' }, 'p', { fetchImpl: fakeFetch([['chat', { ok: false, json: {} }]]) })).toBeNull();
    expect(await generate({ kind: 'ollama', base: 'b', model: 'm' }, 'p', { fetchImpl: fakeFetch([DOWN('chat')]) })).toBeNull();
    expect(await generate(null, 'p')).toBeNull();
  });
});
