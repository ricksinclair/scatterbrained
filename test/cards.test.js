import { describe, it, expect } from 'vitest';
import { parseCards, hasCards, nextReview, isDue } from '../public/lib/cards.js';

describe('parseCards', () => {
  it('extracts Q:/A: cards, A spanning continuation lines', () => {
    const cards = parseCards('Q: What is photosynthesis?\nA: The process plants use\nto convert light into energy.\nQ: Capital of France?\nA: Paris');
    expect(cards.length).toBe(2);
    expect(cards[0].front).toBe('What is photosynthesis?');
    expect(cards[0].back).toContain('light into energy');
    expect(cards[1].back).toBe('Paris');
  });
  it('falls back to cloze when there are no Q/A cards', () => {
    const cards = parseCards('The capital of {{North Carolina}} is Raleigh.');
    expect(cards.length).toBe(1);
    expect(cards[0].front).toContain('[…]');
    expect(cards[0].back).toContain('North Carolina');
    expect(cards[0].cloze).toBe(true);
  });
  it('drops incomplete cards and reports hasCards', () => {
    expect(parseCards('Q: lonely question with no answer')).toEqual([]);
    expect(hasCards('just prose, no cards')).toBe(false);
    expect(hasCards('Q: a\nA: b')).toBe(true);
  });
});

describe('nextReview — FSRS scheduler (vendored ts-fsrs)', () => {
  const T0 = Date.parse('2026-07-09T12:00:00Z');
  const day = (n) => T0 + n * 86400000;
  // review each step ON its due day (elapsed time is what grows FSRS stability)
  const chain = (grades) => {
    let s, t = T0;
    for (const g of grades) { s = nextReview(g, s, t); t += Math.max(s.interval, 0.01) * 86400000; }
    return s;
  };

  it('grows the interval across successive good recalls (learning step first)', () => {
    const s1 = nextReview('good', undefined, T0);
    expect(s1.interval).toBe(0);                       // learning step — again today
    const s2 = chain(['good', 'good']);
    expect(s2.interval).toBeGreaterThan(0);
    const s3 = chain(['good', 'good', 'good']);
    expect(s3.interval).toBeGreaterThan(s2.interval);  // stability compounds
  });
  it('"again" is a lapse: relearn today, stability collapses', () => {
    const learned = chain(['good', 'good', 'good']);
    const lapsed = nextReview('again', learned, day(30));
    expect(lapsed.interval).toBe(0);
    expect(lapsed.fsrs.stability).toBeLessThan(learned.fsrs.stability);
    expect(lapsed.fsrs.lapses).toBe(1);
  });
  it('easy schedules further than good from the same state', () => {
    const base = chain(['good', 'good']);
    const t = day(base.interval + 2);
    expect(nextReview('easy', base, t).interval).toBeGreaterThan(nextReview('good', base, t).interval);
  });
  it('the FSRS state JSON-round-trips through localStorage-style storage', () => {
    const s = chain(['good', 'good']);
    const revived = JSON.parse(JSON.stringify(s));
    const next = nextReview('good', revived, day(s.interval + 2));
    expect(next.interval).toBeGreaterThan(0);
    expect(next.fsrs.reps).toBe(s.fsrs.reps + 1);
  });
  it('legacy SM-2-lite state seeds FSRS instead of restarting: a mature card stays spaced out', () => {
    const legacy = { interval: 20, ease: 2.6, reps: 5 };   // what old localStorage holds
    const migrated = nextReview('good', legacy, T0);
    expect(migrated.interval).toBeGreaterThan(10);         // history respected, not relearned from day 1
    expect(migrated.fsrs.reps).toBe(6);
    const fresh = nextReview('good', undefined, T0);
    expect(migrated.interval).toBeGreaterThan(fresh.interval);
  });
  it('FSRS growth diverges from the old SM-2 ease ladder (not a reskin)', () => {
    // old scheduler: 3rd good = round(6 * 2.5) = 15 exactly; FSRS derives from stability
    const s3 = chain(['good', 'good', 'good']);
    expect(s3.interval).not.toBe(15);
  });
});

describe('isDue', () => {
  it('new (no state) cards are due; future dueAt is not', () => {
    expect(isDue(undefined, 1000)).toBe(true);
    expect(isDue({ dueAt: 500 }, 1000)).toBe(true);
    expect(isDue({ dueAt: 2000 }, 1000)).toBe(false);
  });
});
