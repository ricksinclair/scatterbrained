// themes.js — the theme tables, extracted from app.js (app.js split). Pure data:
// six themes × dark/light configs, the per-theme node palettes, and the mode-aware
// syntax-highlight palettes. The engine that applies these lives in theme-ui.js.

// Node palettes: label → [r,g,b] (painted on canvas via rgba()).
export const PAL_DEF = { Insight: [127, 119, 221], Rule: [29, 158, 117], Idea: [239, 159, 39], Source: [136, 135, 128], Project: [55, 138, 221], Goal: [212, 83, 126], Person: [212, 83, 126], Organization: [136, 135, 128], Resource: [29, 158, 117], Skill: [239, 159, 39], SyncState: [100, 100, 120] };
export const PAL_TERM = { Insight: [150, 210, 120], Rule: [80, 200, 150], Idea: [220, 210, 110], Source: [120, 150, 120], Project: [120, 230, 160], Goal: [180, 220, 120], Person: [180, 220, 120], Organization: [120, 150, 120], Resource: [80, 200, 150], Skill: [220, 210, 110], SyncState: [110, 140, 110] };
export const PAL_SOLAR = { Insight: [224, 122, 92], Rule: [201, 162, 74], Idea: [240, 176, 64], Source: [176, 150, 120], Project: [230, 150, 60], Goal: [214, 86, 86], Person: [214, 86, 86], Organization: [176, 150, 120], Resource: [201, 162, 74], Skill: [240, 176, 64], SyncState: [150, 130, 110] };
// Scatterbrained brand palette — warm ember/teal/gold/coral on ink, harmonized with
// the website + brand kit (ember #ef9a5b, teal #79b4ab, paper #ece6d8).
export const PAL_SCATTER = { Insight: [239, 154, 91], Rule: [224, 178, 90], Idea: [216, 122, 80], Source: [136, 135, 128], Project: [121, 180, 171], Goal: [212, 120, 128], Person: [212, 120, 128], Organization: [150, 140, 122], Resource: [100, 168, 158], Skill: [224, 178, 90], SyncState: [110, 108, 100] };

// Editor-grade syntax palettes (One Dark / One Light), applied as --hl-* vars by mode.
export const SYNTAX = {
  dark:  { kw: '#c678dd', str: '#98c379', com: '#7f848e', num: '#d19a66', fn: '#61afef', type: '#e5c07b', prop: '#e06c75', const: '#56b6c2',
           key0: '#e06c75', key1: '#61afef', key2: '#e5c07b', key3: '#c678dd', key4: '#56b6c2' },
  light: { kw: '#a626a4', str: '#50a14f', com: '#a0a1a7', num: '#986801', fn: '#4078f2', type: '#c18401', prop: '#e45649', const: '#0184bc',
           key0: '#e45649', key1: '#4078f2', key2: '#b8860b', key3: '#a626a4', key4: '#0184bc' },
};

// Each config's { ring, glow } is the canvas twin of the CSS --glow token (glow
// discipline, D6): `ring` strokes the SELECTED node, `glow` scales its accent halo
// (shadowBlur in app.js paintNode; calm forces 0). Those are two of the exactly
// three glow sites — the third is the primary CTA / focused palette in styles.css.
export const THEMES = {
  scatterbrained: { label: 'Scatterbrained',
    dark:  { bg: ['#0b0d12', '#06070b'], ink: '#ece6d8', inkDim: '#b6b2a7', inkFaint: '#7e8492', line: 'rgba(236,230,216,.1)', panel: 'rgba(16,19,26,.94)', surface: 'rgba(11,13,18,.95)', surface2: 'rgba(34,28,22,.6)', accent: '#ef9a5b', accentContrast: '#0b0d12', accentSoft: 'rgba(239,154,91,.22)', warn: '#e0a23f', ok: '#79b4ab', edge: [150, 140, 124], label: [236, 230, 216], ring: 'rgba(236,230,216,.9)', glow: 0.9, palette: PAL_SCATTER },
    light: { bg: ['#ece6d8', '#e1dac8'], ink: '#16140f', inkDim: '#5f5a4e', inkFaint: '#716c5e', line: 'rgba(20,18,12,.12)', panel: 'rgba(255,252,246,.96)', surface: 'rgba(246,241,231,.96)', surface2: 'rgba(228,220,203,.85)', accent: '#d77f42', accentContrast: '#16140f', accentSoft: 'rgba(215,127,66,.16)', warn: '#b5651d', ok: '#3f7a72', edge: [150, 135, 112], label: [30, 26, 18], ring: 'rgba(22,18,10,.9)', glow: 0.2, palette: PAL_SCATTER } },
  observatory: { label: 'Observatory',
    dark:  { bg: ['#0b0f22', '#04050c'], ink: '#dfe4ff', inkDim: '#8b93c8', inkFaint: '#7179a4', line: 'rgba(140,150,220,.3)', panel: 'rgba(12,16,34,.92)', surface: 'rgba(7,9,18,.92)', surface2: 'rgba(20,24,46,.65)', accent: '#8c97ff', accentContrast: '#0b0f22', accentSoft: 'rgba(90,105,220,.32)', warn: '#f0a35a', ok: '#7fe0b8', edge: [120, 130, 190], label: [220, 226, 255], ring: 'rgba(255,255,255,.9)', glow: 1, palette: PAL_DEF },
    light: { bg: ['#ffffff', '#eef1fb'], ink: '#1b2233', inkDim: '#5a6483', inkFaint: '#656f94', line: 'rgba(70,80,140,.22)', panel: 'rgba(255,255,255,.92)', surface: 'rgba(246,248,253,.95)', surface2: 'rgba(235,238,250,.85)', accent: '#5a4fc0', accentContrast: '#ffffff', accentSoft: 'rgba(90,80,200,.16)', warn: '#b5651d', ok: '#1d8a66', edge: [120, 130, 180], label: [40, 48, 80], ring: 'rgba(20,24,50,.9)', glow: 0.22, palette: PAL_DEF } },
  nebula: { label: 'Nebula',
    dark:  { bg: ['#190a26', '#0a0612'], ink: '#f0e2ff', inkDim: '#b89bd6', inkFaint: '#8d72b0', line: 'rgba(190,130,220,.28)', panel: 'rgba(28,14,40,.92)', surface: 'rgba(18,8,28,.92)', surface2: 'rgba(44,22,60,.6)', accent: '#c77dff', accentContrast: '#190a26', accentSoft: 'rgba(180,90,220,.3)', warn: '#ff9e6d', ok: '#6fe0c0', edge: [170, 120, 200], label: [235, 215, 255], ring: 'rgba(255,255,255,.9)', glow: 1, palette: PAL_DEF },
    light: { bg: ['#ffffff', '#f7edfb'], ink: '#2a1538', inkDim: '#6b4a82', inkFaint: '#8661a1', line: 'rgba(150,90,180,.22)', panel: 'rgba(255,255,255,.92)', surface: 'rgba(250,244,253,.95)', surface2: 'rgba(244,232,250,.85)', accent: '#9a4fc0', accentContrast: '#ffffff', accentSoft: 'rgba(150,80,190,.16)', warn: '#b5651d', ok: '#1d8a66', edge: [160, 110, 190], label: [60, 30, 80], ring: 'rgba(40,20,55,.9)', glow: 0.22, palette: PAL_DEF } },
  terminal: { label: 'Terminal',
    dark:  { bg: ['#0a140a', '#050805'], ink: '#c8f0c8', inkDim: '#7fb37f', inkFaint: '#5e865e', line: 'rgba(110,200,120,.25)', panel: 'rgba(8,18,8,.92)', surface: 'rgba(5,12,5,.94)', surface2: 'rgba(16,34,16,.6)', accent: '#5dca7a', accentContrast: '#0a140a', accentSoft: 'rgba(90,200,120,.25)', warn: '#e0c060', ok: '#5dca7a', edge: [90, 160, 100], label: [180, 230, 180], ring: 'rgba(220,255,220,.9)', glow: 0.9, palette: PAL_TERM },
    light: { bg: ['#fbfdf6', '#eef3e2'], ink: '#1c3a1c', inkDim: '#4a6b4a', inkFaint: '#5f785f', line: 'rgba(60,120,60,.22)', panel: 'rgba(252,253,248,.94)', surface: 'rgba(244,249,236,.95)', surface2: 'rgba(232,242,222,.85)', accent: '#2f7d3f', accentContrast: '#ffffff', accentSoft: 'rgba(60,140,70,.16)', warn: '#9a6b10', ok: '#2f7d3f', edge: [90, 150, 90], label: [30, 70, 30], ring: 'rgba(20,55,20,.9)', glow: 0.2, palette: PAL_TERM } },
  solar: { label: 'Solar',
    dark:  { bg: ['#1c1206', '#0f0a04'], ink: '#f6e9d6', inkDim: '#c9a87f', inkFaint: '#9a7e5a', line: 'rgba(230,170,90,.25)', panel: 'rgba(34,22,10,.92)', surface: 'rgba(22,14,6,.93)', surface2: 'rgba(54,36,16,.6)', accent: '#ef9f4f', accentContrast: '#1c1206', accentSoft: 'rgba(230,150,60,.28)', warn: '#e2585a', ok: '#6fc59a', edge: [200, 150, 90], label: [240, 220, 190], ring: 'rgba(255,250,235,.9)', glow: 1, palette: PAL_SOLAR },
    light: { bg: ['#fffdf7', '#fdf3e3'], ink: '#3a2410', inkDim: '#7a5a35', inkFaint: '#866c49', line: 'rgba(180,120,40,.22)', panel: 'rgba(255,253,247,.94)', surface: 'rgba(253,247,236,.95)', surface2: 'rgba(248,238,222,.85)', accent: '#c47318', accentContrast: '#1c1206', accentSoft: 'rgba(200,120,30,.16)', warn: '#b03a3a', ok: '#1d8a66', edge: [200, 150, 90], label: [70, 45, 20], ring: 'rgba(60,40,15,.9)', glow: 0.22, palette: PAL_SOLAR } },
  slate: { label: 'Slate',
    dark:  { bg: ['#15171b', '#0a0b0d'], ink: '#e6e8ec', inkDim: '#9aa0ab', inkFaint: '#7b818c', line: 'rgba(150,160,180,.22)', panel: 'rgba(22,25,30,.92)', surface: 'rgba(14,16,20,.93)', surface2: 'rgba(34,38,46,.6)', accent: '#7aa2c0', accentContrast: '#15171b', accentSoft: 'rgba(120,160,190,.24)', warn: '#d8a25a', ok: '#7fc0a0', edge: [120, 130, 145], label: [210, 215, 224], ring: 'rgba(255,255,255,.9)', glow: 0.7, palette: PAL_DEF },
    light: { bg: ['#ffffff', '#f3f5f8'], ink: '#1c2230', inkDim: '#56607a', inkFaint: '#6a7285', line: 'rgba(60,70,90,.2)', panel: 'rgba(255,255,255,.94)', surface: 'rgba(247,249,252,.95)', surface2: 'rgba(236,240,246,.85)', accent: '#3f6f93', accentContrast: '#ffffff', accentSoft: 'rgba(70,110,150,.15)', warn: '#9a6b10', ok: '#1d8a66', edge: [110, 120, 140], label: [40, 48, 64], ring: 'rgba(20,28,45,.9)', glow: 0.18, palette: PAL_DEF } },
};

export const THEME_ORDER = ['scatterbrained', 'observatory', 'nebula', 'terminal', 'solar', 'slate'];
