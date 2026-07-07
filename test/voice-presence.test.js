import { describe, it, expect } from 'vitest';
import { PRESENCE_STATES, isPresenceState, renderGlyph, renderOrb, orbCaption, orbTitle, subtitleWindow, brainEmptyState } from '../public/lib/voice-presence.js';

// no-model dress + tooltip: the orb mutes when nothing is loaded, and the hover title
// teaches the mental model (models load through Slipway, on purpose — never by default).
describe('orb no-model state', () => {
  it('idle + noModel renders the muted dress and says so for a11y', () => {
    const html = renderOrb('idle', { noModel: true });
    expect(html).toContain('vo-nomodel');
    expect(html).toContain('no model loaded');
  });
  it('active states are never muted — a talking brain proves a model is up', () => {
    for (const s of ['listening', 'thinking', 'speaking']) {
      expect(renderOrb(s, { noModel: true })).not.toContain('vo-nomodel');
    }
  });
  it("caption says 'no model' at idle; away still beats it", () => {
    expect(orbCaption('idle', { noModel: true })).toBe('no model');
    expect(orbCaption('idle', { noModel: true, away: true })).toBe('in another tab');
  });
  it('tooltip names the remedy per reason', () => {
    expect(orbTitle({ noModel: true })).toMatch(/load one through Slipway/i);
    expect(orbTitle({ noModel: true, reason: 'no-slipway' })).toMatch(/runtime is down/i);
    expect(orbTitle({ model: 'qwen3:8b' })).toContain('qwen3:8b');
    expect(orbTitle({ away: true })).toMatch(/another tab/i);
  });
});

// The no-brain empty state: reason-aware copy so the panel names the actual remedy —
// 'no-model' (Slipway idle; the NORMAL state, offers a load) vs 'no-slipway' (runtime down).
describe('brainEmptyState', () => {
  it('is null when a brain is available (no empty state to show)', () => {
    expect(brainEmptyState({ available: true, model: 'x' })).toBeNull();
  });
  it("'no-model' names the idle runtime and offers the selected model as the load action", () => {
    const es = brainEmptyState({ available: false, reason: 'no-model', selected: 'mlx-community/Qwen3.6-35B-A3B-6bit' });
    expect(es.reason).toBe('no-model');
    expect(es.headline).toMatch(/no model/i);
    expect(es.action).toEqual({ kind: 'load', model: 'mlx-community/Qwen3.6-35B-A3B-6bit' });
  });
  it("'no-model' with no selection still offers a load action (picker decides)", () => {
    expect(brainEmptyState({ available: false, reason: 'no-model' }).action).toEqual({ kind: 'load', model: null });
  });
  it("'no-slipway' (and unknown/missing reasons) explain the runtime is down, with no load action", () => {
    for (const brain of [{ available: false, reason: 'no-slipway' }, { available: false }, {}]) {
      const es = brainEmptyState(brain);
      expect(es.reason).toBe('no-slipway');
      expect(es.action).toBeNull();
    }
  });
});

describe('renderOrb / orbCaption', () => {
  it('renders every state with its class; speaking swaps the core for the waveform', () => {
    for (const s of PRESENCE_STATES) expect(renderOrb(s)).toContain('vo-' + s);
    expect(renderOrb('speaking')).toContain('vo-wave');
    expect(renderOrb('speaking')).not.toContain('vo-core');
    expect(renderOrb('listening')).toContain('vo-core');
    expect(renderOrb('nonsense')).toContain('vo-idle');
  });
  it('away dims and overrides the aria story', () => {
    const html = renderOrb('listening', { away: true });
    expect(html).toContain('vo-away');
    expect(html).toContain('active in another tab');
  });
  it('caption: away > active state > model > invitation', () => {
    expect(orbCaption('speaking', { away: true })).toBe('in another tab');
    expect(orbCaption('listening', { model: 'x' })).toBe('listening');
    expect(orbCaption('idle', { model: 'claude-fable-5' })).toBe('claude-fable-5');
    expect(orbCaption('idle', {})).toBe('assistant');
  });
});

describe('renderGlyph', () => {
  it('renders every closed state with its class', () => {
    for (const s of PRESENCE_STATES) {
      const html = renderGlyph(s);
      expect(html).toContain('vp-' + s);
      expect(html).toContain(`aria-label="assistant ${s}"`);
    }
  });
  it('unknown states fall back to idle', () => {
    expect(renderGlyph('sentient')).toContain('vp-idle');
    expect(isPresenceState('sentient')).toBe(false);
  });
  it('only speaking grows bars', () => {
    expect(renderGlyph('speaking')).toContain('vp-bar');
    expect(renderGlyph('listening')).not.toContain('vp-bar');
  });
});

describe('subtitleWindow', () => {
  const text = 'First sentence here. Second one is longer and matters. Third closes it.';
  it('returns the sentence around the playhead', () => {
    expect(subtitleWindow(text, 30)).toBe('Second one is longer and matters.');
    expect(subtitleWindow(text, 5)).toBe('First sentence here.');
  });
  it('handles edges: empty text, index past end', () => {
    expect(subtitleWindow('', 10)).toBe('');
    expect(subtitleWindow(text, 9999)).toBe('Third closes it.');
  });
  it('caps long sentences but keeps the playhead visible', () => {
    const long = 'word '.repeat(80).trim() + '.';
    const w = subtitleWindow(long, 350, { maxLen: 60 });
    expect(w.length).toBeLessThanOrEqual(61);
    expect(w).toContain('…');
  });
});
