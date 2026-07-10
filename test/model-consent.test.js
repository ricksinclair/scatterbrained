import { describe, it, expect } from 'vitest';
import { HEAVY_GB, parseSizeGb, consentView, pickerOptions } from '../public/lib/model-consent.js';

// Loading a local model pulls gigabytes of weights into RAM and can wedge a small Mac for a
// minute. It is a costly, user-visible action, so it gets an explicit accept/decline — these
// cover the pure decision (what the dialog says, and when it warns) that the modal renders.

describe('parseSizeGb', () => {
  it('reads the du -sh forms Slipway emits for MLX models', () => {
    expect(parseSizeGb('28G')).toBe(28);
    expect(parseSizeGb('2.1G')).toBe(2.1);
    expect(parseSizeGb('512M')).toBeCloseTo(0.5, 3);
    expect(parseSizeGb('1.5T')).toBe(1536);
  });
  it('reads the spaced forms ollama list emits', () => {
    expect(parseSizeGb('2.1 GB')).toBe(2.1);
    expect(parseSizeGb('980 MB')).toBeCloseTo(0.957, 2);
  });
  it('returns null for anything it cannot trust, rather than guessing', () => {
    expect(parseSizeGb('')).toBeNull();
    expect(parseSizeGb(undefined)).toBeNull();
    expect(parseSizeGb('Anthropic')).toBeNull();   // cloud rows carry a provider label as "size"
    expect(parseSizeGb('big')).toBeNull();
  });
});

describe('consentView', () => {
  it('names the model and states the size so the cost is never a surprise', () => {
    const v = consentView({ id: 'mlx-community/Qwen3-4B-4bit', backend: 'mlx', size: '2.3G' });
    expect(v.model).toBe('Qwen3-4B-4bit');
    expect(v.sizeLabel).toBe('2.3 GB');
    expect(v.heavy).toBe(false);
    expect(v.confirmLabel).toBe('Load model');
  });
  it('warns harder for a model big enough to read as a hang', () => {
    const v = consentView({ id: 'mlx-community/Qwen3.6-35B-A3B-6bit', backend: 'mlx', size: '28G' });
    expect(v.heavy).toBe(true);
    expect(v.sizeLabel).toBe('28 GB');
    expect(v.warning).toMatch(/minute|slow|memory/i);
  });
  it('treats exactly the threshold as heavy — the boundary belongs to the warning', () => {
    expect(consentView({ id: 'a/b', size: `${HEAVY_GB}G` }).heavy).toBe(true);
    expect(consentView({ id: 'a/b', size: `${HEAVY_GB - 0.1}G` }).heavy).toBe(false);
  });
  it('stays honest when the size is unknown — no invented number, still consentable', () => {
    const v = consentView({ id: 'llama3/latest', backend: 'ollama', size: 'unknown' });
    expect(v.sizeLabel).toBeNull();
    expect(v.heavy).toBe(false);
    expect(v.body).toMatch(/size is unknown/i);
  });
  it('says which runtime will serve it', () => {
    expect(consentView({ id: 'a/b', backend: 'ollama', size: '1G' }).backend).toBe('ollama');
  });
});

describe('pickerOptions', () => {
  const models = [
    { id: 'mlx-community/Qwen3-4B-4bit', backend: 'mlx', size: '2.3G' },
    { id: 'mlx-community/Qwen3.6-35B-A3B-6bit', backend: 'mlx', size: '28G' },
  ];
  it('lists every loadable model, not just the resident one — the switch bug', () => {
    const opts = pickerOptions({ models, resident: 'mlx-community/Qwen3-4B-4bit' });
    expect(opts.map((o) => o.value)).toEqual([
      'local:mlx-community/Qwen3-4B-4bit',
      'local:mlx-community/Qwen3.6-35B-A3B-6bit',
    ]);
  });
  it('marks which one is actually in memory, and which need a load', () => {
    const [a, b] = pickerOptions({ models, resident: 'mlx-community/Qwen3-4B-4bit' });
    expect(a.resident).toBe(true);
    expect(a.selected).toBe(true);
    expect(b.resident).toBe(false);
    expect(b.label).toMatch(/28 GB/);
  });
  it('puts the connected agent first and selects it — the agent outranks a local model', () => {
    const opts = pickerOptions({ models, resident: null, agent: { connected: true, model: 'claude-opus-4-8' } });
    expect(opts[0].value).toBe('agent');
    expect(opts[0].selected).toBe(true);
    expect(opts.some((o) => o.selected && o.value !== 'agent')).toBe(false);
  });
  it('is empty when there is nothing to talk to at all', () => {
    expect(pickerOptions({ models: [], resident: null })).toEqual([]);
  });
});
