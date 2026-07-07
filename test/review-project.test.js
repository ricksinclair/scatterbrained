import { describe, it, expect } from 'vitest';
import { resolveReviewProject } from '../lib/review-project.js';

// createReview MERGEs (Review)-[:ABOUT]->(Project) using this resolver. It must be
// conservative: a wrong project edge is worse than no edge, so no/ambiguous match → null.
// Fixture mirrors the live graph's actual repo_url variety: github https, git@ ssh,
// local absolute path, a non-repo URL with a note, and null.
const PROJECTS = [
  { name: 'Scatterbrained', repo_url: 'https://github.com/ricksinclair/scatterbrained' },
  { name: 'TriviaGame', repo_url: 'git@github.com:ricksinclair/TriviaGame.git' },
  { name: 'Boardwalk', repo_url: '/Users/alice/Projects/boardwalk' },
  { name: 'Atlas', repo_url: 'https://github.com/ricksinclair (backup)' },
  { name: 'demo-notes', repo_url: null },
];

describe('resolveReviewProject — repo path → Project', () => {
  it('matches a github https repo_url by repo name', () => {
    expect(resolveReviewProject('/Users/alice/Projects/scatterbrained', PROJECTS)).toBe('Scatterbrained');
  });

  it('matches a git@ ssh repo_url by repo name, stripping .git and ignoring case', () => {
    expect(resolveReviewProject('/Users/alice/Projects/triviagame', PROJECTS)).toBe('TriviaGame');
  });

  it('matches a local-path repo_url exactly (normalized trailing slash)', () => {
    expect(resolveReviewProject('/Users/alice/Projects/boardwalk/', PROJECTS)).toBe('Boardwalk');
  });

  it('falls back to Project.name when repo_url is unset', () => {
    expect(resolveReviewProject('/Users/alice/Projects/demo-notes', PROJECTS)).toBe('demo-notes');
  });

  it('returns null when nothing matches (never guesses)', () => {
    expect(resolveReviewProject('/Users/alice/Projects/some-scratch-repo', PROJECTS)).toBe(null);
  });

  it('returns null on an ambiguous tier instead of picking one', () => {
    const dup = [
      { name: 'Fork A', repo_url: 'https://github.com/a/tool' },
      { name: 'Fork B', repo_url: 'git@github.com:b/tool.git' },
    ];
    expect(resolveReviewProject('/Users/alice/Projects/tool', dup)).toBe(null);
  });

  it('is not fooled by a non-repo repo_url (user URL with a note)', () => {
    expect(resolveReviewProject('/Users/alice/Projects/atlas-scratch', PROJECTS)).toBe(null);
  });

  it('handles empty/absent input safely', () => {
    expect(resolveReviewProject('', PROJECTS)).toBe(null);
    expect(resolveReviewProject('/', PROJECTS)).toBe(null);
    expect(resolveReviewProject('/Users/alice/Projects/boardwalk', [])).toBe(null);
    expect(resolveReviewProject('/Users/alice/Projects/boardwalk')).toBe(null);
  });
});
