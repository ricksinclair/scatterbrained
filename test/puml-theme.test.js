import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES, THEME_ORDER } from '../public/lib/themes.js';
import { SENTINELS, NODE_LABELS, generatePack, themeToPuml, sentinelTheme, flatten, mix, parseColor, rgbToHex } from '../public/lib/puml-theme.js';

const packDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'plantuml');

describe('puml-theme — color helpers', () => {
  it('parses hex, rgb() and rgba()', () => {
    expect(parseColor('#ef9a5b')).toEqual({ rgb: [239, 154, 91], a: 1 });
    expect(parseColor('rgba(236,230,216,.1)')).toEqual({ rgb: [236, 230, 216], a: 0.1 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ rgb: [10, 20, 30], a: 1 });
  });
  it('flattens translucent glass against the background (opaque out)', () => {
    expect(flatten('rgba(255,255,255,.5)', '#000000')).toBe('#808080');
    expect(flatten('#ef9a5b', '#000000')).toBe('#EF9A5B'); // opaque passes through
  });
  it('mix() is the standalone twin of the sentinel color-mix (18% tint)', () => {
    expect(mix([255, 255, 255], '#000000', 0.5)).toBe('#808080');
    expect(rgbToHex([239, 154, 91])).toBe('#EF9A5B');
  });
});

describe('puml-theme — mapping goldens', () => {
  const scatter = themeToPuml(THEMES.scatterbrained.dark, { name: 'scatterbrained', mode: 'dark' });
  it('kills the defaults: shadows off, Inter + JetBrains Mono, rounded corners, no beige', () => {
    expect(scatter).toContain('skinparam shadowing false');
    expect(scatter).toContain('skinparam defaultFontName Inter');
    expect(scatter).toContain('skinparam defaultMonospacedFontName JetBrains Mono');
    expect(scatter).toContain('RoundCorner 12');
    expect(scatter.toUpperCase()).not.toContain('#FEFECE'); // PlantUML's default beige
  });
  it("carries the theme's accent and deep background", () => {
    expect(scatter.toUpperCase()).toContain('#EF9A5B'); // scatterbrained dark accent
    expect(scatter).toContain('skinparam backgroundColor #0b0d12');
  });
  it('emits a stereotype style per graph node label', () => {
    for (const l of NODE_LABELS) {
      expect(scatter).toContain(`.${l} {`);
      expect(scatter).toContain(`BackgroundColor<<${l}>>`);
    }
  });
  it('mindmap root uses the accent with contrast text', () => {
    expect(scatter).toMatch(/rootNode \{ BackgroundColor #EF9A5B; FontColor #0B0D12/i);
  });
});

describe('puml-theme — sentinel theme', () => {
  const sent = sentinelTheme();
  it('uses every sentinel hex exactly where a color is expected', () => {
    for (const hex of Object.keys(SENTINELS)) expect(sent.toUpperCase()).toContain(hex.toUpperCase());
  });
  it('has a transparent background (the app surface shows through)', () => {
    expect(sent).toContain('skinparam backgroundColor transparent');
  });
  it('covers 11 node labels with line + fill sentinels (distinct ranges)', () => {
    expect(NODE_LABELS).toHaveLength(11);
    const lineSlots = Object.keys(SENTINELS).filter((h) => h.startsWith('#0A0B1'));
    const fillSlots = Object.keys(SENTINELS).filter((h) => h.startsWith('#0A0C1'));
    expect(lineSlots).toHaveLength(11);
    expect(fillSlots).toHaveLength(11);
    expect(SENTINELS['#0A0B10']).toBe('var(--node-insight)');
    expect(SENTINELS['#0A0C10']).toContain('color-mix');
  });
});

describe('puml-theme — the committed pack never drifts from themes.js', () => {
  const pack = generatePack();
  it('generates 12 standalone files (6 themes × 2 modes) + 1 sentinel', () => {
    expect(pack).toHaveLength(13);
    expect(THEME_ORDER).toHaveLength(6);
    for (const name of THEME_ORDER) for (const mode of ['dark', 'light']) {
      expect(pack.some((p) => p.file === `${name}-${mode}.puml`)).toBe(true);
    }
  });
  it('regeneration matches the committed files byte-for-byte (run `npm run gen:puml` if this fails)', () => {
    for (const { file, text } of pack) {
      const committed = readFileSync(join(packDir, file), 'utf8');
      expect(committed, `public/plantuml/${file} drifted from themes.js`).toBe(text);
    }
  });
  it('no sentinel hex leaks into any standalone file', () => {
    for (const { file, text } of pack) {
      if (file === '_sentinel.puml') continue;
      for (const hex of Object.keys(SENTINELS)) {
        expect(text.toUpperCase(), `${file} contains sentinel ${hex}`).not.toContain(hex.toUpperCase());
      }
    }
  });
  it('the committed directory has no strays beyond the pack', () => {
    const files = readdirSync(packDir).filter((f) => f.endsWith('.puml'));
    expect(files.sort()).toEqual(pack.map((p) => p.file).sort());
  });
});
