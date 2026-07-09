import { describe, it, expect } from 'vitest';
import { PERSONA_BRIEF, digestBlock, recentBlock, findingsBlock, buildLocalSystemPrompt } from '../lib/persona.js';

describe('overviewBlock — injected aggregates ("how many active projects")', async () => {
  const { overviewBlock } = await import('../lib/persona.js');
  it('groups counts by kind with totals', () => {
    const b = overviewBlock([
      { k: 'project:active', c: 9 }, { k: 'project:shipped', c: 3 },
      { k: 'goal:unset', c: 14 }, { k: 'goal:active', c: 2 },
    ]);
    expect(b).toContain('Graph overview');
    expect(b).toContain('- 12 projects: 9 active, 3 shipped');
    expect(b).toContain('- 16 goals: 14 unset, 2 active');
  });
  it('empty stays empty', () => {
    expect(overviewBlock([])).toBe('');
  });
});

describe('recentBlock / findingsBlock — injected recall for the tool-less local lane', () => {
  it('renders newest-first insights with their dates, capped', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ name: 'thing' + i, created_at: '2026-07-0' + ((i % 9) + 1) + 'T01:00:00Z' }));
    const b = recentBlock(rows, { cap: 8 });
    expect(b).toContain('Recently captured');
    expect(b).toContain('[2026-07-01] thing0');
    expect(b).not.toContain('thing9');
    expect(recentBlock([])).toBe('');
  });
  it('findings carry label and a text bite; empty stays empty', () => {
    const b = findingsBlock([{ name: 'VOICE', label: 'Idea', text: 'x'.repeat(500) }]);
    expect(b).toContain('VOICE (Idea): ');
    expect(b.length).toBeLessThan(450);
    expect(findingsBlock([])).toBe('');
    expect(findingsBlock([{ label: 'Idea' }])).toBe('');   // nameless hits dropped
  });
  it('both blocks land in the prompt between digest and node', () => {
    const p = buildLocalSystemPrompt({ digest: 'D-BLOCK', recent: 'R-BLOCK', findings: 'F-BLOCK', node: 'N-BLOCK', utterance: 'q' });
    expect(p.indexOf('R-BLOCK')).toBeGreaterThan(p.indexOf('D-BLOCK'));
    expect(p.indexOf('F-BLOCK')).toBeGreaterThan(p.indexOf('R-BLOCK'));
    expect(p.indexOf('N-BLOCK')).toBeGreaterThan(p.indexOf('F-BLOCK'));
  });
});

describe('digestBlock', () => {
  it('says so when the agenda is empty', () => {
    expect(digestBlock([])).toMatch(/nothing due/i);
  });
  it('renders rows with kind, date, name, label, projects', () => {
    const b = digestBlock([{ name: 'Ship VOICE', label: 'Idea', kind: 'due', date: '2026-07-10', projects: ['Scatterbrained'] }]);
    expect(b).toContain('due 2026-07-10: Ship VOICE (Idea, Scatterbrained)');
  });
  it('caps rows and reports the remainder', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ name: 'n' + i, label: 'Goal', kind: 'review', date: '2026-08-01', projects: [] }));
    const b = digestBlock(rows, { cap: 20 });
    expect(b).toContain('(+5 more)');
    expect(b).not.toContain('n24');
  });
});

describe('buildLocalSystemPrompt', () => {
  it('always leads with the persona and ends awaiting the assistant', () => {
    const p = buildLocalSystemPrompt({ utterance: 'hello' });
    expect(p.startsWith(PERSONA_BRIEF)).toBe(true);
    expect(p.trimEnd().endsWith('Assistant:')).toBe(true);
    expect(p).toContain('User: hello');
  });
  it('injects digest and node context when given', () => {
    const p = buildLocalSystemPrompt({ digest: 'Agenda: X', node: 'Node body', utterance: 'q' });
    expect(p).toContain('Agenda: X');
    expect(p).toContain('Node body');
  });
  it('keeps only the last 8 turns of history', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'you', text: 'turn' + i }));
    const p = buildLocalSystemPrompt({ history, utterance: 'q' });
    expect(p).not.toContain('turn3');
    expect(p).toContain('turn4');
    expect(p).toContain('Assistant: turn11');
  });
});
