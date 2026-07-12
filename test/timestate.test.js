import { describe, it, expect } from 'vitest';
import { playheadISO, isLive, sliderToISO, isoToSlider } from '../public/lib/timestate.js';

// The shared playhead (temporal-coherence build step 4). Pure math: the one date every
// surface reads AS OF, and the slider ⇄ date mapping the constellation and lenses share.
describe('timestate — playheadISO / isLive', () => {
  it('reads the parked date when set, else today', () => {
    expect(playheadISO({ atISO: '2026-03-03' }, '2026-07-10')).toBe('2026-03-03');
    expect(playheadISO({ atISO: null }, '2026-07-10')).toBe('2026-07-10');
    expect(playheadISO({}, '2026-07-10')).toBe('2026-07-10');
    expect(playheadISO(null, '2026-07-10')).toBe('2026-07-10');
  });
  it('ignores a malformed atISO (falls back to today)', () => {
    expect(playheadISO({ atISO: 'March' }, '2026-07-10')).toBe('2026-07-10');
  });
  it('isLive is true only at now', () => {
    expect(isLive({ atISO: null })).toBe(true);
    expect(isLive({})).toBe(true);
    expect(isLive(null)).toBe(true);
    expect(isLive({ atISO: '2026-03-03' })).toBe(false);
  });
});

describe('timestate — sliderToISO', () => {
  const tMin = Date.parse('2026-01-01T00:00:00Z');
  const tMax = Date.parse('2026-12-31T00:00:00Z');
  it('is null (live) at or above 100', () => {
    expect(sliderToISO(100, tMin, tMax)).toBe(null);
    expect(sliderToISO(120, tMin, tMax)).toBe(null);
  });
  it('maps the ends to the min/max dates', () => {
    expect(sliderToISO(0, tMin, tMax)).toBe('2026-01-01');
    expect(sliderToISO(99.9, tMin, tMax)).toBe('2026-12-30');   // just shy of max
  });
  it('is monotonic across the middle', () => {
    expect(sliderToISO(25, tMin, tMax) < sliderToISO(75, tMin, tMax)).toBe(true);
  });
  it('returns null when there is nothing to rewind to (tMax<=tMin)', () => {
    expect(sliderToISO(50, 0, 0)).toBe(null);
    expect(sliderToISO(50, 100, 1)).toBe(null);
  });
});

describe('timestate — isoToSlider (inverse, so a lens can jump the slider)', () => {
  const tMin = Date.parse('2026-01-01T00:00:00Z');
  const tMax = Date.parse('2026-12-31T00:00:00Z');
  it('round-trips a mid date back to its slider value', () => {
    const iso = sliderToISO(40, tMin, tMax);
    expect(Math.round(isoToSlider(iso, tMin, tMax))).toBe(40);
  });
  it('clamps out-of-range dates to the ends', () => {
    expect(isoToSlider('2020-01-01', tMin, tMax)).toBe(0);       // before the window
    expect(isoToSlider('2030-01-01', tMin, tMax)).toBe(100);     // after → live edge
  });
  it('is safe on bad input', () => {
    expect(isoToSlider('nope', tMin, tMax)).toBe(100);
    expect(isoToSlider('2026-06-01', 0, 0)).toBe(100);
  });
});
