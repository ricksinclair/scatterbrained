import { describe, it, expect } from 'vitest';
import { parseChangelogTldr, shouldAnnounce, announceCopy } from '../public/lib/whatsnew.js';

const CHANGELOG = `# Changelog

Intro prose.

## [Unreleased]

### Docs
- Something not yet shipped.

## [0.2.0-alpha.5] — Ask before you think (2026-07-12)

**TL;DR (explain-like-I'm-5):** Loading an AI model used to just *happen* — now the
Studio **asks first**, with a full-screen consent.

**Technical:**

### Added
- Consent modal.

## [0.2.0-alpha.4] — Older (2026-07-09)

**TL;DR:** Older release.
`;

describe('parseChangelogTldr', () => {
  it('returns the newest RELEASED section TL;DR, skipping [Unreleased]', () => {
    const t = parseChangelogTldr(CHANGELOG);
    expect(t).toMatch(/^Loading an AI model/);
    expect(t).not.toMatch(/not yet shipped/);
    expect(t).not.toMatch(/Older release/);
  });
  it('strips markdown bold and collapses whitespace', () => {
    expect(parseChangelogTldr(CHANGELOG)).not.toContain('**');
    expect(parseChangelogTldr(CHANGELOG)).not.toContain('\n');
  });
  it('degrades to null on missing/odd input', () => {
    expect(parseChangelogTldr(null)).toBeNull();
    expect(parseChangelogTldr('')).toBeNull();
    expect(parseChangelogTldr('# Changelog\n\nno sections')).toBeNull();
    expect(parseChangelogTldr('## [1.0.0]\n\nNo tldr paragraph here.\n')).toBeNull();
  });
});

describe('shouldAnnounce', () => {
  it('announces only on a version change', () => {
    expect(shouldAnnounce('0.2.0-alpha.5', '0.2.0-alpha.6')).toBe(true);
  });
  it('is silent on first contact (no stored version)', () => {
    expect(shouldAnnounce(null, '0.2.0-alpha.6')).toBe(false);
    expect(shouldAnnounce(undefined, '0.2.0-alpha.6')).toBe(false);
    expect(shouldAnnounce('', '0.2.0-alpha.6')).toBe(false);
  });
  it('is silent when equal or when current is unknown', () => {
    expect(shouldAnnounce('0.2.0-alpha.6', '0.2.0-alpha.6')).toBe(false);
    expect(shouldAnnounce('0.2.0-alpha.5', null)).toBe(false);
  });
});

describe('announceCopy', () => {
  it('joins version and tldr when short', () => {
    expect(announceCopy('1.0.0', 'Short note.')).toBe('Updated to 1.0.0. Short note.');
  });
  it('truncates long tldr at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(60).trim();
    const copy = announceCopy('1.0.0', long, 50);
    expect(copy.length).toBeLessThan(70);
    expect(copy.endsWith('…')).toBe(true);
    expect(copy).not.toMatch(/wor…$/); // no mid-word cut
  });
  it('is version-only when tldr is null', () => {
    expect(announceCopy('1.0.0', null)).toBe('Updated to 1.0.0.');
  });
});
