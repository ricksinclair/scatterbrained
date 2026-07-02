import { describe, it, expect } from 'vitest';
import { initialState, reduce, parseHash, serializeHash, sameState, escTarget, ESC_ORDER, LENSES } from '../public/lib/nav.js';

describe('nav reducer', () => {
  it('opens a lens with its default tab', () => {
    expect(reduce(initialState, { type: 'open', lens: 'time' })).toEqual({ lens: 'time', tab: 'agenda' });
    expect(reduce(initialState, { type: 'open', lens: 'code' })).toEqual({ lens: 'code', tab: 'map' });
    expect(reduce(initialState, { type: 'open', lens: 'agents' })).toEqual({ lens: 'agents', tab: null });
  });
  it('opens a lens at an explicit tab; unknown tab falls back to the default', () => {
    expect(reduce(initialState, { type: 'open', lens: 'code', tab: 'review' })).toEqual({ lens: 'code', tab: 'review' });
    expect(reduce(initialState, { type: 'open', lens: 'time', tab: 'roadmap' })).toEqual({ lens: 'time', tab: 'roadmap' });
    expect(reduce(initialState, { type: 'open', lens: 'time', tab: 'bogus' })).toEqual({ lens: 'time', tab: 'agenda' });
  });
  it('tab switches within the open lens only', () => {
    const code = { lens: 'code', tab: 'map' };
    expect(reduce(code, { type: 'tab', tab: 'review' })).toEqual({ lens: 'code', tab: 'review' });
    expect(reduce(code, { type: 'tab', tab: 'nope' })).toBe(code);          // unknown tab: no-op
    expect(reduce(initialState, { type: 'tab', tab: 'review' })).toBe(initialState); // graph has no tabs
  });
  it('close and open-graph both return home', () => {
    const t = { lens: 'time', tab: 'agenda' };
    expect(reduce(t, { type: 'close' })).toEqual({ lens: 'graph', tab: null });
    expect(reduce(t, { type: 'open', lens: 'graph' })).toEqual({ lens: 'graph', tab: null });
  });
  it('unknown lens or action is safe', () => {
    expect(reduce(initialState, { type: 'open', lens: 'wat' })).toEqual({ lens: 'graph', tab: null });
    expect(reduce(initialState, { type: 'zap' })).toBe(initialState);
  });
});

describe('hash round-trip', () => {
  it('graph has no hash', () => {
    expect(serializeHash({ lens: 'graph', tab: null })).toBe('');
    expect(parseHash('')).toEqual({ lens: 'graph', tab: null });
    expect(parseHash('#')).toEqual({ lens: 'graph', tab: null });
  });
  it('every lens state survives serialize → parse', () => {
    const states = [
      { lens: 'time', tab: 'agenda' }, { lens: 'time', tab: 'roadmap' },
      { lens: 'code', tab: 'map' }, { lens: 'code', tab: 'review' },
      { lens: 'agents', tab: null }, { lens: 'graph', tab: null },
    ];
    for (const s of states) expect(parseHash(serializeHash(s))).toEqual(s);
  });
  it('the retired #time/month deep-link redirects to the agenda (Month tab killed)', () => {
    expect(parseHash('#time/month')).toEqual({ lens: 'time', tab: 'agenda' });
  });
  it('parses the deep-link forms', () => {
    expect(parseHash('#time/agenda')).toEqual({ lens: 'time', tab: 'agenda' });
    expect(parseHash('#code/review')).toEqual({ lens: 'code', tab: 'review' });
    expect(parseHash('#agents')).toEqual({ lens: 'agents', tab: null });
    expect(parseHash('#code')).toEqual({ lens: 'code', tab: 'map' });        // bare lens → default tab
  });
  it('unknown hashes (incl. #tour) are the graph, not an error', () => {
    expect(parseHash('#tour')).toEqual({ lens: 'graph', tab: null });
    expect(parseHash('#term:abc')).toEqual({ lens: 'graph', tab: null });
    expect(parseHash('#time/bogus')).toEqual({ lens: 'time', tab: 'agenda' });
  });
  it('sameState compares lens+tab', () => {
    expect(sameState({ lens: 'graph', tab: null }, { lens: 'graph' })).toBe(true);
    expect(sameState({ lens: 'code', tab: 'map' }, { lens: 'code', tab: 'review' })).toBe(false);
  });
});

describe('esc unwind order', () => {
  it('is the one documented stack', () => {
    expect(ESC_ORDER).toEqual(['file-reader', 'lens', 'report', 'inspector', 'focus', 'search']);
  });
  it('returns the topmost open layer', () => {
    expect(escTarget({ lens: true, report: true, focus: true })).toBe('lens');
    expect(escTarget({ 'file-reader': true, lens: true })).toBe('file-reader');
    expect(escTarget({ report: true, inspector: true })).toBe('report');
    expect(escTarget({ inspector: true, focus: true })).toBe('inspector');
    expect(escTarget({ focus: true })).toBe('focus');
    expect(escTarget({ search: true })).toBe('search');
  });
  it('nothing open → null', () => {
    expect(escTarget({})).toBe(null);
    expect(escTarget()).toBe(null);
  });
  it('exposes the closed lens set', () => {
    expect(LENSES).toEqual(['graph', 'time', 'code', 'agents']);
  });
});
