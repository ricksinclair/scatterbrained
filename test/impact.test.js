import { describe, it, expect } from 'vitest';
import { importsOf, importedBy, blastRadius, egoGraph } from '../public/lib/impact.js';

// entry → app → util → helper; app → styles.css; entry → app (so app is imported by entry).
const links = [
  { source: 'entry.ts', target: 'app.ts' },
  { source: 'app.ts', target: 'util.ts' },
  { source: 'app.ts', target: 'styles.css' },
  { source: 'util.ts', target: 'helper.ts' },
];
const nodes = {
  'entry.ts': { name: 'entry.ts', lang: 'ts', path: '/r/entry.ts' },
  'app.ts': { name: 'app.ts', lang: 'ts', path: '/r/app.ts' },
  'util.ts': { name: 'util.ts', lang: 'ts', path: '/r/util.ts' },
  'helper.ts': { name: 'helper.ts', lang: 'ts', path: '/r/helper.ts' },
  'styles.css': { name: 'styles.css', lang: 'css', path: '/r/styles.css' },
};

describe('impact queries (client-side, mirror of lib/codebase.js)', () => {
  it('importsOf: direct dependencies', () => {
    expect(importsOf(links, 'app.ts').sort()).toEqual(['styles.css', 'util.ts']);
    expect(importsOf(links, 'helper.ts')).toEqual([]);
  });
  it('importedBy: direct dependents (the direct blast radius)', () => {
    expect(importedBy(links, 'util.ts')).toEqual(['app.ts']);
    expect(importedBy(links, 'app.ts')).toEqual(['entry.ts']);
    expect(importedBy(links, 'entry.ts')).toEqual([]);
  });
  it('blastRadius: transitive dependents, excluding self', () => {
    expect(blastRadius(links, 'helper.ts').sort()).toEqual(['app.ts', 'entry.ts', 'util.ts']);
    expect(blastRadius(links, 'entry.ts')).toEqual([]);
  });
  it('egoGraph: 1-hop neighbourhood with the focus node flagged + display fields', () => {
    const g = egoGraph(links, 'app.ts', (rel) => nodes[rel]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['app.ts', 'entry.ts', 'styles.css', 'util.ts']);
    expect(g.nodes.find((n) => n.id === 'app.ts').focus).toBe(true);
    expect(g.nodes.find((n) => n.id === 'styles.css').lang).toBe('css');
    // directed edges: entry→app (importer) and app→util, app→styles (imports)
    expect(g.links).toContainEqual({ source: 'entry.ts', target: 'app.ts' });
    expect(g.links).toContainEqual({ source: 'app.ts', target: 'util.ts' });
    expect(g.links).toHaveLength(3);
  });
});
