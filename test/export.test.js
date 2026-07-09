import { describe, it, expect } from 'vitest';
import { nodeToMarkdown, nodeToJson, exportFilename } from '../public/lib/export.js';

describe('nodeToMarkdown', () => {
  const signals = { name: 'Atlas', label: 'Project', desc: 'A system of record.', degree: 12, source_count: 2 };
  const data = {
    sources: [{ name: 'README.md', file_path: '/r.md' }, { name: 'web', url: 'https://x' }],
    edges: [
      { type: 'ABOUT', dir: 'in', name: 'note', label: 'Insight' },
      { type: 'REQUIRES', dir: 'out', name: 'funding', label: 'Idea' },
      { label: 'Source', dir: 'in', name: 'README.md' },
    ],
    source: { title: 'README.md', text: '# Atlas\nhello' },
  };
  it('renders a titled briefing with key-facts, sources, relations, excerpt', () => {
    const md = nodeToMarkdown(signals, data);
    expect(md).toMatch(/^# Atlas/);
    expect(md).toContain('*Project*');
    expect(md).toContain('A system of record.');
    expect(md).toContain('## Key facts');
    expect(md).toContain('## Sources (2)');
    expect(md).toContain('[README.md](/r.md)');
    expect(md).toContain('[web](https://x)');
    expect(md).toContain('## Relations');
    expect(md).toContain('## Excerpt — README.md');
    expect(md).toContain('Exported from Scatterbrained Studio');
  });
  it('orders relations by meaning (REQUIRES before ABOUT)', () => {
    const md = nodeToMarkdown(signals, data);
    expect(md.indexOf('REQUIRES')).toBeLessThan(md.indexOf('ABOUT'));
  });
  it('omits empty sections gracefully', () => {
    const md = nodeToMarkdown({ name: 'Bare', label: 'Person' }, {});
    expect(md).toContain('# Bare');
    expect(md).not.toContain('## Sources');
    expect(md).not.toContain('## Relations');
  });
});

describe('nodeToJson', () => {
  const signals = { id: 'n1', name: 'Atlas', label: 'Project', status: 'active', tags: ['atlas'], desc: 'A system of record.', degree: 12, source_count: 2 };
  const data = {
    created_at: '2026-01-01T00:00:00Z',
    sources: [{ name: 'README.md', file_path: '/r.md', source_kind: 'markdown' }, { name: 'web', url: 'https://x' }],
    edges: [
      { type: 'ABOUT', dir: 'in', name: 'note', label: 'Insight' },
      { type: 'REQUIRES', dir: 'out', name: 'funding', label: 'Idea' },
      { label: 'Source', dir: 'in', name: 'README.md' },
    ],
    chart: { kind: 'bar', title: 'by status', bars: [{ label: 'active', value: 3 }] },
  };
  it('carries node identity, facts, ranked edges, sources, and the chart spec', () => {
    const j = nodeToJson(signals, data);
    expect(j.node).toMatchObject({ id: 'n1', name: 'Atlas', label: 'Project', status: 'active', created_at: '2026-01-01T00:00:00Z' });
    expect(j.node.tags).toEqual(['atlas']);
    expect(j.text).toBe('A system of record.');
    expect(Array.isArray(j.facts)).toBe(true);
    expect(j.chart).toEqual(data.chart);
    // the raw Source edge is excluded from relations; REQUIRES ranks before ABOUT
    expect(j.edges.map((e) => e.type)).toEqual(['REQUIRES', 'ABOUT']);
    expect(j.sources).toHaveLength(2);
    expect(j.sources[0]).toMatchObject({ name: 'README.md', file_path: '/r.md', source_kind: 'markdown' });
  });
  it('is JSON-serializable and null-safe on a bare node', () => {
    const j = nodeToJson({ name: 'Bare', label: 'Person' }, {});
    expect(() => JSON.stringify(j)).not.toThrow();
    expect(j.chart).toBeNull();
    expect(j.edges).toEqual([]);
    expect(j.sources).toEqual([]);
  });
});

describe('exportFilename', () => {
  it('slugifies the node name, defaulting to .md', () => {
    expect(exportFilename('Ship Atlas MVP!')).toBe('ship-atlas-mvp.md');
    expect(exportFilename('')).toBe('node.md');
  });
  it('honors an explicit extension', () => {
    expect(exportFilename('Atlas', 'html')).toBe('atlas.html');
    expect(exportFilename('Atlas', 'json')).toBe('atlas.json');
  });
});
