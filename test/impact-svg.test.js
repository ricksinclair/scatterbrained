import { describe, it, expect } from 'vitest';
import { impactLayout } from '../public/lib/impact-uml.js';
import { renderImpactSvg } from '../public/lib/impact-svg.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const layout = (over = {}) => impactLayout({
  focus: { id: 'core/auth.service.ts', lang: 'ts' },
  callers: [
    { file: 'login.component.ts', lang: 'ts', path: '/p/login.component.ts', sites: [{ fn: 'submit', lines: [12], members: [{ name: 'login', kind: 'call', lines: [12] }] }] },
  ],
  dependencies: [{ id: 'api.service.ts', lang: 'ts' }],
  ...over,
});

describe('renderImpactSvg — markup contract for the delegated interactions', () => {
  const svg = renderImpactSvg(layout(), { esc });
  it('emits the interaction hooks: drill, open-at-line, member filter', () => {
    expect(svg).toContain('data-rel="login.component.ts"');           // caller header → drill
    expect(svg).toContain('data-open="/p/login.component.ts"');       // method row → open file…
    expect(svg).toContain('data-line="12"');                          // …at the call line
    expect(svg).toContain('data-member="login"');                     // member row → filter
    expect(svg).toContain('data-rel="api.service.ts"');               // import pill → drill
  });
  it('renders the focus as the anchored class box with its used API surface', () => {
    expect(svg).toContain('dag-focus');
    expect(svg).toContain('login()');                                 // member row label
    expect(svg).toMatch(/aria-label="dependency diagram: 1 callers into auth\.service\.ts, 1 imports out"/);
  });
  it('escapes everything that came from file content', () => {
    const L = layout({ callers: [{ file: 'a<b>.ts', lang: 'ts', path: '/p/a', sites: [{ fn: 'f<x', lines: [1], members: [{ name: 'm&n', kind: 'call', lines: [1] }] }] }] });
    const out = renderImpactSvg(L, { esc });
    expect(out).not.toContain('a<b>');
    expect(out).not.toContain('m&n"');                                // raw & must be escaped
    expect(out).toContain('m&amp;n');
  });
  it('shows the collapse ghost with a data-expand hook past the caller cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ file: `c${i}.ts`, lang: 'ts', path: '/p', sites: [{ fn: 'f', lines: [1], members: [{ name: 'login', kind: 'call', lines: [1] }] }] }));
    const out = renderImpactSvg(layout({ callers: many }), { esc });
    expect(out).toContain('data-expand');
    expect(out).toContain('more caller');
  });
  it('returns empty string for an empty ego (nothing to draw beats a lone box)', () => {
    expect(renderImpactSvg(impactLayout({ focus: { id: 'x.ts' } }), { esc })).toBe('');
  });
});
