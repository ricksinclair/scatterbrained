import { describe, it, expect } from 'vitest';
import { bucketIdeas, cwdHint, deriveBriefInput, buildBriefMarkdown } from '../public/lib/brief.js';

// The graph→agent brief (Phase 2 "Open agent here"): pure derivation from a node's /api/node
// payload → the SLIPWAY_BRIEF.md the agent loads as opening context. These guard the load-bearing
// pure bits; the launch orchestration (cwd sandbox, file write, Slipway proxy) is server-side.

describe('bucketIdeas — now / next / blocked from free-form status', () => {
  it('routes statuses to the right bucket and drops done', () => {
    const b = bucketIdeas([
      { name: 'A', status: 'active' }, { name: 'B', status: 'in_progress' },
      { name: 'C', status: 'proposed' }, { name: 'D', status: 'next_up' },
      { name: 'E', status: 'blocked' }, { name: 'F', status: 'open_question' },
      { name: 'G', status: 'implemented' }, { name: 'H', status: 'done' },
    ]);
    expect(b.now.map((i) => i.name)).toEqual(['A', 'B']);
    expect(b.next.map((i) => i.name)).toEqual(['C', 'D']);
    expect(b.blocked.map((i) => i.name)).toEqual(['E', 'F']);
    // implemented + done are dropped (not work-to-do)
    expect([...b.now, ...b.next, ...b.blocked].map((i) => i.name)).not.toContain('G');
    expect([...b.now, ...b.next, ...b.blocked].map((i) => i.name)).not.toContain('H');
  });

  it('unknown/empty status falls through to next', () => {
    const b = bucketIdeas([{ name: 'X', status: 'weird' }, { name: 'Y' }]);
    expect(b.next.map((i) => i.name)).toEqual(['X', 'Y']);
  });

  it('is case-insensitive and trims', () => {
    expect(bucketIdeas([{ name: 'Z', status: '  In-Progress ' }]).now).toHaveLength(1);
  });
});

describe('cwdHint — best-effort local path from a node', () => {
  it('prefers the node file_path', () => {
    expect(cwdHint({ file_path: '/a/b.md', all_sources: [{ file_path: '/c' }] })).toBe('/a/b.md');
  });
  it('falls back to a git_repo Source over other sources', () => {
    expect(cwdHint({ all_sources: [{ file_path: '/x/readme.md' }, { source_kind: 'git_repo', file_path: '/repo' }] })).toBe('/repo');
  });
  it('then any source, then any edge with a file_path', () => {
    expect(cwdHint({ all_sources: [{ file_path: '/only' }] })).toBe('/only');
    expect(cwdHint({ edges: [{ label: 'Project', file_path: '/proj' }] })).toBe('/proj');
  });
  it('returns null when nothing has a path', () => {
    expect(cwdHint({ edges: [{ label: 'Idea' }] })).toBeNull();
    expect(cwdHint({})).toBeNull();
  });
});

describe('deriveBriefInput — map /api/node edges to brief sections', () => {
  const node = {
    name: 'Slipway', label: 'Project', desc: 'A launchpad.', status: 'active',
    props: { domain: 'software', tags: ['mac'] },
    all_sources: [{ name: 'README', url: null, file_path: '/r', source_kind: 'git_repo' }],
    edges: [
      { label: 'Goal', name: 'Ship it', status: 'active' },
      { label: 'Idea', name: 'Terminals', status: 'implemented' },
      { label: 'Insight', name: 'Enum-only launch is safe' },
      { label: 'Source', name: 'noise', dir: 'in' },
    ],
  };
  it('extracts goals / ideas / insights / sources by label', () => {
    const inp = deriveBriefInput(node);
    expect(inp.goals).toEqual([{ name: 'Ship it', status: 'active' }]);
    expect(inp.ideas).toEqual([{ name: 'Terminals', status: 'implemented' }]);
    expect(inp.insights).toEqual(['Enum-only launch is safe']);
    expect(inp.sources[0]).toMatchObject({ name: 'README', kind: 'git_repo' });
    expect(inp.domain).toBe('software');
    expect(inp.tags).toEqual(['mac']);
  });
});

describe('buildBriefMarkdown — the SLIPWAY_BRIEF.md string', () => {
  it('renders headings, the cwd footer, and honest empty-state fallbacks', () => {
    const md = buildBriefMarkdown({ name: 'Empty', label: 'Idea' }, '/work/dir');
    expect(md).toMatch(/^# Empty — agent brief/);
    expect(md).toContain('## What this is');
    expect(md).toContain('## Now / Next / Blocked');
    expect(md).toContain('_No description recorded in the graph._');
    expect(md).toContain('_nothing in progress_');
    expect(md).toContain('/work/dir');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('buckets ideas into Now/Next/Blocked and lists goals + insights', () => {
    const md = buildBriefMarkdown({
      name: 'P', label: 'Project', description: 'desc',
      goals: [{ name: 'G1', status: 'active' }],
      ideas: [{ name: 'Doing', status: 'active' }, { name: 'Later', status: 'proposed' }, { name: 'Stuck', status: 'blocked' }],
      insights: ['insight one'],
    }, '/d');
    expect(md).toContain('- **G1** (active)');
    expect(md).toMatch(/### Now\n- \*\*Doing\*\* \(active\)/);
    expect(md).toMatch(/### Next\n- Later \(proposed\)/);
    expect(md).toMatch(/### Blocked[^\n]*\n- Stuck \(blocked\)/);
    expect(md).toContain('- insight one');
  });

  it('caps insights at 8 and sources at 12', () => {
    const md = buildBriefMarkdown({
      name: 'C', label: 'Project',
      insights: Array.from({ length: 20 }, (_, i) => `ins ${i}`),
      sources: Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, url: `http://x/${i}` })),
    }, '/d');
    expect((md.match(/- ins \d+/g) || []).length).toBe(8);
    expect((md.match(/\[s\d+\]/g) || []).length).toBe(12);
  });
});
