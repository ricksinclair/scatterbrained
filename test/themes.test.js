import { describe, it, expect } from 'vitest';
import { THEMES, THEME_ORDER, SYNTAX } from '../public/lib/themes.js';

// A CSS color as the theme configs use them: #hex, or an rgb()/rgba() function.
const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]+\))$/;
const isRgbTriple = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);

// The full var set every config must define = the keys of one reference config.
const REF_KEYS = Object.keys(THEMES.observatory.dark).sort();

describe('THEMES', () => {
  it('THEME_ORDER lists exactly the defined themes', () => {
    expect([...THEME_ORDER].sort()).toEqual(Object.keys(THEMES).sort());
  });

  for (const name of Object.keys(THEMES)) {
    describe(name, () => {
      it('has a label and both dark + light configs', () => {
        expect(typeof THEMES[name].label).toBe('string');
        expect(THEMES[name].dark).toBeTruthy();
        expect(THEMES[name].light).toBeTruthy();
      });

      for (const mode of ['dark', 'light']) {
        const cfg = THEMES[name][mode];
        it(`${mode} defines the full var set`, () => {
          expect(Object.keys(cfg).sort()).toEqual(REF_KEYS);
        });
        it(`${mode} values are well-formed`, () => {
          expect(cfg.bg).toHaveLength(2);
          for (const c of [...cfg.bg, cfg.ink, cfg.inkDim, cfg.inkFaint, cfg.line, cfg.panel, cfg.surface, cfg.surface2, cfg.accent, cfg.accentSoft, cfg.warn, cfg.ok, cfg.ring]) {
            expect(c).toMatch(CSS_COLOR);
          }
          expect(isRgbTriple(cfg.edge)).toBe(true);
          expect(isRgbTriple(cfg.label)).toBe(true);
          expect(cfg.glow).toBeGreaterThanOrEqual(0);
        });
        it(`${mode} palette maps every label to a valid [r,g,b]`, () => {
          const pal = cfg.palette;
          expect(Object.keys(pal).length).toBeGreaterThan(0);
          for (const [label, rgb] of Object.entries(pal)) {
            expect(isRgbTriple(rgb), `${name}.${mode} palette ${label}`).toBe(true);
          }
        });
      }
    });
  }
});

// ── WCAG AA contrast (computed, not eyeballed) ──────────────────────────────
// panel/surface are semi-transparent; composite them over --bg0 (= cfg.bg[1],
// the page background) exactly as the browser does before measuring contrast.
const hex2rgb = (h) => {
  h = h.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const parseColor = (c) => {
  if (c.startsWith('#')) return { rgb: hex2rgb(c), a: 1 };
  const p = c.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
  return { rgb: p.slice(0, 3), a: p[3] == null ? 1 : p[3] };
};
const compositeOver = (top, bg) => top.rgb.map((v, i) => v * top.a + bg[i] * (1 - top.a));
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('WCAG AA contrast (all 12 configs)', () => {
  for (const name of Object.keys(THEMES)) {
    for (const mode of ['dark', 'light']) {
      const cfg = THEMES[name][mode];
      const base = hex2rgb(cfg.bg[1]);
      const panel = compositeOver(parseColor(cfg.panel), base);
      const surface = compositeOver(parseColor(cfg.surface), base);
      it(`${name}.${mode} ink ramp is >= 4.5:1 on panel and surface`, () => {
        for (const key of ['ink', 'inkDim', 'inkFaint']) {
          const fg = hex2rgb(cfg[key]);
          expect(contrast(fg, panel), `${name}.${mode}.${key} vs panel`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(fg, surface), `${name}.${mode}.${key} vs surface`).toBeGreaterThanOrEqual(4.5);
        }
      });
      it(`${name}.${mode} accentContrast is >= 4.5:1 on the accent fill`, () => {
        expect(cfg.accentContrast).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(contrast(hex2rgb(cfg.accentContrast), hex2rgb(cfg.accent))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('SYNTAX', () => {
  it('dark and light define the same token set, all hex colors', () => {
    expect(Object.keys(SYNTAX.light).sort()).toEqual(Object.keys(SYNTAX.dark).sort());
    for (const mode of ['dark', 'light']) {
      for (const v of Object.values(SYNTAX[mode])) expect(v).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
