import { describe, it, expect } from 'vitest';
import { agentsIframeAttrs, unavailableHtml, slipwayUrlWithHash, SLIPWAY_URL, SLIPWAY_PROBE } from '../public/lib/agents-ui.js';

// The Agents surface embeds Slipway (the local/hosted model + agent runtime) in a Studio overlay —
// federated integration (Slipway is a separate localhost app). These guard the load-bearing bits of
// the embed config; the overlay wiring itself is exercised by e2e.
describe('agents surface — iframe config', () => {
  it('defaults to the local Slipway origin', () => {
    expect(agentsIframeAttrs().src).toBe(SLIPWAY_URL);
    expect(SLIPWAY_URL).toBe('http://localhost:8765');
  });

  it('keeps allow-same-origin so Slipway\'s terminal-WebSocket Origin check passes', () => {
    const s = agentsIframeAttrs().sandbox;
    expect(s).toContain('allow-same-origin');
    expect(s).toContain('allow-scripts');
  });

  it('does not let the embed navigate the parent Studio (no allow-top-navigation)', () => {
    expect(agentsIframeAttrs().sandbox).not.toContain('allow-top-navigation');
  });

  it('accepts a custom base url', () => {
    expect(agentsIframeAttrs('http://127.0.0.1:8765').src).toBe('http://127.0.0.1:8765');
  });

  it('has a title for accessibility', () => {
    expect(agentsIframeAttrs().title).toMatch(/slipway/i);
  });
});

describe('agents surface — embed mode + first-paint theme params (D5)', () => {
  it('with a theme, the src flips Slipway into embed mode and carries mode/accent/uiscale', () => {
    const { src } = agentsIframeAttrs('http://localhost:8765', { mode: 'light', accent: '#aabbcc', uiscale: 1.15 });
    expect(src).toBe('http://localhost:8765/?embed=1&mode=light&accent=%23aabbcc&uiscale=1.15');
  });

  it('theme defaults are safe (dark, no accent, scale 1)', () => {
    const { src } = agentsIframeAttrs('http://localhost:8765', {});
    expect(src).toBe('http://localhost:8765/?embed=1&mode=dark&accent=&uiscale=1');
  });

  it('deep-link fragments compose with the embed query (hash after the params)', () => {
    const base = agentsIframeAttrs('http://localhost:8765', { mode: 'dark', accent: '#8c97ff', uiscale: 1 }).src;
    expect(slipwayUrlWithHash(base, 'term:abc123', 42))
      .toBe('http://localhost:8765/?embed=1&mode=dark&accent=%238c97ff&uiscale=1#term:abc123:42');
  });

  it('without a theme the src stays the bare origin (standalone/back-compat)', () => {
    expect(agentsIframeAttrs('http://localhost:8765').src).toBe('http://localhost:8765');
  });
});

describe('agents surface — availability fallback', () => {
  it('probes Slipway status (so the tab can feature-detect before embedding)', () => {
    expect(SLIPWAY_PROBE).toBe(SLIPWAY_URL + '/api/status');
  });

  it('the not-detected fallback names Slipway, flags it optional, and offers a retry', () => {
    const html = unavailableHtml();
    expect(html).toMatch(/slipway/i);
    expect(html).toMatch(/optional/i);
    expect(html).toContain('id="agents-retry"');
  });
});

describe('agents surface — deep-link URLs (F6)', () => {
  it('builds a #term:<sid> fragment with a nonce (defeats same-hash no-ops)', () => {
    expect(slipwayUrlWithHash('http://localhost:8765', 'term:abc123', 1700000000000))
      .toBe('http://localhost:8765#term:abc123:1700000000000');
  });

  it('omits the nonce separator when no nonce is given', () => {
    expect(slipwayUrlWithHash('http://localhost:8765', 'terminals'))
      .toBe('http://localhost:8765#terminals');
  });

  it('returns the bare base when no hash is given (plain open)', () => {
    expect(slipwayUrlWithHash('http://localhost:8765')).toBe('http://localhost:8765');
    expect(slipwayUrlWithHash('http://localhost:8765', '')).toBe('http://localhost:8765');
  });

  it('defaults to the Slipway origin', () => {
    expect(slipwayUrlWithHash(undefined, 'terminals')).toBe(SLIPWAY_URL + '#terminals');
  });
});
