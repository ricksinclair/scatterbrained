import { describe, it, expect } from 'vitest';
import { TOUR, isValidTour } from '../public/lib/tour.js';

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
    expect(isValidTour([{ caption: 'no wait' }])).toBe(false);
    expect(isValidTour([{ wait: 100 }])).toBe(false);
    expect(isValidTour([{ caption: 'x', wait: 1, bogus: true }])).toBe(false);
    expect(isValidTour([])).toBe(false);
  });
});
