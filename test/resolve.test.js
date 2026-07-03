import { describe, it, expect } from 'vitest';
import { resolveLayout } from '../public/lib/resolve.js';

describe('resolveLayout — the graph expresses its own UI', () => {
  it('renders a markdown-sourced node as markdown (+ provenance when sourced)', () => {
    const out = resolveLayout({ label: 'Source', sourceKind: 'markdown', hasText: true, filePath: '/x.md', sourceCount: 1 });
    expect(out).toContain('markdown');
    expect(out).toContain('provenance');
    expect(out).not.toContain('text');                 // markdown supersedes plain text
    expect(out.indexOf('markdown')).toBeLessThan(out.indexOf('provenance'));
  });

  it('renders a tabular source as a chart', () => {
    expect(resolveLayout({ label: 'Source', sourceKind: 'csv', isTabular: true })).toContain('chart');
    expect(resolveLayout({ label: 'Insight', isTabular: true })).toContain('chart');
  });

  it('shows a confidence meter for a Rule with confidence', () => {
    expect(resolveLayout({ label: 'Rule', confidence: 'medium' })).toContain('confidence');
    expect(resolveLayout({ label: 'Rule' })).not.toContain('confidence');
  });

  it('shows goal progress for a Goal', () => {
    expect(resolveLayout({ label: 'Goal' })).toContain('goal-progress');
  });

  it('shows a map when the node has a jurisdiction', () => {
    expect(resolveLayout({ label: 'Organization', jurisdiction: 'NC' })).toContain('map');
  });

  it('pulls an excerpt for a node with a primary file/url but no inline text', () => {
    expect(resolveLayout({ label: 'Resource', url: 'https://x' })).toContain('excerpt');
    expect(resolveLayout({ label: 'Source', filePath: '/a.pdf', sourceKind: 'pdf' })).toContain('excerpt');
  });

  it('embeds video for a video URL, a link card for any other web URL', () => {
    const yt = resolveLayout({ label: 'Resource', url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(yt).toContain('video');
    expect(yt).not.toContain('link');                                  // video wins over link
    const web = resolveLayout({ label: 'Resource', url: 'https://nytimes.com/x' });
    expect(web).toContain('link');
    expect(web).not.toContain('video');
  });

  it('shows a bi-temporal timeline for superseded / historical nodes', () => {
    expect(resolveLayout({ label: 'Insight', superseded: true })).toContain('timeline');
  });

  it('honors an explicit ui order from the graph', () => {
    const out = resolveLayout({ label: 'Insight', ui: ['chart', 'markdown'], hasText: true });
    expect(out[0]).toBe('chart');
    expect(out[1]).toBe('markdown');
  });

  it('honors a single render hint first, and ui:* tags', () => {
    expect(resolveLayout({ label: 'Insight', renderHint: 'map' })[0]).toBe('map');
    expect(resolveLayout({ label: 'Insight', tags: ['ui:chart', 'northwind'] })).toContain('chart');
  });

  it('adds ai-summary only when an LLM is connected', () => {
    expect(resolveLayout({ label: 'Insight', hasText: true }, { llm: true })).toContain('ai-summary');
    expect(resolveLayout({ label: 'Insight', hasText: true }, { llm: false })).not.toContain('ai-summary');
    // even an explicit hint can't summon ai-summary without the capability
    expect(resolveLayout({ label: 'Insight', ui: ['ai-summary'] }, {})).not.toContain('ai-summary');
  });

  it('offers the key-value Properties view (always-on) + governance/inbox', () => {
    expect(resolveLayout({ label: 'Person' })).toEqual(['keyvalue', 'protected-facts', 'notes']);
  });

  it('composes a plain insight as text + resurface + provenance + relations + keyvalue + protected-facts + notes', () => {
    expect(resolveLayout({ label: 'Insight', hasText: true, sourceCount: 2, edgeCount: 3 }))
      .toEqual(['text', 'resurface', 'provenance', 'relations', 'keyvalue', 'protected-facts', 'notes']);   // keyvalue (Properties) always-on; protected-facts + notes last
  });

  it('offers notes on every node (deferred-instruction inbox)', () => {
    expect(resolveLayout({ label: 'Person' })).toContain('notes');           // even the keyvalue fallback case
    expect(resolveLayout({ label: 'Goal' })).toContain('notes');
  });

  it('offers acceptance criteria on Idea/Project, or wherever criteria already exist', () => {
    expect(resolveLayout({ label: 'Idea' })).toContain('acceptance');
    expect(resolveLayout({ label: 'Project' })).toContain('acceptance');
    expect(resolveLayout({ label: 'Person' })).not.toContain('acceptance');
    expect(resolveLayout({ label: 'Person', criterionCount: 2 })).toContain('acceptance');
  });

  it('never emits an unknown component id', () => {
    const KNOWN = new Set(['markdown', 'excerpt', 'chart', 'text', 'timeline', 'resurface', 'provenance', 'relations', 'confidence', 'goal-progress', 'map', 'keyvalue', 'ai-summary', 'protected-facts', 'notes', 'acceptance', 'video', 'link']);
    const out = resolveLayout({ label: 'Insight', ui: ['bogus', 'chart'], renderHint: 'nonsense' });
    out.forEach((c) => expect(KNOWN.has(c)).toBe(true));
  });
});
