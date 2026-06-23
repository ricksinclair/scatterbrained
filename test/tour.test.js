import { describe, it, expect } from 'vitest';
import { TOUR, isValidTour } from '../public/lib/tour.js';

// The guided tour (#14) — declarative beats interpreted by app.js over the demo graph.
describe('tour — beat list', () => {
  it('is a non-empty, valid sequence (caption + positive wait, recognized keys only)', () => {
    expect(isValidTour()).toBe(true);
    expect(TOUR.length).toBeGreaterThanOrEqual(6);
  });
  it('opens on the full constellation and ends back there', () => {
    expect(TOUR[0].focus).toBe(null);
    expect(TOUR[TOUR.length - 1].focus).toBe(null);
  });
  it('showcases the headline surfaces (protected facts, dock, calendar, review)', () => {
    const blob = JSON.stringify(TOUR).toLowerCase();
    expect(blob).toContain('protected-facts');     // scrollTo the protected-facts section
    expect(blob).toContain('#dock-toggle');         // the needs-review dock
    expect(blob).toContain('#set-calendar');        // the calendar
    expect(blob).toContain('#set-review');          // code review
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
