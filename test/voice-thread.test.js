import { describe, it, expect } from 'vitest';
import { addMessage, setGhost, dropGhost, markInterrupted, renderThread } from '../public/lib/voice-thread.js';

describe('addMessage', () => {
  it('appends and trims; ignores empty text', () => {
    let m = addMessage([], { role: 'you', text: '  hi  ' });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ kind: 'msg', role: 'you', text: 'hi' });
    expect(addMessage(m, { role: 'you', text: '   ' })).toBe(m);
  });
  it('drops any ghost when a real message lands', () => {
    let m = setGhost([], 'typing…');
    m = addMessage(m, { role: 'you', text: 'sent' });
    expect(m.some((x) => x.kind === 'ghost')).toBe(false);
  });
});

describe('setGhost', () => {
  it('keeps at most one ghost, always last', () => {
    let m = addMessage([], { role: 'you', text: 'a' });
    m = setGhost(m, 'one');
    m = setGhost(m, 'two');
    expect(m.filter((x) => x.kind === 'ghost')).toHaveLength(1);
    expect(m[m.length - 1].text).toBe('two');
  });
  it('empty text clears the ghost', () => {
    expect(setGhost(setGhost([], 'x'), '')).toHaveLength(0);
  });
});

describe('markInterrupted', () => {
  const base = () => addMessage(addMessage([], { role: 'you', text: 'q' }), { role: 'assistant', text: 'a long reply' });
  it('marks the LAST assistant message, clamped to text length', () => {
    const m = markInterrupted(base(), 6);
    expect(m[1].interruptedAt).toBe(6);
    expect(markInterrupted(base(), 999)[1].interruptedAt).toBe('a long reply'.length);
    expect(markInterrupted(base(), -4)[1].interruptedAt).toBe(0);
  });
  it('is a no-op with no assistant message', () => {
    const m = addMessage([], { role: 'you', text: 'q' });
    expect(markInterrupted(m, 3)).toBe(m);
  });
});

describe('renderThread', () => {
  it('escapes user text', () => {
    const html = renderThread(addMessage([], { role: 'you', text: '<img onerror=x>' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('splits an interrupted bubble at the boundary with a cut marker', () => {
    const m = markInterrupted(addMessage([], { role: 'assistant', text: 'hello world' }), 5);
    const html = renderThread(m);
    expect(html).toContain('<span class="vt-spoken">hello</span>');
    expect(html).toContain('<span class="vt-unspoken"> world</span>');
    expect(html).toContain('vt-cutmark');
  });
  it('renders the ghost with its own class', () => {
    expect(renderThread(setGhost([], 'listening'))).toContain('vt-ghost');
  });
});

describe('query grounding chips (#2a)', () => {
  const g = [{ id: 'n1', name: 'One', label: 'Idea' }, { id: 'n2', name: 'Two', label: 'Goal' }];
  it('an assistant message carries grounding; rendered as clickable data-node chips', () => {
    const m = addMessage([], { role: 'assistant', text: 'because…', grounding: g });
    expect(m[0].grounding).toHaveLength(2);
    const html = renderThread(m);
    expect(html).toContain('vt-ground');
    expect(html).toContain('data-node="n1"');
    expect(html).toContain('>Two</button>');
    expect(html).toContain('grounded in');
  });
  it('no grounding (absent, empty, or id-less) → no chip markup', () => {
    expect(renderThread(addMessage([], { role: 'assistant', text: 'plain' }))).not.toContain('vt-ground');
    expect(renderThread(addMessage([], { role: 'assistant', text: 'x', grounding: [] }))).not.toContain('vt-ground');
    expect(renderThread(addMessage([], { role: 'assistant', text: 'x', grounding: [{ name: 'no-id' }] }))).not.toContain('vt-ground');
  });
  it('chip text and attributes are escaped', () => {
    const html = renderThread(addMessage([], { role: 'assistant', text: 'x', grounding: [{ id: 'a"b', name: '<X&Y>', label: 'Idea' }] }));
    expect(html).not.toContain('<X&Y>');
    expect(html).toContain('&lt;X&amp;Y&gt;');
    expect(html).not.toContain('data-node="a"b"');
  });
  it('karaoke interruption markup leaves chips intact (they sit outside the bubble)', () => {
    let m = addMessage([], { role: 'assistant', text: 'a grounded answer', grounding: g });
    m = markInterrupted(m, 5);
    const html = renderThread(m);
    expect(html).toContain('vt-ground');
    expect(html).toContain('vt-cutmark');
  });
});
