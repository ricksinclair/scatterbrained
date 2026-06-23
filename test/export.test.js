import { describe, it, expect } from 'vitest';
import { nodeToMarkdown, exportFilename } from '../public/lib/export.js';

describe('nodeToMarkdown', () => {
  const signals = { name: 'Northwind', label: 'Project', desc: 'A system of record.', degree: 12, source_count: 2 };
  const data = {
    sources: [{ name: 'README.md', file_path: '/r.md' }, { name: 'web', url: 'https://x' }],
    edges: [
      { type: 'ABOUT', dir: 'in', name: 'note', label: 'Insight' },
      { type: 'REQUIRES', dir: 'out', name: 'funding', label: 'Idea' },
      { label: 'Source', dir: 'in', name: 'README.md' },
    ],
    source: { title: 'README.md', text: '# Northwind\nhello' },
  };
  it('renders a titled briefing with key-facts, sources, relations, excerpt', () => {
    const md = nodeToMarkdown(signals, data);
    expect(md).toMatch(/^# Northwind/);
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

describe('exportFilename', () => {
  it('slugifies the node name', () => {
    expect(exportFilename('Ship Northwind MVP!')).toBe('ship-northwind-mvp.md');
    expect(exportFilename('')).toBe('node.md');
  });
});
