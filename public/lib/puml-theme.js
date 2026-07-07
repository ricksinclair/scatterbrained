// puml-theme.js — PlantUML theme generation from the Studio theme tables (pure).
// Two outputs from ONE template:
//   themeToPuml(config, {name, mode})  → a standalone .puml theme (real hex, works in
//                                        any PlantUML tool via !include)
//   sentinelTheme()                    → the ONE in-app theme (magic sentinel hexes);
//                                        diagram-svg.js rewrites them to CSS vars after
//                                        render, so a stored SVG re-themes live and the
//                                        render cache never fragments by theme.
// Regenerate the committed pack with `npm run gen:puml` (scripts/gen-plantuml-themes.mjs);
// test/puml-theme.test.js fails on drift between themes.js and the committed files.
import { THEMES, PAL_DEF } from './themes.js';

// The graph's node labels, in a FIXED order — sentinel assignment depends on it.
export const NODE_LABELS = Object.keys(PAL_DEF); // Insight, Rule, Idea, Source, Project, Goal, Person, Organization, Resource, Skill, SyncState

// Sentinel magic hexes (opaque, from a reserved near-black range no real theme uses).
// Keys are rewriter targets: each maps to the CSS value diagram-svg.js writes.
export const SENTINELS = {
  '#0A0B01': 'var(--ink)',
  '#0A0B02': 'var(--ink-dim)',
  '#0A0B03': 'var(--ink-faint)',
  '#0A0B04': 'var(--accent)',
  '#0A0B05': 'var(--accent-contrast)',
  '#0A0B06': 'var(--accent-soft)',
  '#0A0B07': 'var(--surface-2)',
  '#0A0B08': 'var(--line)',
  '#0A0B09': 'rgb(var(--edge-rgb))',
  '#0A0B0A': 'var(--warn)',
  '#0A0B0B': 'var(--ok)',
};
// Per-label sentinels: #0A0B1x = the label's line/text color → var(--node-<label>);
// #0A0C1x = its soft fill → color-mix of the same var (18%, like --accent-soft's alpha).
NODE_LABELS.forEach((label, i) => {
  const slot = (0x10 + i).toString(16).toUpperCase().padStart(2, '0');
  SENTINELS['#0A0B' + slot] = `var(--node-${label.toLowerCase()})`;
  SENTINELS['#0A0C' + slot] = `color-mix(in srgb, var(--node-${label.toLowerCase()}) 18%, transparent)`;
});

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
export const rgbToHex = ([r, g, b]) => ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase();

// Parse '#rgb'/'#rrggbb'/'rgb()'/'rgba()' → { rgb:[r,g,b], a }.
export function parseColor(c) {
  const s = String(c).trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return { rgb: [1, 3, 5].map((i) => parseInt(m[1].slice(i - 1, i + 1), 16)), a: 1 };
  m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return { rgb: [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16)), a: 1 };
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

// Flatten a possibly-translucent color against an opaque hex background —
// PlantUML wants opaque colors; the Studio's glass surfaces are rgba.
export function flatten(color, bgHex) {
  const c = parseColor(color), b = parseColor(bgHex);
  if (!c) return bgHex;
  if (c.a >= 1) return rgbToHex(c.rgb);
  return rgbToHex(c.rgb.map((v, i) => v * c.a + b.rgb[i] * (1 - c.a)));
}

// Mix a full-strength [r,g,b] into the background at `amount` — the standalone twin
// of the sentinel fill's color-mix(… 18%, transparent).
export const mix = (rgb, bgHex, amount) =>
  rgbToHex(rgb.map((v, i) => v * amount + parseColor(bgHex).rgb[i] * (1 - amount)));

// ONE template, two color sources. `c` supplies every color as a hex string.
function emit(c, { header, background }) {
  const label = (l) => c.nodes[l];
  const lines = [
    header,
    '',
    "skinparam defaultFontName Inter",
    "skinparam defaultMonospacedFontName JetBrains Mono",
    'skinparam shadowing false',
    `skinparam backgroundColor ${background}`,
    'skinparam roundCorner 12',
    'skinparam ArrowColor ' + c.inkDim,
    'skinparam ArrowFontColor ' + c.inkDim,
    'skinparam ActivityDiamondBackgroundColor ' + c.surface2,
    'skinparam SequenceGroupBodyBackgroundColor transparent',
    'skinparam SequenceLifeLineBorderColor ' + c.line,
    '',
    '<style>',
    // No BackgroundColor in root — it cascades to the PAGE background and would defeat
    // `skinparam backgroundColor` (the sentinel theme needs a transparent page so the
    // Studio card's glass shows through). Element sections set their own fills.
    'root {',
    '  FontName "Inter"',
    '  FontSize 13',
    `  FontColor ${c.ink}`,
    `  LineColor ${c.edge}`,
    '  LineThickness 1',
    '  RoundCorner 12',
    '  Margin 8',
    '  Padding 6',
    '}',
    `element { BackgroundColor ${c.surface2}; }`,
    `arrow { LineColor ${c.inkDim}; FontColor ${c.inkDim}; }`,
    `note { BackgroundColor ${c.accentSoft}; LineColor ${c.accent}; FontColor ${c.ink}; }`,
    `title { FontColor ${c.ink}; FontSize 16; }`,
    `header, footer { FontColor ${c.inkFaint}; }`,
    `caption { FontColor ${c.inkDim}; }`,
    // NOTE: diagram-type sections must be separate blocks — PlantUML's <style>
    // engine does not honor comma-grouped section selectors.
    ...['mindmapDiagram', 'wbsDiagram'].flatMap((d) => [
      `${d} {`,
      `  node { BackgroundColor ${c.surface2}; LineColor ${c.edge}; FontColor ${c.ink}; RoundCorner 14; }`,
      `  rootNode { BackgroundColor ${c.accent}; FontColor ${c.accentContrast}; LineColor ${c.accent}; FontStyle bold; RoundCorner 14; }`,
      `  arrow { LineColor ${c.edge}; }`,
      '}',
    ]),
    'sequenceDiagram {',
    `  lifeline { LineColor ${c.line}; }`,
    `  participant, actor, boundary, control, entity, database, collections, queue { BackgroundColor ${c.surface2}; LineColor ${c.edge}; FontColor ${c.ink}; }`,
    `  group, box { BackgroundColor ${c.accentSoft}; LineColor ${c.edge}; FontColor ${c.inkDim}; }`,
    `  separator { BackgroundColor ${c.surface2}; FontColor ${c.inkDim}; LineColor ${c.line}; }`,
    '}',
    'activityDiagram {',
    `  activity, diamond { BackgroundColor ${c.surface2}; LineColor ${c.edge}; FontColor ${c.ink}; }`,
    `  partition { BackgroundColor transparent; LineColor ${c.line}; FontColor ${c.inkDim}; }`,
    '}',
    // Stereotype styles: color any element by graph node type, e.g.
    //   rectangle "Ponytail discipline" <<Insight>>
    ...NODE_LABELS.map((l) => `.${l} { BackgroundColor ${label(l).fill}; LineColor ${label(l).line}; FontColor ${c.ink}; }`),
    // Semantic status stereotypes: <<warn>> / <<ok>>
    `.warn { BackgroundColor ${c.accentSoft}; LineColor ${c.warn}; FontColor ${c.warn}; }`,
    `.ok { BackgroundColor ${c.accentSoft}; LineColor ${c.ok}; FontColor ${c.ok}; }`,
    '</style>',
    '',
    '\' Legacy skinparam fallback for elements the <style> stereotype selectors miss.',
    "' NOTE: no `skinparam node` here — mindmap/WBS nodes are `node` elements, and a",
    "' node skinparam OVERRIDES the <style> mindmapDiagram section (verified 1.2026.6).",
    ...['rectangle', 'component', 'card', 'agent', 'database', 'usecase', 'actor'].flatMap((el) => [
      `skinparam ${el} {`,
      `  BackgroundColor ${c.surface2}`,
      `  BorderColor ${c.edge}`,
      `  FontColor ${c.ink}`,
      ...NODE_LABELS.flatMap((l) => [
        `  BackgroundColor<<${l}>> ${label(l).fill}`,
        `  BorderColor<<${l}>> ${label(l).line}`,
      ]),
      '}',
    ]),
    '',
    'skinparam class {',
    `  BackgroundColor ${c.surface2}`,
    `  BorderColor ${c.edge}`,
    `  FontColor ${c.ink}`,
    `  HeaderBackgroundColor ${c.accentSoft}`,
    `  AttributeFontColor ${c.inkDim}`,
    '}',
    `skinparam stereotypeCBackgroundColor ${c.accentSoft}`,
    `skinparam legendBackgroundColor ${c.surface2}`,
    `skinparam legendBorderColor ${c.line}`,
    `skinparam legendFontColor ${c.inkDim}`,
    '',
  ];
  return lines.join('\n');
}

// Colors for a standalone theme file: everything flattened to real hex against bg[0].
function standaloneColors(v) {
  const bg = v.bg[0];
  const nodes = {};
  for (const l of NODE_LABELS) {
    const rgb = v.palette[l] || [120, 130, 190];
    nodes[l] = { line: rgbToHex(rgb), fill: mix(rgb, bg, 0.18) };
  }
  return {
    ink: flatten(v.ink, bg), inkDim: flatten(v.inkDim, bg), inkFaint: flatten(v.inkFaint, bg),
    accent: flatten(v.accent, bg), accentContrast: flatten(v.accentContrast, bg),
    accentSoft: flatten(v.accentSoft, bg), surface2: flatten(v.surface2, bg),
    line: flatten(v.line, bg), edge: rgbToHex(v.edge), warn: flatten(v.warn, bg), ok: flatten(v.ok, bg),
    nodes,
  };
}

export function themeToPuml(v, { name, mode }) {
  const header = [
    `' ${name}-${mode}.puml — PlantUML theme matching Scatterbrained Studio's "${name}" theme (${mode}).`,
    "' GENERATED from scatterbrained-studio/public/lib/themes.js — do not edit; run `npm run gen:puml`.",
    "' Usage: !include <path>/" + `${name}-${mode}.puml` + ' at the top of any diagram.',
    "' Element stereotypes <<Insight>> <<Project>> <<Idea>> … color as Scatterbrained graph node types.",
  ].join('\n');
  return emit(standaloneColors(v), { header, background: v.bg[0] });
}

// The in-app sentinel theme: every color is a magic hex the SVG rewriter maps to a
// CSS custom property. Background transparent — the app's own surface shows through.
export function sentinelTheme() {
  const s = {
    ink: '#0A0B01', inkDim: '#0A0B02', inkFaint: '#0A0B03',
    accent: '#0A0B04', accentContrast: '#0A0B05', accentSoft: '#0A0B06',
    surface2: '#0A0B07', line: '#0A0B08', edge: '#0A0B09', warn: '#0A0B0A', ok: '#0A0B0B',
    nodes: {},
  };
  NODE_LABELS.forEach((l, i) => {
    const slot = (0x10 + i).toString(16).toUpperCase().padStart(2, '0');
    s.nodes[l] = { line: '#0A0B' + slot, fill: '#0A0C' + slot };
  });
  const header = [
    "' _sentinel.puml — the in-app render theme (Scatterbrained Studio).",
    "' GENERATED from scatterbrained-studio/public/lib/themes.js — do not edit; run `npm run gen:puml`.",
    "' Colors are sentinel hexes rewritten to CSS custom properties after render",
    "' (public/lib/diagram-svg.js) — NOT meant for use outside the Studio.",
  ].join('\n');
  return emit(s, { header, background: 'transparent' });
}

// The full pack: [{ file, text }] — 12 standalone + 1 sentinel.
export function generatePack() {
  const out = [];
  for (const name of Object.keys(THEMES)) {
    for (const mode of ['dark', 'light']) {
      out.push({ file: `${name}-${mode}.puml`, text: themeToPuml(THEMES[name][mode], { name, mode }) });
    }
  }
  out.push({ file: '_sentinel.puml', text: sentinelTheme() });
  return out;
}
