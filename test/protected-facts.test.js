import { describe, it, expect } from 'vitest';
import { PROTECTED_FACT_KINDS, isProtectedFactKind, normalizeValue, detectCandidates, checkRewrite } from '../public/lib/protected-facts.js';

// Protected key-facts (#23). The pure core: a closed kind vocab, deterministic candidate
// detection, value normalization, and the rewrite-guard diff.
describe('protected-facts — kind vocab', () => {
  it('exposes the closed kind set', () => {
    expect(PROTECTED_FACT_KINDS).toContain('money');
    expect(PROTECTED_FACT_KINDS).toContain('citation');
    expect(PROTECTED_FACT_KINDS).toContain('date');
    expect(PROTECTED_FACT_KINDS).toContain('other');
  });
  it('isProtectedFactKind gates the set', () => {
    expect(isProtectedFactKind('money')).toBe(true);
    expect(isProtectedFactKind('statute')).toBe(false);
    expect(isProtectedFactKind('')).toBe(false);
    expect(isProtectedFactKind(null)).toBe(false);
  });
});

describe('protected-facts — normalizeValue', () => {
  it('is case-, space-, and comma-insensitive on the digits that matter', () => {
    expect(normalizeValue('$4,200')).toBe(normalizeValue('$4200'));
    expect(normalizeValue('  Section   12 ')).toBe('section 12');
  });
  it('tightens § spacing and unifies U.S.C. forms', () => {
    expect(normalizeValue('17 U.S.C. § 107')).toBe(normalizeValue('17 USC §107'));
  });
  it('handles null/empty', () => {
    expect(normalizeValue(null)).toBe('');
    expect(normalizeValue('')).toBe('');
  });
});

describe('protected-facts — detectCandidates', () => {
  it('finds money, percent, dates, and statutory citations', () => {
    const c = detectCandidates('We paid $4,200 (a 12% cut) on 2026-06-17 per 17 U.S.C. §107.');
    const kinds = c.map((x) => x.kind);
    expect(kinds).toContain('money');
    expect(kinds).toContain('percent');
    expect(kinds).toContain('date');
    expect(kinds).toContain('citation');
    expect(c.map((x) => x.value)).toContain('17 U.S.C. §107');
  });
  it('detects form numbers as citations', () => {
    const c = detectCandidates('File a 1099-MISC and an 1040-X.');
    expect(c.filter((x) => x.kind === 'citation').map((x) => x.value)).toEqual(
      expect.arrayContaining(['1099-MISC', '1040-X']),
    );
  });
  it('does not also flag a money amount as a bare number (priority/no-overlap)', () => {
    const c = detectCandidates('$4,200');
    expect(c).toHaveLength(1);
    expect(c[0].kind).toBe('money');
  });
  it('trims trailing sentence punctuation from a match', () => {
    const c = detectCandidates('per 17 U.S.C. §107.');
    expect(c.find((x) => x.kind === 'citation').value).toBe('17 U.S.C. §107');
  });
  it('returns matches in document order', () => {
    const c = detectCandidates('first 50% then $9.99');
    expect(c[0].index).toBeLessThan(c[1].index);
  });
  it('empty/whitespace text yields nothing', () => {
    expect(detectCandidates('')).toEqual([]);
    expect(detectCandidates(null)).toEqual([]);
    expect(detectCandidates('plain prose, no figures')).toEqual([]);
  });
});

describe('protected-facts — checkRewrite (the guard)', () => {
  const facts = [
    { id: 'a', value: '17 U.S.C. §107', kind: 'citation' },
    { id: 'b', value: '$4,200', kind: 'money' },
  ];
  it('passes when every fact still appears (space/comma-tolerant)', () => {
    const r = checkRewrite(facts, 'Per 17 USC § 107 the filing fee was $4200.');
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it('flags a dropped fact with no replacement', () => {
    const r = checkRewrite(facts, 'Per 17 U.S.C. §107, dividends were distributed.');
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ id: 'b', status: 'dropped', suggestedNew: null });
  });
  it('flags an altered fact and suggests the lone same-kind replacement', () => {
    const r = checkRewrite(facts, 'Per 17 U.S.C. §107 the dividend was $4,300.');
    expect(r.ok).toBe(false);
    const v = r.violations.find((x) => x.id === 'b');
    expect(v.status).toBe('altered');
    expect(v.suggestedNew).toBe('$4,300');
  });
  it('stays dropped (not altered) when the new text has multiple same-kind candidates', () => {
    const r = checkRewrite(facts, 'Per 17 U.S.C. §107 we split $4,300 and $1,000.');
    const v = r.violations.find((x) => x.id === 'b');
    expect(v.status).toBe('dropped');
    expect(v.suggestedNew).toBe(null);
    expect(v.nearby).toEqual(expect.arrayContaining(['$4,300', '$1,000']));
  });
  it('uses stored value_norm when present', () => {
    const r = checkRewrite([{ id: 'c', value: '$4,200', value_norm: '$4200', kind: 'money' }], 'cost: $4200');
    expect(r.ok).toBe(true);
  });
  it('handles empty facts', () => {
    expect(checkRewrite([], 'anything').ok).toBe(true);
    expect(checkRewrite(null, 'anything').ok).toBe(true);
  });
});
