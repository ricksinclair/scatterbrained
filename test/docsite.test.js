import { describe, it, expect } from 'vitest';
import { DOC_TAXONOMY, classifyDoc, docPathOf, buildDocTree } from '../public/lib/docsite.js';

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
