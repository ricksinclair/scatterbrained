import { describe, it, expect } from 'vitest';
import {
  TOUR, TOURS, TOUR_LABELS, isValidTour, isValidTourRegistry,
  popoverPosition, tourSeen, markTourSeen, snoozeTours, shouldOfferTour,
} from '../public/lib/tour.js';

// The guided tour (#14), rewritten for the rail + palette + lens IA (D7) — declarative
// beats interpreted by tour-ui.js over the demo graph.
describe('tour — beat list', () => {
  it('is a non-empty, valid sequence (caption + positive wait, recognized keys only)', () => {
    expect(isValidTour()).toBe(true);
    expect(TOUR.length).toBeGreaterThanOrEqual(10);
  });
  it('opens on the full constellation and ends back there', () => {
    expect(TOUR[0].focus).toBe(null);
    expect(TOUR[TOUR.length - 1].focus).toBe(null);
  });
  it('walks the new IA: rail lenses, brief, palette, inspector→report, capture, settings', () => {
    const blob = JSON.stringify(TOUR).toLowerCase();
    expect(blob).toContain('#rail-graph');            // the rail itself
    expect(blob).toContain('.dock-resume');           // the Daily Brief on the resume card
    expect(blob).toContain('#rail-time');             // Time lens (Agenda-first)
    expect(blob).toContain('#rail-code');             // Code lens…
    expect(blob).toContain('data-tab=\\"review\\"'.toLowerCase()); // …landing on the Review tab
    expect(blob).toContain('#rail-agents');           // Agents / Act loop
    expect(blob).toContain('#rail-capture');          // Capture (+)
    expect(blob).toContain('#rail-settings');         // Settings (theme + UI size)
    expect(blob).toContain('protected-facts');        // scrollTo the protected-facts section
    expect(blob).toContain('#i-expand');              // inspector → report altitude
  });
  it('asks the palette a question (the type beat drives #q)', () => {
    const typed = TOUR.filter((s) => typeof s.type === 'string');
    expect(typed.length).toBeGreaterThanOrEqual(1);
    expect(typed[0].type.length).toBeGreaterThan(0);
  });
  it('every click target is a selector string or array of them', () => {
    for (const s of TOUR) {
      if (!('click' in s)) continue;
      const sels = Array.isArray(s.click) ? s.click : [s.click];
      expect(sels.every((x) => typeof x === 'string' && x.length)).toBe(true);
    }
  });
  it('rejects a malformed tour', () => {
    expect(isValidTour([{ caption: 'no title' }])).toBe(false);       // title now required
    expect(isValidTour([{ title: 'no body' }])).toBe(false);          // caption required
    expect(isValidTour([{ title: 't', caption: 'c', wait: 0 }])).toBe(false); // wait, if present, must be > 0
    expect(isValidTour([{ title: 't', caption: 'c', bogus: true }])).toBe(false);
    expect(isValidTour([])).toBe(false);
  });
});

describe('tour registry (schema v2)', () => {
  it('every registered tour is well-formed and surface tours stay digestible', () => {
    expect(isValidTourRegistry()).toBe(true);
  });
  it('has one tour per surface, each with a label', () => {
    for (const id of ['showcase', 'graph', 'inspector', 'time', 'code', 'agents', 'capture', 'voice']) {
      expect(TOURS[id], id).toBeTruthy();
      expect(TOUR_LABELS[id], id).toBeTruthy();
    }
  });
  it('surface tours open the surface they describe as their first step', () => {
    expect(TOURS.graph[0].click).toBe('#rail-graph');
    expect(TOURS.time[0].click).toBe('#rail-time');
    expect(TOURS.code[0].click).toBe('#rail-code');
    expect(TOURS.voice[0].click).toBe('#rail-assistant');
  });
  it('surface steps advance manually (no wait) — the showcase auto-advances', () => {
    expect(TOURS.graph.every((s) => s.wait === undefined)).toBe(true);
    expect(TOUR.every((s) => typeof s.wait === 'number')).toBe(true);
  });
});

describe('popoverPosition', () => {
  const vp = { w: 1000, h: 800 };
  it('centers when there is no target', () => {
    const p = popoverPosition(null, vp, { w: 300, h: 150 });
    expect(p.placement).toBe('center');
    expect(p.left).toBe(350);
    expect(p.top).toBe(325);
  });
  it('prefers below a target with room underneath', () => {
    const t = { left: 400, top: 100, right: 500, bottom: 140, width: 100, height: 40 };
    const p = popoverPosition(t, vp, { w: 300, h: 150 });
    expect(p.placement).toBe('bottom');
    expect(p.top).toBe(152);            // bottom + gap
  });
  it('flips above when there is no room below', () => {
    const t = { left: 400, top: 700, right: 500, bottom: 760, width: 100, height: 60 };
    const p = popoverPosition(t, vp, { w: 300, h: 150 });
    expect(p.placement).toBe('top');
  });
  it('clamps within the viewport margins', () => {
    const t = { left: 960, top: 100, right: 1000, bottom: 140, width: 40, height: 40 };
    const p = popoverPosition(t, vp, { w: 300, h: 150 });
    expect(p.left).toBeLessThanOrEqual(1000 - 300 - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
});

describe('tour persistence helpers', () => {
  it('offers on a fresh store, and not once something is seen', () => {
    expect(shouldOfferTour(undefined, 1000)).toBe(true);
    expect(shouldOfferTour({}, 1000)).toBe(true);
    const s = markTourSeen({}, 'showcase');
    expect(tourSeen(s, 'showcase')).toBe(true);
    expect(shouldOfferTour(s, 1000)).toBe(false);
  });
  it('suppresses the offer during a snooze window, then resumes', () => {
    const s = snoozeTours({}, 5000);
    expect(shouldOfferTour(s, 1000)).toBe(false);   // still snoozed
    expect(shouldOfferTour(s, 6000)).toBe(true);    // snooze elapsed, nothing seen yet
  });
});
