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

describe('nextReview — spacing scheduler', () => {
  it('grows the interval on successive good recalls', () => {
    let s = nextReview('good');
    expect(s.interval).toBe(1);
    s = nextReview('good', s);
    expect(s.interval).toBe(6);
    const s3 = nextReview('good', s);
    expect(s3.interval).toBeGreaterThan(6);
  });
  it('resets to relearn on "again" and lowers ease', () => {
    const learned = nextReview('good', nextReview('good'));
    const lapsed = nextReview('again', learned);
    expect(lapsed.interval).toBe(0);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.ease).toBeLessThan(learned.ease);
  });
  it('easy jumps further than good', () => {
    expect(nextReview('easy').interval).toBeGreaterThan(nextReview('good').interval);
  });
});

describe('isDue', () => {
  it('new (no state) cards are due; future dueAt is not', () => {
    expect(isDue(undefined, 1000)).toBe(true);
    expect(isDue({ dueAt: 500 }, 1000)).toBe(true);
    expect(isDue({ dueAt: 2000 }, 1000)).toBe(false);
  });
});
