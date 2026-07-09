import { describe, it, expect } from 'vitest';
import { nodeToHtml } from '../public/lib/export-html.js';

describe('nodeToHtml', () => {
  const signals = { name: 'Atlas', label: 'Project', status: 'active', desc: 'A system of record.', degree: 12 };
  const data = { valid_until: null };
  const parts = [
    { id: 'markdown', html: '<div class="c-markdown"><p>hello</p></div>' },
    { id: 'chart', html: '<div class="c-chart"><svg><rect/></svg></div>' },
  ];

  it('produces one self-contained document with an inline stylesheet', () => {
    const html = nodeToHtml(signals, data, parts, { css: '.c-chart{color:red}' });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<style>.c-chart{color:red}</style>');
    expect(html).toContain('Exported from Scatterbrained Studio');
  });

  it('embeds each composed part verbatim (SVG charts survive)', () => {
    const html = nodeToHtml(signals, data, parts, {});
    expect(html).toContain('<div class="c-markdown"><p>hello</p></div>');
    expect(html).toContain('<svg><rect/></svg>');
    expect(html).toContain('rpt-c-chart');
  });

  it('makes zero external requests — no src=/href= to fetch', () => {
    const html = nodeToHtml(signals, data, parts, { css: '' });
    expect(html).not.toMatch(/\ssrc=/);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script\b/i);
  });

  it('escapes a hostile node name (no injection through the header)', () => {
    const html = nodeToHtml({ name: '<img src=x onerror=alert(1)>', label: 'Project' }, {}, [], {});
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
