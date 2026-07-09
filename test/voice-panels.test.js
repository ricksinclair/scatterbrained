import { describe, it, expect } from 'vitest';
import { renderAgendaBody, renderSearchBody, renderNodeBody, renderVizBody, renderCard, PANEL_ALLOWED } from '../public/lib/voice-panels.js';
import { deriveNodeView } from '../public/lib/node-view.js';

const digest = {
  now: '2026-07-04',
  due: {
    overdue: [{ id: 'n1', name: 'Late thing', label: 'Goal', kind: 'due', date: '2026-07-01', projects: [] }],
    today: [],
    this_week: [{ id: 'n2', name: 'Soon <thing>', label: 'Idea', kind: 'review', date: '2026-07-08', projects: ['P'] }],
    upcoming: [],
  },
};

describe('renderAgendaBody', () => {
  it('renders only non-empty buckets, rows clickable by node id, escaped', () => {
    const html = renderAgendaBody(digest);
    expect(html).toContain('Overdue');
    expect(html).toContain('This week');
    expect(html).not.toContain('Today');
    expect(html).toContain('data-node="n1"');
    expect(html).toContain('Soon &lt;thing&gt;');
    expect(html).not.toContain('<thing>');
  });
  it('empty digest → the designed empty state', () => {
    expect(renderAgendaBody({ due: {} })).toContain('Nothing due');
  });
});

describe('renderSearchBody', () => {
  it('rows with label chips + superseded marker; empty state', () => {
    const html = renderSearchBody([{ id: 'a', name: 'Hit', label: 'Idea', superseded: true }]);
    expect(html).toContain('data-node="a"');
    expect(html).toContain('superseded');
    expect(renderSearchBody([])).toContain('No matches');
  });
});

describe('renderNodeBody', () => {
  const node = { id: 'x', name: 'N', label: 'Idea', desc: 'A described node', edges: [{ type: 'PART_OF', dir: 'out', name: 'P', label: 'Project', id: 'p1' }], created_at: '2026-07-01T00:00:00Z' };
  it('renders registry components filtered to the requested allowed subset', () => {
    const { signals, data } = deriveNodeView(node, {}, { now: 1751600000000 });
    const html = renderNodeBody(signals, data, ['markdown']);
    expect(html).toContain('A described node');
    expect(html).not.toContain('c-relations');   // filtered out
  });
  it('ignores ids outside the closed set instead of rendering them', () => {
    const { signals, data } = deriveNodeView(node, {}, { now: 1751600000000 });
    const html = renderNodeBody(signals, data, ['bogus-component']);
    expect(html).toContain('Nothing to show');
  });
  it('no explicit list → the resolver order filtered to the closed set', () => {
    const { signals, data } = deriveNodeView(node, {}, { now: 1751600000000 });
    const html = renderNodeBody(signals, data, null);
    expect(html).toContain('c-relations');       // resolver-picked, in the set
    expect(html).not.toContain('c-resurface');   // resolver may pick it; the set excludes it
    expect(PANEL_ALLOWED).toContain('markdown');
  });
});

describe('renderVizBody', () => {
  it('draws the chart via the registry and footnotes the row count', () => {
    const html = renderVizBody({ kind: 'bar', title: 'by status', bars: [{ label: 'active', value: 3 }] }, 2);
    expect(html).toContain('c-chart');
    expect(html).toContain('ch-bar');
    expect(html).toContain('2 rows');
  });
  it('renders a line chart as SVG', () => {
    const html = renderVizBody({ kind: 'line', x: ['w1', 'w2'], series: [{ name: 's', values: [1, 5] }] }, 2);
    expect(html).toContain('<polyline');
  });
  it('is graceful when there is nothing to chart', () => {
    expect(renderVizBody(null)).toContain('vpn-empty');
  });
});

describe('renderCard', () => {
  const base = { panelId: 'p1', kind: 'agenda', title: 'What\'s <due>', replyTo: 'what "needs" me?', html: '<div>body</div>' };
  it('escapes header text, keeps body html, carries actions', () => {
    const html = renderCard({ ...base, collapsed: false });
    expect(html).toContain('What&#39;s &lt;due&gt;');
    expect(html).toContain('<div>body</div>');
    expect(html).toContain('data-panel-open="p1"');
    expect(html).toContain('data-panel-toggle="p1"');
    expect(html).toContain('re: “what &quot;needs&quot; me?”');
  });
  it('collapsed → a chip that re-expands', () => {
    const html = renderCard({ ...base, collapsed: true });
    expect(html).toContain('vpn-chip-card');
    expect(html).toContain('data-panel-toggle="p1"');
    expect(html).not.toContain('<div>body</div>');
  });
});
