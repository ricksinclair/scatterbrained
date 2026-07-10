import { describe, it, expect } from 'vitest';
import { DOC_TAXONOMY, classifyDoc, docPathOf, buildDocTree, parseDocMeta, firstH1 } from '../public/lib/docsite.js';

const S = (title, over = {}) => ({ title, display_title: title.split('/').pop(), file_path: '/x/' + title, source_kind: 'markdown', ...over });

describe('docsite — classifyDoc (table-driven over REAL title shapes)', () => {
  const CASES = [
    // [title, audience, section] — null audience = Working notes
    ['demo-notes/studio/README.md', 'user', 'overview'],
    ['cookbook-app/docs/GETTING-STARTED.md', 'user', 'getting-started'],
    ['x/docs/QUICKSTART.md', 'user', 'getting-started'],
    ['x/docs/guides/midi-setup.md', 'user', 'guides'],
    ['x/docs/HOWTO-record.md', 'user', 'guides'],
    ['x/docs/REFERENCE.md', 'user', 'reference'],
    ['x/docs/FAQ.md', 'user', 'faq'],
    ['x/docs/TROUBLESHOOTING.md', 'user', 'faq'],
    ['x/docs/admin/INSTALL.md', 'admin', 'install'],
    ['x/docs/admin/CONFIGURATION.md', 'admin', 'configuration'],
    ['x/docs/admin/DEPLOYMENT.md', 'admin', 'deployment'],
    ['x/docs/admin/BACKUP-RESTORE.md', 'admin', 'backup'],
    ['x/docs/admin/UPGRADE.md', 'admin', 'upgrade'],
    ['x/docs/admin/OPERATIONS.md', 'admin', 'operations'],
    // Builder — the stems the Scatterbrained set actually uses today
    ['demo-notes/studio/docs/SPEC-code-review.md', 'builder', 'architecture'],
    ['demo-notes/studio/SPEC.md', 'builder', 'architecture'],
    ['demo-notes/studio/docs/DESIGN-temporal.md', 'builder', 'architecture'],
    ['demo-notes/studio/docs/TEMPORAL-ARCHITECTURE.md', 'builder', 'architecture'],
    ['x/docs/ARCHITECTURE.md', 'builder', 'architecture'],
    ['x/docs/diagrams/system-overview.puml', 'builder', 'architecture'],
    ['x/docs/adr-0001-storage.md', 'builder', 'architecture'],
    ['x/CHANGELOG.md', 'builder', 'changelog'],
    ['demo-notes/studio/docs/CHANGELOG-alpha-3-draft.md', 'builder', 'changelog'],
    ['demo-notes/studio/docs/RELEASE-alpha-plan.md', 'builder', 'changelog'],
    ['x/CONTRIBUTING.md', 'builder', 'contributing'],
    ['demo-notes/studio/docs/WORKFLOW.md', 'builder', 'contributing'],
    // Working notes — real strays that must NOT be forced into a section
    ['demo-notes/studio/docs/RESEARCH-dataviz.md', null, null],
    ['demo-notes/studio/docs/MONETIZATION.md', null, null],
    ['demo-notes/studio/ROADMAP.md', null, null],
    ['demo-notes/studio/docs/SCREENS.md', null, null],
  ];
  for (const [title, aud, sec] of CASES) {
    it(`${title} → ${aud ? aud + '/' + sec : 'Working notes'}`, () => {
      const c = classifyDoc({ title });
      if (aud) expect(c).toEqual({ audience: aud, section: sec });
      else expect(c).toBeNull();
    });
  }
  it('docPathOf strips the root segment and the extension', () => {
    expect(docPathOf('demo-notes/studio/docs/SPEC.md')).toBe('studio/docs/spec');
  });
});

describe('docsite — buildDocTree', () => {
  const DOCS = [
    S('x/README.md'), S('x/docs/SPEC-a.md'), S('x/docs/SPEC-b.md'),
    S('x/docs/RESEARCH-viz.md'), S('x/notes/random.md'),
    S('x/docs/FAQ.md', { readable: false }),
  ];
  const tree = buildDocTree(DOCS);
  it('every doc appears exactly once (the never-hidden invariant)', () => {
    const all = [
      ...tree.audiences.flatMap((a) => a.sections.flatMap((s) => s.docs)),
      ...tree.notes.flatMap((n) => n.docs),
    ];
    expect(all).toHaveLength(DOCS.length);
    expect(new Set(all.map((d) => d.title)).size).toBe(DOCS.length);
  });
  it('empty sections and audiences are omitted (no scaffold-shaped emptiness)', () => {
    const aud = tree.audiences.find((a) => a.id === 'admin');
    expect(aud).toBeUndefined();                       // no admin docs in the fixture
    const user = tree.audiences.find((a) => a.id === 'user');
    expect(user.sections.map((s) => s.id)).toEqual(['overview', 'faq']);
  });
  it('working notes group by directory, sorted', () => {
    expect(tree.notes.map((n) => n.dir)).toEqual(['docs', 'notes']);
  });
  it('docs sort by display title within a section and carry the readable flag', () => {
    const arch = tree.audiences.find((a) => a.id === 'builder').sections[0];
    expect(arch.docs.map((d) => d.display_title)).toEqual(['SPEC-a.md', 'SPEC-b.md']);
    const faq = tree.audiences.find((a) => a.id === 'user').sections.find((s) => s.id === 'faq');
    expect(faq.docs[0].readable).toBe(false);
  });
  it('taxonomy shape is closed: three audiences with fixed sections', () => {
    expect(DOC_TAXONOMY.map((a) => a.id)).toEqual(['user', 'admin', 'builder']);
  });
});

describe('docsite — parseDocMeta (the per-doc escape hatch)', () => {
  it('reads audience/section/order from a leading frontmatter block', () => {
    expect(parseDocMeta('---\naudience: builder\nsection: contributing\norder: 2\n---\n# T'))
      .toEqual({ audience: 'builder', section: 'contributing', order: 2 });
  });
  it('returns {} when there is no frontmatter, and ignores a --- mid-document', () => {
    expect(parseDocMeta('# T\n\n---\naudience: user\n---')).toEqual({});
    expect(parseDocMeta('')).toEqual({});
  });
  it('tolerates malformed blocks: no closing fence, unknown keys, junk order', () => {
    expect(parseDocMeta('---\naudience: user\n# never closed')).toEqual({});
    expect(parseDocMeta('---\ntitle: X\naudience: user\nsection: guides\n---\n'))
      .toEqual({ audience: 'user', section: 'guides' });
    expect(parseDocMeta('---\norder: soon\naudience: user\nsection: guides\n---\n'))
      .toEqual({ audience: 'user', section: 'guides' });
  });
  it('lowercases values so Frontmatter: Builder still matches the taxonomy', () => {
    expect(parseDocMeta('---\naudience: Builder\nsection: Contributing\n---\n'))
      .toEqual({ audience: 'builder', section: 'contributing' });
  });
});

describe('docsite — classifyDoc with a meta override', () => {
  it('a valid audience/section pair wins over the filename convention', () => {
    const c = classifyDoc({ title: 'x/docs/DOC-CONVENTIONS.md', meta: { audience: 'builder', section: 'contributing' } });
    expect(c).toEqual({ audience: 'builder', section: 'contributing' });
    // …even when the filename WOULD match a rule
    expect(classifyDoc({ title: 'x/docs/QUICKSTART.md', meta: { audience: 'builder', section: 'architecture' } }))
      .toEqual({ audience: 'builder', section: 'architecture' });
  });
  it('invalid values fall back to convention (never a broken bucket)', () => {
    expect(classifyDoc({ title: 'x/docs/QUICKSTART.md', meta: { audience: 'wizard', section: 'spells' } }))
      .toEqual({ audience: 'user', section: 'getting-started' });
    // valid audience but a section from another audience → fall back too
    expect(classifyDoc({ title: 'x/docs/QUICKSTART.md', meta: { audience: 'builder', section: 'guides' } }))
      .toEqual({ audience: 'user', section: 'getting-started' });
    // partial meta (audience only) is not enough
    expect(classifyDoc({ title: 'x/docs/RANDOM.md', meta: { audience: 'user' } })).toBeNull();
  });
  it('the never-hidden invariant holds for meta docs too', () => {
    const docs = [
      { title: 'x/docs/DOC-CONVENTIONS.md', display_title: 'Doc conventions', file_path: '/x', source_kind: 'markdown', meta: { audience: 'builder', section: 'contributing' } },
      { title: 'x/docs/UNMATCHED.md', display_title: 'Stray', file_path: '/x', source_kind: 'markdown', meta: { audience: 'nope', section: 'nope' } },
    ];
    const tree = buildDocTree(docs);
    const all = [
      ...tree.audiences.flatMap((a) => a.sections.flatMap((s) => s.docs)),
      ...tree.notes.flatMap((n) => n.docs),
    ];
    expect(all).toHaveLength(2);
    expect(tree.audiences[0].sections[0].docs[0].display_title).toBe('Doc conventions');
    expect(tree.notes[0].docs[0].display_title).toBe('Stray');
  });
});

describe('docsite — order sort + builtin flag', () => {
  it('order: sorts within a section ahead of the alphabetical fallback', () => {
    const G = (n, order) => ({ title: `x/docs/guides/${n}.md`, display_title: n, file_path: '/x/' + n, source_kind: 'markdown', ...(order != null ? { meta: { order } } : {}) });
    const tree = buildDocTree([G('zebra', 1), G('alpha'), G('midway', 2)]);
    const guides = tree.audiences[0].sections.find((s) => s.id === 'guides');
    expect(guides.docs.map((d) => d.display_title)).toEqual(['zebra', 'midway', 'alpha']);
  });
  it('buildDocTree carries the builtin flag through docOf', () => {
    const tree = buildDocTree([{ title: 'scatterbrained/quickstart.md', display_title: 'Quickstart', file_path: '/docs/quickstart.md', source_kind: 'markdown', builtin: true }]);
    expect(tree.audiences[0].sections[0].docs[0].builtin).toBe(true);
  });
});

describe('docsite — firstH1 (display-title derivation for built-in docs)', () => {
  it('finds the first H1, skipping frontmatter, stripping trailing #s', () => {
    expect(firstH1('---\naudience: user\n---\n\n# Quickstart ##\ntext')).toBe('Quickstart');
    expect(firstH1('no headings here')).toBe(null);
    expect(firstH1('## h2 only\n# The Real Title')).toBe('The Real Title');
  });
});

describe('docsite — post-curation corpus regression (the Stage 5 rename table)', () => {
  const RENAMED = [
    ['scatterbrained/docs/DESIGN-screens.md', 'builder', 'architecture'],
    ['scatterbrained/docs/DESIGN-report-and-export.md', 'builder', 'architecture'],
    ['scatterbrained/docs/RESEARCH-monetization.md', null, null],
    ['scatterbrained/docs/PLAN-filereader-extraction.md', null, null],
    // internal/ docs stay Working notes — and PLAN-alpha-release must NOT hit the release→changelog rule
    ['scatterbrained/docs/internal/PLAN-alpha-release.md', null, null],
    ['scatterbrained/docs/internal/LEAK-REMEDIATION-PLAN.md', null, null],
    ['scatterbrained/docs/internal/HANDOFF-uml-impact-diagram.md', null, null],
    ['scatterbrained/docs/internal/REVIEW-2026-06-25.md', null, null],
  ];
  for (const [title, aud, sec] of RENAMED) {
    it(`${title.split('/docs/')[1]} → ${aud ? aud + '/' + sec : 'Working notes'}`, () => {
      const c = classifyDoc({ title });
      if (aud) expect(c).toEqual({ audience: aud, section: sec });
      else expect(c).toBeNull();
    });
  }
  it('internal docs group under one working-notes dir', () => {
    const docs = RENAMED.filter(([t]) => t.includes('/internal/'))
      .map(([t]) => ({ title: t, display_title: t.split('/').pop(), file_path: '/x', source_kind: 'markdown' }));
    const tree = buildDocTree(docs);
    expect(tree.notes).toHaveLength(1);
    expect(tree.notes[0].dir.endsWith('docs/internal')).toBe(true);
  });
});
