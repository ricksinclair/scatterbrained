import { describe, it, expect } from 'vitest';
import { buildRegistry, matchCommands, BASE_COMMAND_IDS } from '../public/lib/commands.js';

const THEMES = [
  { name: 'scatterbrained', label: 'Scatterbrained' }, { name: 'observatory', label: 'Observatory' },
  { name: 'nebula', label: 'Nebula' }, { name: 'terminal', label: 'Terminal' },
  { name: 'solar', label: 'Solar' }, { name: 'slate', label: 'Slate' },
];
const TOURS = [{ id: 'showcase', label: 'Full tour' }, { id: 'graph', label: 'Graph lens' }, { id: 'code', label: 'Code lens' }];
const reg = () => buildRegistry({ themes: THEMES, types: ['Project', 'Goal', 'Source'], tours: TOURS });

describe('buildRegistry', () => {
  it('every entry has the registry shape', () => {
    for (const c of reg()) {
      expect(typeof c.id).toBe('string');
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.title).toBe('string');
      expect(typeof c.group).toBe('string');
      expect(Array.isArray(c.keywords)).toBe(true);
    }
  });
  it('ids are unique', () => {
    const ids = reg().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('is the closed set: every feature is reachable', () => {
    const ids = new Set(reg().map((c) => c.id));
    for (const id of [
      'open-graph', 'open-time-agenda', 'open-roadmap', 'open-code-map', 'open-code-review',
      'open-agents', 'open-assistant', 'capture-link', 'add-criterion', 'needs-review', 'toggle-mode', 'toggle-calm',
      'ui-size-s', 'ui-size-m', 'ui-size-l', 'focus-clear', 'study-selected',
      'export-report', 'start-tour', 'open-settings', 'manage-folders',
    ]) expect(ids.has(id), id).toBe(true);
    // one set-theme-* per theme, one filter-* per dynamic type, one start-tour-* per surface tour
    for (const t of THEMES) expect(ids.has('set-theme-' + t.name), t.name).toBe(true);
    for (const t of ['Project', 'Goal', 'Source']) expect(ids.has('filter-' + t), t).toBe(true);
    expect(ids.has('start-tour-graph')).toBe(true);
    expect(ids.has('start-tour-code')).toBe(true);
    expect(ids.has('start-tour-showcase')).toBe(false);   // showcase stays the BASE 'start-tour'
    // nothing outside the declared base + factories
    for (const id of ids) {
      const factory = id.startsWith('set-theme-') || id.startsWith('filter-') || id.startsWith('start-tour-');
      expect(factory || BASE_COMMAND_IDS.includes(id), id + ' is not a declared command').toBe(true);
    }
  });
  it('lens-switch commands carry their key as the shortcut chip', () => {
    const by = Object.fromEntries(reg().map((c) => [c.id, c]));
    expect(by['open-graph'].shortcut).toBe('G');
    expect(by['open-time-agenda'].shortcut).toBe('T');
    expect(by['open-code-map'].shortcut).toBe('C');
    expect(by['open-agents'].shortcut).toBe('A');
  });
});

describe('matchCommands ranking', () => {
  it('empty query matches nothing', () => {
    expect(matchCommands('', reg())).toEqual([]);
    expect(matchCommands('   ', reg())).toEqual([]);
  });
  it('title prefix beats word-start beats substring beats keyword', () => {
    const r = [
      { id: 'kw', title: 'Zzz', keywords: ['roam'], group: 'g' },
      { id: 'sub', title: 'Unroad', keywords: [], group: 'g' },
      { id: 'word', title: 'Open Roadmap', keywords: [], group: 'g' },
      { id: 'prefix', title: 'Roadmap', keywords: [], group: 'g' },
    ];
    expect(matchCommands('roa', r).map((c) => c.id)).toEqual(['prefix', 'word', 'sub', 'kw']);
  });
  it('matching is case-insensitive and finds real commands', () => {
    const hits = matchCommands('RoAd', reg());
    expect(hits[0].id).toBe('open-roadmap');
  });
  it('keywords surface commands whose title says nothing', () => {
    const hits = matchCommands('dark', reg()).map((c) => c.id);
    expect(hits).toContain('toggle-mode');
  });
  it('non-matching query returns []', () => {
    expect(matchCommands('xyzzy-nothing', reg())).toEqual([]);
  });
});

describe('matchCommands gating', () => {
  it('gated commands are hidden unless the ctx flag is on', () => {
    const off = matchCommands('study', reg(), {}).map((c) => c.id);
    expect(off).not.toContain('study-selected');
    const on = matchCommands('study', reg(), { selection: true }).map((c) => c.id);
    expect(on).toContain('study-selected');
  });
  it('focus-clear needs an active focus', () => {
    expect(matchCommands('clear focus', reg(), {}).map((c) => c.id)).not.toContain('focus-clear');
    expect(matchCommands('clear focus', reg(), { focus: true }).map((c) => c.id)).toContain('focus-clear');
  });
});
