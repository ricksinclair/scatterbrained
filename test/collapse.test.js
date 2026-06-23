import { describe, it, expect } from 'vitest';
import { isCollapsed, toggleCollapsed } from '../public/lib/collapse.js';

// Pure collapse state for inspector sections (UX: collapsible, persisted, default-aware).
describe('collapse — section state', () => {
  it('falls back to the default when no token is stored', () => {
    expect(isCollapsed([], 'sec:notes', false)).toBe(false);
    expect(isCollapsed([], 'sec:fields', true)).toBe(true);   // attribute editor default-collapsed
  });
  it('explicit tokens override the default', () => {
    expect(isCollapsed(['sec:notes'], 'sec:notes', false)).toBe(true);    // default-open, collapsed
    expect(isCollapsed(['!sec:fields'], 'sec:fields', true)).toBe(false); // default-collapsed, opened
  });
  it('toggle flips effective state and records it explicitly', () => {
    let s = [];
    s = toggleCollapsed(s, 'sec:fields', true);   // default collapsed → open
    expect(isCollapsed(s, 'sec:fields', true)).toBe(false);
    expect(s).toContain('!sec:fields');
    s = toggleCollapsed(s, 'sec:fields', true);   // → collapsed again
    expect(isCollapsed(s, 'sec:fields', true)).toBe(true);
    expect(s).toContain('sec:fields');
    expect(s).not.toContain('!sec:fields');       // no stale opposite token
  });
  it('toggle a default-open section to collapsed and back', () => {
    let s = toggleCollapsed([], 'sec:relations', false);
    expect(isCollapsed(s, 'sec:relations', false)).toBe(true);
    s = toggleCollapsed(s, 'sec:relations', false);
    expect(isCollapsed(s, 'sec:relations', false)).toBe(false);
  });
  it('keeps unrelated tokens intact', () => {
    const s = toggleCollapsed(['sec:notes'], 'sec:fields', true);
    expect(s).toContain('sec:notes');
  });
});
