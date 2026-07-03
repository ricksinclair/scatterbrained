import { describe, it, expect } from 'vitest';
import { resolveReviewProject } from '../lib/review-project.js';

// createReview MERGEs (Review)-[:ABOUT]->(Project) using this resolver. It must be
// conservative: a wrong project edge is worse than no edge, so no/ambiguous match → null.
// Fixture mirrors the repo_url variety a real graph accumulates: github https, git@ ssh,
// local absolute path, a non-repo URL with a note, and null.
const PROJECTS = [
  { name: 'Orrery', repo_url: 'https://github.com/you/orrery' },
  { name: 'TidePool', repo_url: 'git@github.com:you/TidePool.git' },
  { name: 'Loom', repo_url: '/home/you/projects/loom' },
  { name: 'Junkdrawer', repo_url: 'https://github.com/you (backup)' },
  { name: 'fieldnotes', repo_url: null },
];

describe('resolveReviewProject — repo path → Project', () => {
  it('matches a github https repo_url by repo name', () => {
    expect(resolveReviewProject('/home/you/projects/orrery', PROJECTS)).toBe('Orrery');
  });

  it('matches a git@ ssh repo_url by repo name, stripping .git and ignoring case', () => {
    expect(resolveReviewProject('/home/you/projects/tidepool', PROJECTS)).toBe('TidePool');
  });

  it('matches a local-path repo_url exactly (normalized trailing slash)', () => {
    expect(resolveReviewProject('/home/you/projects/loom/', PROJECTS)).toBe('Loom');
  });

  it('falls back to Project.name when repo_url is unset', () => {
    expect(resolveReviewProject('/home/you/projects/fieldnotes', PROJECTS)).toBe('fieldnotes');
  });

  it('returns null when nothing matches (never guesses)', () => {
    expect(resolveReviewProject('/home/you/projects/some-scratch-repo', PROJECTS)).toBe(null);
  });

  it('returns null on an ambiguous tier instead of picking one', () => {
    const dup = [
      { name: 'Fork A', repo_url: 'https://github.com/a/tool' },
      { name: 'Fork B', repo_url: 'git@github.com:b/tool.git' },
    ];
    expect(resolveReviewProject('/home/you/projects/tool', dup)).toBe(null);
  });

  it('is not fooled by a non-repo repo_url (user URL with a note)', () => {
    expect(resolveReviewProject('/home/you/projects/junk', PROJECTS)).toBe(null);
  });

  it('handles empty/absent input safely', () => {
    expect(resolveReviewProject('', PROJECTS)).toBe(null);
    expect(resolveReviewProject('/', PROJECTS)).toBe(null);
    expect(resolveReviewProject('/home/you/projects/loom', [])).toBe(null);
    expect(resolveReviewProject('/home/you/projects/loom')).toBe(null);
  });
});
