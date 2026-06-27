import { describe, it, expect } from 'vitest';
import { parseIntent, INTENTS, isIntentKind } from '../public/lib/intent.js';

describe('parseIntent', () => {
  it('recognizes the curated intents', () => {
    expect(parseIntent("what's blocked?").kind).toBe('blocked');
    expect(parseIntent('show me stale memories').kind).toBe('review');
    expect(parseIntent('what changed this week').kind).toBe('new');
    expect(parseIntent('what should I work on next').kind).toBe('next');
    expect(parseIntent('my goals').kind).toBe('goals');
    expect(parseIntent('what is due to revisit').kind).toBe('due');
  });
  it('falls back to search with the term preserved', () => {
    const r = parseIntent('Northwind logistics');
    expect(r.kind).toBe('search');
    expect(r.term).toBe('Northwind logistics');
  });
  it('empty query is an empty search', () => {
    expect(parseIntent('  ').kind).toBe('search');
    expect(parseIntent('').term).toBe('');
  });
  it('exposes the advertised intents and validates kinds', () => {
    expect(INTENTS.length).toBeGreaterThanOrEqual(5);
    expect(isIntentKind('blocked')).toBe(true);
    expect(isIntentKind('bogus')).toBe(false);
  });
});
