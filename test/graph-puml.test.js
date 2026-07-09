import { describe, it, expect } from 'vitest';
import { toPlantuml, MAX_NODES } from '../public/lib/graph-puml.js';

const FOCUS = { id: 'f1', name: 'Atlas', label: 'Project' };
const NB = (i, over = {}) => ({ id: 'n' + i, name: 'Node ' + i, label: 'Insight', relType: 'INFORMS', dir: 'in', ...over });

describe('graph-puml — mindmap', () => {
  it('roots at the focus and groups depth-1 neighbors under rel-type branches', () => {
    const puml = toPlantuml({
      focus: FOCUS,
      neighbors: [NB(1), NB(2, { relType: 'PART_OF', dir: 'out' }), NB(3)],
    }, { kind: 'mindmap' });
    expect(puml).toMatch(/^@startmindmap/);
    expect(puml).toContain('* Atlas');
    expect(puml).toContain('** INFORMS');
    expect(puml).toContain('** PART_OF');
    expect(puml).toContain('*** Node 1');
    expect(puml.trim()).toMatch(/@endmindmap$/);
  });
  it('nests depth-2 leaves under their parent', () => {
    const puml = toPlantuml({
      focus: FOCUS,
      neighbors: [NB(1), NB(9, { depth: 2, parentId: 'n1', name: 'Grandchild' })],
    }, { kind: 'mindmap' });
    expect(puml).toContain('**** Grandchild');
  });
  it('caps at MAX_NODES with an honest +N more leaf', () => {
    const many = Array.from({ length: 60 }, (_, i) => NB(i));
    const puml = toPlantuml({ focus: FOCUS, neighbors: many }, { kind: 'mindmap' });
    expect((puml.match(/^\*\*\*/gm) || []).length).toBeLessThanOrEqual(MAX_NODES);
    expect(puml).toMatch(/\+\d+ more/);
  });
  it('escapes quotes and collapses whitespace in names', () => {
    const puml = toPlantuml({ focus: { ...FOCUS, name: 'A "quoted"\n  name' }, neighbors: [] }, { kind: 'mindmap' });
    expect(puml).toContain("* A 'quoted' name");
  });
});

describe('graph-puml — component', () => {
  it('emits label-stereotyped rectangles and typed, direction-honoring edges', () => {
    const puml = toPlantuml({
      focus: FOCUS,
      neighbors: [NB(1, { dir: 'in' }), NB(2, { dir: 'out', relType: 'CONTAINS', label: 'Idea' })],
    }, { kind: 'component' });
    expect(puml).toContain('rectangle "Atlas" as n0 <<Project>>');
    expect(puml).toContain('<<Insight>>');
    expect(puml).toContain('<<Idea>>');
    expect(puml).toMatch(/n1 --> n0 : INFORMS/);   // dir:'in' points at the focus
    expect(puml).toMatch(/n0 --> n2 : CONTAINS/);  // dir:'out' points away
  });
  it('depth-2 edges hang off their parent, not the focus', () => {
    const puml = toPlantuml({
      focus: FOCUS,
      neighbors: [NB(1), NB(2, { depth: 2, parentId: 'n1', relType: 'DERIVED_FROM', dir: 'out' })],
    }, { kind: 'component' });
    expect(puml).toMatch(/n1 --> n2 : DERIVED_FROM/);
  });
  it('overflow becomes a note, never silent truncation', () => {
    const many = Array.from({ length: 60 }, (_, i) => NB(i));
    const puml = toPlantuml({ focus: FOCUS, neighbors: many }, { kind: 'component' });
    expect(puml).toMatch(/\+\d+ more connections/);
  });
});

describe('graph-puml — contract', () => {
  it('returns null without a focus; defaults to mindmap', () => {
    expect(toPlantuml(null)).toBeNull();
    expect(toPlantuml({ focus: FOCUS })).toContain('@startmindmap');
  });
});
