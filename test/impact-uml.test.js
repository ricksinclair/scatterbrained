import { describe, it, expect } from 'vitest';
import { impactLayout, memberLabel, G } from '../public/lib/impact-uml.js';

// fixture helpers — the shapes /api/repo/callsites now produces
const mem = (name, kind = 'call', lines = [3]) => ({ name, kind, lines });
const site = (fn, lines, members) => ({ fn, lines, members });
const caller = (file, sites) => ({ file, lang: 'ts', path: '/' + file, sites });

const hub = (n, member = 'login') => Array.from({ length: n }, (_, i) =>
  caller(`c${String(i).padStart(2, '0')}.ts`, [site('go', [5 + i], [mem(member)])]));

describe('impactLayout — member aggregation (the focus\'s used API surface)', () => {
  const L = impactLayout({
    focus: { id: 'core/auth.service.ts', lang: 'ts' },
    callers: [
      caller('a.ts', [site('fa', [4], [mem('login'), mem('logout')])]),
      caller('b.ts', [site('fb', [7], [mem('login')])]),
      caller('c.ts', [site('fc', [2], [mem('AuthService', 'type')]), site('fc2', [9], [mem('login')])]),
    ],
  });
  it('counts DISTINCT caller files per member and ranks by fan-in', () => {
    const login = L.members.find((m) => m.name === 'login');
    expect(login.callerCount).toBe(3);
    expect(L.members[0].name).toBe('login');            // biggest fan-in first
  });
  it('type-only references rank BELOW real calls regardless of count', () => {
    const kinds = L.members.map((m) => m.kind);
    expect(kinds.indexOf('type')).toBeGreaterThan(kinds.lastIndexOf('call'));
    expect(memberLabel(L.members.find((m) => m.kind === 'type'))).toContain('«type»');
  });
  it('lays the three columns left→right: callers, focus, imports', () => {
    const L2 = impactLayout({ focus: { id: 'f.ts' }, callers: [caller('a.ts', [site('fa', [1], [mem('x')])])], dependencies: [{ id: 'd.ts', lang: 'ts' }] });
    const c = L2.callers[0];
    expect(c.x + c.w).toBeLessThan(L2.focus.x);
    expect(L2.focus.x + L2.focus.w).toBeLessThan(L2.deps[0].x);
    expect(L2.width).toBeGreaterThan(L2.deps[0].x + L2.deps[0].w);
  });
});

describe('impactLayout — method-level edges', () => {
  const L = impactLayout({
    focus: { id: 'f.ts' },
    callers: [caller('a.ts', [site('fa', [4], [mem('login'), mem('logout')]), site('fb', [9], [mem('logout')])])],
  });
  it('draws one edge per (caller function, focus member) pair', () => {
    expect(L.edges).toHaveLength(3);   // fa→login, fa→logout, fb→logout
    expect(new Set(L.edges.map((e) => e.member))).toEqual(new Set(['login', 'logout']));
  });
  it('edges run from the method ROW to the member ROW, box edge to box edge', () => {
    const b = L.callers[0];
    for (const e of L.edges) {
      expect(e.x1).toBeCloseTo(b.x + b.w);
      expect(e.x2).toBeCloseTo(L.focus.x);
      expect(e.y1).toBeGreaterThan(b.y + G.HEADER_H);          // inside the method compartment
      expect(e.y1).toBeLessThan(b.y + b.h);
      const row = L.members.find((m) => m.name === e.member);
      expect(e.y2).toBeCloseTo(row.y + G.MEMBER_H / 2);        // lands exactly on its member row
    }
  });
  it('flags type-reference edges so the renderer can dim them', () => {
    const T = impactLayout({ focus: { id: 'f.ts' }, callers: [caller('a.ts', [site('ctor', [2], [mem('Svc', 'type')])])] });
    expect(T.edges[0].kind).toBe('type');
  });
});

describe('impactLayout — scale: clustering, collapse, representatives', () => {
  it('clusters callers by their highest-ranked member (bands align with member rows)', () => {
    const L = impactLayout({
      focus: { id: 'f.ts' },
      callers: [
        caller('z-minor.ts', [site('fz', [1], [mem('rare')])]),
        ...hub(3, 'login'),                                     // login outranks rare (3 files vs 1)
      ],
    });
    const order = L.callers.map((c) => c.id);
    expect(order[order.length - 1]).toBe('z-minor.ts');         // rare's caller sinks below login's band
  });
  it('collapses past the cap into a ghost, keeping ≥1 representative per member', () => {
    const L = impactLayout({
      focus: { id: 'f.ts' },
      callers: [...hub(G.CAP_CALLERS + 8, 'login'), caller('only-logout.ts', [site('f', [2], [mem('logout')])])],
    });
    expect(L.callers).toHaveLength(G.CAP_CALLERS);
    expect(L.ghost.count).toBe(9);
    expect(L.hiddenCallers).toBe(9);
    // logout has exactly one caller — it must survive the collapse
    expect(L.callers.some((c) => c.id === 'only-logout.ts')).toBe(true);
  });
  it('expand shows everything and drops the ghost', () => {
    const L = impactLayout({ focus: { id: 'f.ts' }, callers: hub(G.CAP_CALLERS + 8), expand: true });
    expect(L.callers).toHaveLength(G.CAP_CALLERS + 8);
    expect(L.ghost).toBe(null);
  });
  it('caps the method compartment with a +N more row', () => {
    const many = caller('a.ts', Array.from({ length: G.CAP_METHODS + 3 }, (_, i) => site('f' + i, [i + 1], [mem('m')])));
    const L = impactLayout({ focus: { id: 'f.ts' }, callers: [many] });
    expect(L.callers[0].methods).toHaveLength(G.CAP_METHODS);
    expect(L.callers[0].moreMethods).toBe(3);
  });
  it('never overlaps caller boxes vertically', () => {
    const L = impactLayout({ focus: { id: 'f.ts' }, callers: hub(10) });
    const sorted = L.callers.slice().sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h);
  });
});

describe('impactLayout — member filter (member-centric navigation)', () => {
  const callers = [
    caller('a.ts', [site('fa', [4], [mem('login')]), site('fx', [8], [mem('logout', 'call', [8])])]),
    caller('b.ts', [site('fb', [7], [mem('logout', 'call', [7])])]),
  ];
  const L = impactLayout({ focus: { id: 'f.ts' }, callers, memberFilter: 'logout' });
  it('keeps only callers (and only their sites) that touch the member', () => {
    expect(L.callers.map((c) => c.id).sort()).toEqual(['a.ts', 'b.ts']);
    expect(L.callers.find((c) => c.id === 'a.ts').methods.map((m) => m.fn)).toEqual(['fx']);   // fa filtered out
  });
  it('keeps the FULL member list (the filter is the navigation) and marks the active row', () => {
    expect(L.members.map((m) => m.name).sort()).toEqual(['login', 'logout']);
    expect(L.members.find((m) => m.name === 'logout').on).toBe(true);
    expect(L.memberFilter).toBe('logout');
  });
  it('only draws edges for the filtered member, and points rows at ITS line', () => {
    expect(L.edges.every((e) => e.member === 'logout')).toBe(true);
    expect(L.callers.find((c) => c.id === 'a.ts').methods[0].line).toBe(8);
  });
  it('a filter never collapses — it IS the explicit "show me all of them"', () => {
    const F = impactLayout({ focus: { id: 'f.ts' }, callers: hub(G.CAP_CALLERS + 8, 'login'), memberFilter: 'login' });
    expect(F.callers).toHaveLength(G.CAP_CALLERS + 8);
    expect(F.ghost).toBe(null);
  });
  it('an unknown filter is ignored rather than blanking the diagram', () => {
    const U = impactLayout({ focus: { id: 'f.ts' }, callers, memberFilter: 'nope' });
    expect(U.memberFilter).toBe(null);
    expect(U.callers).toHaveLength(2);
  });
});

describe('impactLayout — edges of the ego', () => {
  it('marks a dependency that is ALSO a caller as a cycle', () => {
    const L = impactLayout({
      focus: { id: 'f.ts' },
      callers: [caller('mutual.ts', [site('fm', [3], [mem('x')])])],
      dependencies: [{ id: 'mutual.ts', lang: 'ts' }, { id: 'clean.ts', lang: 'ts' }],
    });
    expect(L.deps.find((d) => d.id === 'mutual.ts').cycle).toBe(true);
    expect(L.deps.find((d) => d.id === 'clean.ts').cycle).toBe(false);
    expect(L.depEdges.find((e) => e.id === 'mutual.ts').cycle).toBe(true);
  });
  it('no callers: still lays out focus + imports (an entry point\'s ego)', () => {
    const L = impactLayout({ focus: { id: 'main.ts' }, callers: [], dependencies: [{ id: 'a.ts' }, { id: 'b.ts' }] });
    expect(L.callers).toHaveLength(0);
    expect(L.members).toHaveLength(0);
    expect(L.deps).toHaveLength(2);
    expect(L.width).toBeGreaterThan(0);
    expect(L.height).toBeGreaterThan(0);
  });
  it('caps the import column and reports the hidden remainder', () => {
    const deps = Array.from({ length: G.CAP_DEPS + 4 }, (_, i) => ({ id: 'd' + i + '.ts' }));
    const L = impactLayout({ focus: { id: 'f.ts' }, callers: [], dependencies: deps });
    expect(L.deps).toHaveLength(G.CAP_DEPS);
    expect(L.hiddenDeps).toBe(4);
  });
  it('is deterministic — same input, same geometry', () => {
    const input = { focus: { id: 'f.ts' }, callers: hub(20), dependencies: [{ id: 'd.ts' }] };
    expect(impactLayout(input)).toEqual(impactLayout(input));
  });
});
