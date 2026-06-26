// ============================================================================
// Scatterbrained Studio — observatory, on the force-graph engine.
// The rendering / interaction core (force layout, camera, zoom/pan, node drag,
// pixel-perfect hover via color-picking, HiDPI) is provided by force-graph
// (vasturiano) — the same approach Neo4j's tooling uses. We keep our own themed
// node painting, dock, inspector, lenses, search, time-travel and focus logic.
// ============================================================================

import { statusText, computeDoi, placeLabels, smartLabel } from '/lib/graph.js';
import { composeView, keyFacts, resurfaceState, miniMarkdown, dueLabel } from '/lib/registry.js';
import { detectCandidates } from '/lib/protected-facts.js';
import { TOUR } from '/lib/tour.js';

// Resurface snooze state is browser-local (UI state, not canonical knowledge).
const snoozeKey = (id) => 'scatterbrained:snooze:' + id;
const getSnooze = (id) => +localStorage.getItem(snoozeKey(id)) || 0;
const setSnooze = (id, until) => (until ? localStorage.setItem(snoozeKey(id), String(until)) : localStorage.removeItem(snoozeKey(id)));
import { parseIntent, INTENTS } from '/lib/intent.js';
import { buildOptions, nextIndex, optionAt } from '/lib/typeahead.js';
import { fieldRowsFor, membersForField, relateArgs } from '/lib/fields.js';
import { monthGrid, gridRange, bucketByDay, heatIntensity, stepMonth, monthLabel } from '/lib/calendar.js';
import { isCollapsed as isColRaw, toggleCollapsed as togColRaw } from '/lib/collapse.js';
import { KIND_META } from '/lib/schedule.js';
import { quarterAxis, placeItem, classifyStatus } from '/lib/roadmap.js';
import { highlightCode, jsonDepths } from '/lib/codehl.js';
import { buildFileTree, flattenTree } from '/lib/filetree.js';
import { parseCards, nextReview } from '/lib/cards.js';
import { REGISTRY } from '/lib/registry.js';
import { nodeToMarkdown, exportFilename } from '/lib/export.js';
import { parseLayout, orderParts, moveBefore, toggleSpan, serializeLayout } from '/lib/layout.js';
import { parseCsv, sortRows, filterRows, isNumericColumn } from '/lib/csv.js';
import {
  rawLinesHtml, cellNotesIndex, rowNotesIndex, colNotesIndex, sectionNotesIndex, pageNotesIndex, annoHtml,
  slugify, makeCellLocator, makeRowLocator, makeColLocator, makePageLocator, anchoredCount,
} from '/lib/docnotes.js';
import { recommendChart, histogramSpec, columnValues, profileColumns } from '/lib/dataviz.js';

// Build a node's study cards: explicit Q:/A: or cloze in its text, else a single
// auto "What is X? → definition" card so any node with prose is studyable.
function buildCards(signals) {
  const text = signals.full_text || signals.desc || signals.description || '';
  const explicit = parseCards(text);
  if (explicit.length) return explicit;
  const def = (signals.desc || signals.description || signals.full_text || '').trim();
  return def ? [{ front: 'What is “' + (signals.name || 'this') + '”?', back: def, auto: true }] : [];
}
const cardSchedKey = (nodeId, idx) => `scatterbrained:card:${nodeId}:${idx}`;

// Relation-type distribution → the chart component's bars (the "shape" of a node's
// connections). Counts each relationship type. Prefers the server's uncapped
// `rel_types` (the edge list is capped at 60, which would under-report); falls back
// to the capped edges if absent.
function relationDistribution(types = []) {
  const counts = {};
  (types || []).forEach((t) => { if (t) counts[t] = (counts[t] || 0) + 1; });
  const bars = Object.keys(counts).map((t) => ({ label: t, value: counts[t] })).sort((a, b) => b.value - a.value);
  return bars.length ? { title: 'connections by type', bars } : null;
}

// Runtime capabilities consumed by the composable inspector (resolveLayout gates
// e.g. ai-summary on caps.llm). M-E will populate this from a /api/ai/ping probe;
// until then nothing is connected.
const caps = { llm: false, notion: false };

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── theming ───────────────────────────────────────────────────────────────────
const PAL_DEF = { Insight: [127, 119, 221], Rule: [29, 158, 117], Idea: [239, 159, 39], Source: [136, 135, 128], Project: [55, 138, 221], Goal: [212, 83, 126], Person: [212, 83, 126], Organization: [136, 135, 128], Resource: [29, 158, 117], Skill: [239, 159, 39], SyncState: [100, 100, 120] };
const PAL_TERM = { Insight: [150, 210, 120], Rule: [80, 200, 150], Idea: [220, 210, 110], Source: [120, 150, 120], Project: [120, 230, 160], Goal: [180, 220, 120], Person: [180, 220, 120], Organization: [120, 150, 120], Resource: [80, 200, 150], Skill: [220, 210, 110], SyncState: [110, 140, 110] };
const PAL_SOLAR = { Insight: [224, 122, 92], Rule: [201, 162, 74], Idea: [240, 176, 64], Source: [176, 150, 120], Project: [230, 150, 60], Goal: [214, 86, 86], Person: [214, 86, 86], Organization: [176, 150, 120], Resource: [201, 162, 74], Skill: [240, 176, 64], SyncState: [150, 130, 110] };
// Scatterbrained brand palette — warm ember/teal/gold/coral on ink, harmonized with
// the website + brand kit (ember #ef9a5b, teal #79b4ab, paper #ece6d8).
const PAL_SCATTER = { Insight: [239, 154, 91], Rule: [224, 178, 90], Idea: [216, 122, 80], Source: [136, 135, 128], Project: [121, 180, 171], Goal: [212, 120, 128], Person: [212, 120, 128], Organization: [150, 140, 122], Resource: [100, 168, 158], Skill: [224, 178, 90], SyncState: [110, 108, 100] };
// Editor-grade syntax palettes (One Dark / One Light), applied as --hl-* vars by mode.
const SYNTAX = {
  dark:  { kw: '#c678dd', str: '#98c379', com: '#7f848e', num: '#d19a66', fn: '#61afef', type: '#e5c07b', prop: '#e06c75', const: '#56b6c2',
           key0: '#e06c75', key1: '#61afef', key2: '#e5c07b', key3: '#c678dd', key4: '#56b6c2' },
  light: { kw: '#a626a4', str: '#50a14f', com: '#a0a1a7', num: '#986801', fn: '#4078f2', type: '#c18401', prop: '#e45649', const: '#0184bc',
           key0: '#e45649', key1: '#4078f2', key2: '#b8860b', key3: '#a626a4', key4: '#0184bc' },
};
const THEMES = {
  scatterbrained: { label: 'Scatterbrained',
    dark:  { bg: ['#0b0d12', '#06070b'], ink: '#ece6d8', inkDim: '#b6b2a7', inkFaint: '#7e8492', line: 'rgba(236,230,216,.1)', panel: 'rgba(16,19,26,.94)', surface: 'rgba(11,13,18,.95)', surface2: 'rgba(34,28,22,.6)', accent: '#ef9a5b', accentSoft: 'rgba(239,154,91,.22)', warn: '#e0a23f', ok: '#79b4ab', edge: [150, 140, 124], label: [236, 230, 216], ring: 'rgba(236,230,216,.9)', glow: 0.9, palette: PAL_SCATTER },
    light: { bg: ['#ece6d8', '#e1dac8'], ink: '#16140f', inkDim: '#5f5a4e', inkFaint: '#8c8676', line: 'rgba(20,18,12,.12)', panel: 'rgba(255,252,246,.96)', surface: 'rgba(246,241,231,.96)', surface2: 'rgba(228,220,203,.85)', accent: '#d77f42', accentSoft: 'rgba(215,127,66,.16)', warn: '#b5651d', ok: '#3f7a72', edge: [150, 135, 112], label: [30, 26, 18], ring: 'rgba(22,18,10,.9)', glow: 0.2, palette: PAL_SCATTER } },
  observatory: { label: 'Observatory',
    dark:  { bg: ['#0b0f22', '#04050c'], ink: '#dfe4ff', inkDim: '#8b93c8', inkFaint: '#6b73a0', line: 'rgba(140,150,220,.3)', panel: 'rgba(12,16,34,.92)', surface: 'rgba(7,9,18,.92)', surface2: 'rgba(20,24,46,.65)', accent: '#8c97ff', accentSoft: 'rgba(90,105,220,.32)', warn: '#f0a35a', ok: '#7fe0b8', edge: [120, 130, 190], label: [220, 226, 255], ring: 'rgba(255,255,255,.9)', glow: 1, palette: PAL_DEF },
    light: { bg: ['#ffffff', '#eef1fb'], ink: '#1b2233', inkDim: '#5a6483', inkFaint: '#8b93b0', line: 'rgba(70,80,140,.22)', panel: 'rgba(255,255,255,.92)', surface: 'rgba(246,248,253,.95)', surface2: 'rgba(235,238,250,.85)', accent: '#5a4fc0', accentSoft: 'rgba(90,80,200,.16)', warn: '#b5651d', ok: '#1d8a66', edge: [120, 130, 180], label: [40, 48, 80], ring: 'rgba(20,24,50,.9)', glow: 0.22, palette: PAL_DEF } },
  nebula: { label: 'Nebula',
    dark:  { bg: ['#190a26', '#0a0612'], ink: '#f0e2ff', inkDim: '#b89bd6', inkFaint: '#8a6fae', line: 'rgba(190,130,220,.28)', panel: 'rgba(28,14,40,.92)', surface: 'rgba(18,8,28,.92)', surface2: 'rgba(44,22,60,.6)', accent: '#c77dff', accentSoft: 'rgba(180,90,220,.3)', warn: '#ff9e6d', ok: '#6fe0c0', edge: [170, 120, 200], label: [235, 215, 255], ring: 'rgba(255,255,255,.9)', glow: 1, palette: PAL_DEF },
    light: { bg: ['#ffffff', '#f7edfb'], ink: '#2a1538', inkDim: '#6b4a82', inkFaint: '#9a7bb0', line: 'rgba(150,90,180,.22)', panel: 'rgba(255,255,255,.92)', surface: 'rgba(250,244,253,.95)', surface2: 'rgba(244,232,250,.85)', accent: '#9a4fc0', accentSoft: 'rgba(150,80,190,.16)', warn: '#b5651d', ok: '#1d8a66', edge: [160, 110, 190], label: [60, 30, 80], ring: 'rgba(40,20,55,.9)', glow: 0.22, palette: PAL_DEF } },
  terminal: { label: 'Terminal',
    dark:  { bg: ['#0a140a', '#050805'], ink: '#c8f0c8', inkDim: '#7fb37f', inkFaint: '#5a805a', line: 'rgba(110,200,120,.25)', panel: 'rgba(8,18,8,.92)', surface: 'rgba(5,12,5,.94)', surface2: 'rgba(16,34,16,.6)', accent: '#5dca7a', accentSoft: 'rgba(90,200,120,.25)', warn: '#e0c060', ok: '#5dca7a', edge: [90, 160, 100], label: [180, 230, 180], ring: 'rgba(220,255,220,.9)', glow: 0.9, palette: PAL_TERM },
    light: { bg: ['#fbfdf6', '#eef3e2'], ink: '#1c3a1c', inkDim: '#4a6b4a', inkFaint: '#7a957a', line: 'rgba(60,120,60,.22)', panel: 'rgba(252,253,248,.94)', surface: 'rgba(244,249,236,.95)', surface2: 'rgba(232,242,222,.85)', accent: '#2f7d3f', accentSoft: 'rgba(60,140,70,.16)', warn: '#9a6b10', ok: '#2f7d3f', edge: [90, 150, 90], label: [30, 70, 30], ring: 'rgba(20,55,20,.9)', glow: 0.2, palette: PAL_TERM } },
  solar: { label: 'Solar',
    dark:  { bg: ['#1c1206', '#0f0a04'], ink: '#f6e9d6', inkDim: '#c9a87f', inkFaint: '#9a7e5a', line: 'rgba(230,170,90,.25)', panel: 'rgba(34,22,10,.92)', surface: 'rgba(22,14,6,.93)', surface2: 'rgba(54,36,16,.6)', accent: '#ef9f4f', accentSoft: 'rgba(230,150,60,.28)', warn: '#e2585a', ok: '#6fc59a', edge: [200, 150, 90], label: [240, 220, 190], ring: 'rgba(255,250,235,.9)', glow: 1, palette: PAL_SOLAR },
    light: { bg: ['#fffdf7', '#fdf3e3'], ink: '#3a2410', inkDim: '#7a5a35', inkFaint: '#a8895f', line: 'rgba(180,120,40,.22)', panel: 'rgba(255,253,247,.94)', surface: 'rgba(253,247,236,.95)', surface2: 'rgba(248,238,222,.85)', accent: '#c47318', accentSoft: 'rgba(200,120,30,.16)', warn: '#b03a3a', ok: '#1d8a66', edge: [200, 150, 90], label: [70, 45, 20], ring: 'rgba(60,40,15,.9)', glow: 0.22, palette: PAL_SOLAR } },
  slate: { label: 'Slate',
    dark:  { bg: ['#15171b', '#0a0b0d'], ink: '#e6e8ec', inkDim: '#9aa0ab', inkFaint: '#6c727c', line: 'rgba(150,160,180,.22)', panel: 'rgba(22,25,30,.92)', surface: 'rgba(14,16,20,.93)', surface2: 'rgba(34,38,46,.6)', accent: '#7aa2c0', accentSoft: 'rgba(120,160,190,.24)', warn: '#d8a25a', ok: '#7fc0a0', edge: [120, 130, 145], label: [210, 215, 224], ring: 'rgba(255,255,255,.9)', glow: 0.7, palette: PAL_DEF },
    light: { bg: ['#ffffff', '#f3f5f8'], ink: '#1c2230', inkDim: '#56607a', inkFaint: '#878fa0', line: 'rgba(60,70,90,.2)', panel: 'rgba(255,255,255,.94)', surface: 'rgba(247,249,252,.95)', surface2: 'rgba(236,240,246,.85)', accent: '#3f6f93', accentSoft: 'rgba(70,110,150,.15)', warn: '#9a6b10', ok: '#1d8a66', edge: [110, 120, 140], label: [40, 48, 64], ring: 'rgba(20,28,45,.9)', glow: 0.18, palette: PAL_DEF } },
};
const THEME_ORDER = ['scatterbrained', 'observatory', 'nebula', 'terminal', 'solar', 'slate'];
let THEME = THEMES.observatory.dark;
let curTheme = 'scatterbrained', curMode = 'dark', calm = false, curAnim = 'full';
// Loading-animation intensity (Settings): 'off' | 'light' | 'full'. Gates the boot
// constellation's drama via <html data-anim>; persisted locally.
function applyAnim(level) {
  curAnim = ['off', 'light', 'full'].includes(level) ? level : 'full';
  document.documentElement.setAttribute('data-anim', curAnim);
  try { localStorage.setItem('scatterbrained.anim', curAnim); } catch (e) {}
}
const colorOf = (label) => THEME.palette[label] || [120, 130, 190];

function applyTheme(name, mode) {
  curTheme = THEMES[name] ? name : 'scatterbrained';
  curMode = mode === 'light' ? 'light' : 'dark';
  THEME = THEMES[curTheme][curMode];
  const r = document.documentElement.style, v = THEME;
  r.setProperty('--bg0', v.bg[1]); r.setProperty('--bg1', v.bg[0]);
  r.setProperty('--ink', v.ink); r.setProperty('--ink-dim', v.inkDim); r.setProperty('--ink-faint', v.inkFaint);
  r.setProperty('--line', v.line); r.setProperty('--panel', v.panel); r.setProperty('--surface', v.surface); r.setProperty('--surface-2', v.surface2);
  r.setProperty('--accent', v.accent); r.setProperty('--accent-soft', v.accentSoft); r.setProperty('--warn', v.warn); r.setProperty('--ok', v.ok);
  // Syntax-highlight palette (code review viewer) — editor-grade, mode-aware: One Dark
  // for dark, One Light for light. Driven here (not CSS) since mode is JS-applied.
  const hl = SYNTAX[curMode] || SYNTAX.dark;
  for (const k in hl) r.setProperty('--hl-' + k, hl[k]);
  document.documentElement.setAttribute('data-mode', curMode);
  try { localStorage.setItem('scatterbrained.theme', curTheme); localStorage.setItem('scatterbrained.mode', curMode); } catch (e) {}
  const mb = document.getElementById('set-mode'); if (mb) mb.innerHTML = curMode === 'light' ? '<i class="ti ti-sun" aria-hidden="true"></i>' : '<i class="ti ti-moon" aria-hidden="true"></i>';
  const tb = document.getElementById('set-theme'); if (tb) tb.title = 'Theme: ' + THEMES[curTheme].label + ' (click to cycle)';
  poke();
}
function setCalm(on) {
  calm = !!on; document.body.classList.toggle('calm', calm);
  const b = document.getElementById('set-calm'); if (b) b.classList.toggle('on', calm);
  try { localStorage.setItem('scatterbrained.calm', calm ? '1' : '0'); } catch (e) {}
  if (Graph) { Graph.linkDirectionalParticles(particleCount); if (calm) poke(); else { clearTimeout(idleTimer); Graph.resumeAnimation(); } }
}

// ── state ─────────────────────────────────────────────────────────────────────
let Graph = null;
let lastNodeClick = { id: null, t: 0 };       // for double-click-to-open-file detection
let NODES = [], LINKS = [], byId = {};
let domains = [];
let hover = null, sel = null, searchHits = new Set();
// Filtering: a multi-select set of node-type labels (empty = all) + a "needs review"
// toggle. The left dock has quick Projects/Goals shortcuts; the HUD filter panel is the
// full multi-select. Both mutate this one state and call applyFilter() — single source.
const activeTypes = new Set();
let staleOnly = false;
const isFiltered = () => activeTypes.size > 0 || staleOnly;
let tMin = 0, tMax = 1, tv = 100;
let focusId = null, focusDoi = {};
let didInitialFit = false;
let lastMx = 0, lastMy = 0, idleTimer = null;
const HEADER = 60, DOCKW = 264, INSPW = 300, TIMEBAR = 50;
let dockOpen = true, inspOpen = false, reportOpen = false, studyMode = false;
let current = null;                       // cached selection payload {n, signals, data}
let study = null;                         // active study session { cards, idx, revealed, reviewed }
const reportWidth = () => Math.round(Math.min(880, Math.max(440, window.innerWidth * 0.6)));

const selT = () => (tv >= 100 ? Infinity : tMin + (tv / 100) * (tMax - tMin));
// A node passes the filter if its type is selected (or none selected) AND, when the
// review toggle is on, it's stale. Empty + no-stale = everything visible.
const lensActive = (n) => (activeTypes.size === 0 || activeTypes.has(n.label)) && (!staleOnly || n.stale);
// keep the force-graph render loop alive briefly (used in calm mode, which idles)
function poke() {
  if (!Graph) return;
  Graph.resumeAnimation();
  if (calm) { clearTimeout(idleTimer); idleTimer = setTimeout(() => Graph.pauseAnimation(), 1600); }
}
// A full-screen overlay (review / calendar / roadmap / codebase) covers the constellation —
// pause its render loop so the main thread isn't competing while the overlay builds (the
// code-review open freeze, #34). Resume when the overlay closes.
function pauseMainGraph() { if (Graph) Graph.pauseAnimation(); }
function resumeMainGraph() { if (Graph) poke(); }

// ── data load ───────────────────────────────────────────────────────────────
async function boot() {
  let g, h;
  try {
    [g, h] = await Promise.all([
      fetch('/api/graph?limit=300').then((r) => r.json()),
      fetch('/api/health').then((r) => r.json()),
    ]);
  } catch (e) { return fail(e); }
  if (!g.nodes || !g.nodes.length) {
    // An empty graph isn't a failure — it's a first run. Offer onboarding instead of erroring.
    if (h && h.total === 0) { document.getElementById('boot').classList.add('gone'); return showOnboarding(); }
    return fail(new Error('The graph returned no nodes.'));
  }
  document.getElementById('conn').textContent = `${window.location.host} · ${h.total} memories`;
  ingest(g);
  initGraph();
  paintHealth(h);
  buildLenses();
  loadDock();
  document.getElementById('boot').classList.add('gone');
}

// First-run onboarding (#6): an empty graph gets a welcome that bootstraps a root owner node, so
// the constellation starts connected instead of as a void. Creating the root re-boots into the app.
function showOnboarding() {
  const ov = document.getElementById('onboard');
  if (!ov) return;
  ov.hidden = false;
  const nameIn = document.getElementById('ob-name');
  const msg = document.getElementById('ob-msg');
  const btns = ov.querySelectorAll('button');
  nameIn.focus();
  async function submit(kind) {
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    btns.forEach((b) => (b.disabled = true)); msg.textContent = 'creating…';
    try {
      const r = await fetch('/api/root', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, name }) }).then((x) => x.json());
      if (r.error) { msg.textContent = r.error; btns.forEach((b) => (b.disabled = false)); return; }
      ov.hidden = true; boot();                    // reload — the root is now in the graph
    } catch (e) { msg.textContent = 'could not reach the server'; btns.forEach((b) => (b.disabled = false)); }
  }
  document.getElementById('ob-person').onclick = () => submit('person');
  document.getElementById('ob-org').onclick = () => submit('org');
  nameIn.onkeydown = (e) => { if (e.key === 'Enter') submit('person'); };
}

function ingest(g) {
  NODES = g.nodes.map((n) => ({ ...n }));
  byId = {};
  NODES.forEach((n) => (byId[n.id] = n));
  LINKS = g.links.filter((l) => byId[l.source] && byId[l.target]).map((l) => ({ source: l.source, target: l.target, type: l.type }));
  const maxDeg = Math.max(1, ...NODES.map((n) => n.degree || 0));
  NODES.forEach((n) => {
    n.r = 4 + 9 * Math.sqrt((n.degree || 0) / maxDeg);          // graph-unit radius
    n.stale = !!n.superseded || (n.degree || 0) === 0;
    n.bornTime = n.created_at ? Date.parse(n.created_at) : 0;
  });
  const times = NODES.map((n) => n.bornTime).filter((t) => t > 0).sort((a, b) => a - b);
  if (times.length) { tMin = times[0]; tMax = times[times.length - 1]; }
  const ranked = [...NODES].sort((a, b) => (b.degree || 0) - (a.degree || 0));
  ranked.forEach((n, k) => (n.rank = k));
  const counts = {};
  NODES.forEach((n) => (counts[n.label] = (counts[n.label] || 0) + 1));
  domains = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  // adjacency (by id) for degree-of-interest focus
  NODES.forEach((n) => (n.adj = new Set()));
  LINKS.forEach((l) => { byId[l.source].adj.add(l.target); byId[l.target].adj.add(l.source); });
}

// ── the force-graph instance ─────────────────────────────────────────────────
const particleCount = (l) => {
  if (calm) return 0;
  const A = l.source, B = l.target;
  if (A.bornTime > selT() || B.bornTime > selT()) return 0;
  if (focusId && Math.max(focusDoi[A.id] || 0, focusDoi[B.id] || 0) < 0.3) return 0;
  if (isFiltered() && !(lensActive(A) || lensActive(B))) return 0;
  return 1;
};
function initGraph() {
  Graph = ForceGraph()(document.getElementById('graph'))
    .graphData({ nodes: NODES, links: LINKS })
    .backgroundColor('rgba(0,0,0,0)')
    .nodeRelSize(4)
    .nodeVal((n) => n.r)
    .nodeLabel(() => '')                 // disable the library's built-in tooltip; we render our own
    .nodeCanvasObjectMode(() => 'replace')
    .nodeCanvasObject(paintNode)
    .nodePointerAreaPaint(nodeArea)
    .linkColor(linkColor)
    .linkWidth((l) => (sel && (l.source.id === sel || l.target.id === sel) ? 1.4 : 0.5))
    .linkDirectionalParticles(particleCount)
    .linkDirectionalParticleWidth(1.8)
    .linkDirectionalParticleSpeed(0.006)
    .linkDirectionalParticleColor((l) => rgba(colorOf(l.target.label), 0.9))
    .onNodeHover(onHover)
    .onNodeClick((n) => {
      // Double-click a file-backed node → open it straight away (1-gesture access).
      const t = Date.now();
      if (lastNodeClick.id === n.id && t - lastNodeClick.t < 350 && n.file_path) { openFile(n.file_path); lastNodeClick = { id: null, t: 0 }; return; }
      lastNodeClick = { id: n.id, t };
      selectNode(n); focusNode(n);
    })
    .onNodeDrag(() => poke())
    .onBackgroundClick(() => { if (reportOpen) closeReport(); else { closeInsp(); clearFocus(); } })
    .onRenderFramePre((_ctx, scale) => computeLabelVisibility(scale))
    .warmupTicks(80)
    .cooldownTime(7000)
    .onEngineStop(() => { if (!didInitialFit) { didInitialFit = true; Graph.zoomToFit(500, 60); } });
  // Spread the constellation so labels have room to breathe (was a tight central blob);
  // stronger repulsion + longer links, still bounded so it can't fly apart / NaN.
  Graph.d3Force('charge').strength(-110).distanceMax(600);
  Graph.d3Force('link').distance(44).strength(0.45);
  Graph.d3VelocityDecay(0.36);
  layoutGraph();
}

function linkColor(l) {
  const A = l.source, B = l.target;
  if (A.bornTime > selT() || B.bornTime > selT()) return 'rgba(0,0,0,0)';
  const lit = sel && (A.id === sel || B.id === sel);
  const lf = !isFiltered() ? 1 : (lensActive(A) || lensActive(B) ? 1 : 0.12);
  const ff = focusId ? Math.max(focusDoi[A.id] || 0.06, focusDoi[B.id] || 0.06) : 1;
  return lit ? rgba([160, 175, 255], 0.55) : rgba(THEME.edge, 0.16 * lf * ff);
}

// Per-frame label declutter: choose which node labels render so they never overlap.
// Importance order = forced (selected/focused/hovered/searched/in-focus-subgraph)
// first, then by rank (degree). Runs in graph space at the current zoom, via the
// tested `placeLabels`. Recomputed each frame because positions + zoom change.
let labelShow = new Set();
function computeLabelVisibility(scale) {
  const sc = scale || (Graph && Graph.zoom()) || 1;
  const searchOn = searchHits.size > 0;
  // Only the selected/hovered/searched node is *forced* (always drawn). Focus-subgraph
  // neighbors get a big priority boost but still declutter, so they never smear.
  const forced = (n) => sel === n.id || hover === n || (searchOn && searchHits.has(n.id));
  const cand = [];
  for (const n of NODES) {
    if (!isFinite(n.x) || !isFinite(n.y) || n.bornTime > selT()) continue;
    const f = forced(n);
    const doi = focusId ? (focusDoi[n.id] || 0) : 0;
    if (!f && isFiltered() && !lensActive(n)) continue;         // dimmed by filter → no label
    if (!f && searchOn && !searchHits.has(n.id)) continue;        // dimmed by search → no label
    if (!f && focusId && doi < 0.9) continue;                     // in focus, label only the subgraph
    const name = smartLabel(n.name, 26);
    const fs = 12 / sc;
    const boost = f ? 1e7 : doi >= 0.9 ? 1e6 : 0;
    cand.push({
      id: n.id, x: n.x, y: n.y + n.r + 2 / sc,
      w: Math.max(name.length * fs * 0.55, 6 / sc), h: fs + 3 / sc,
      priority: boost - (n.rank || 0), forced: f,
    });
  }
  labelShow = placeLabels(cand, { maxLabels: 70 });
}

// themed node painting (drawn in graph space; `scale` is the zoom factor)
function paintNode(node, ctx, scale) {
  if (!isFinite(node.x) || !isFinite(node.y)) return;   // guard: a NaN node can't kill the frame
  const col = colorOf(node.label);
  const future = node.bornTime > selT();
  const doi = focusId ? (focusDoi[node.id] || 0.07) : 1;
  const lf = lensActive(node) ? 1 : 0.16;
  const searchOn = searchHits.size > 0;
  const sf = searchOn ? (searchHits.has(node.id) ? 1 : 0.22) : 1;
  const prov = node.label === 'Source' || node.label === 'Organization';
  const recede = prov && !(focusId && doi >= 0.9) ? 0.55 : 1;
  const dim = (future ? 0.05 : 1) * doi * lf * sf * recede;
  if (dim < 0.015) return;
  const r = node.r, GLOW = calm ? 0 : THEME.glow, isSel = sel === node.id, isFocus = focusId === node.id;
  const px = 1 / scale;                                          // 1 screen px in graph units

  if (node.stale && lf > 0.5 && !future) { ctx.strokeStyle = rgba([240, 163, 90], 0.7); ctx.lineWidth = 1.4 * px; ctx.beginPath(); ctx.arc(node.x, node.y, r + 4 * px, 0, 7); ctx.stroke(); }
  if (node.fx != null && !node._ffrz) { ctx.strokeStyle = rgba([200, 210, 255], 0.85 * Math.max(dim, 0.4)); ctx.lineWidth = 1.3 * px; ctx.setLineDash([2 * px, 2 * px]); ctx.beginPath(); ctx.arc(node.x, node.y, r + 3 * px, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  if (node.embeddable) { ctx.strokeStyle = rgba(col, 0.3 * dim); ctx.lineWidth = 1.2 * px; ctx.beginPath(); ctx.arc(node.x, node.y, r + 3 * px, 0, 7); ctx.stroke(); }

  ctx.shadowColor = rgba(col, 0.85 * dim); ctx.shadowBlur = (isFocus || isSel ? r * 2.2 : r * 1.3) * GLOW;
  const g = ctx.createRadialGradient(node.x, node.y, 0.4, node.x, node.y, r);
  g.addColorStop(0, rgba([Math.min(255, col[0] + 38), Math.min(255, col[1] + 38), Math.min(255, col[2] + 38)], dim));
  g.addColorStop(0.55, rgba(col, dim));
  g.addColorStop(1, rgba([col[0] * 0.7, col[1] * 0.7, col[2] * 0.7], dim));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  if (isSel) { ctx.strokeStyle = THEME.ring; ctx.lineWidth = 2 * px; ctx.beginPath(); ctx.arc(node.x, node.y, r + 2 * px, 0, 7); ctx.stroke(); }

  const show = labelShow.has(node.id);   // chosen by the decluttering pass (no overlaps)
  if (show && dim > 0.12) {
    const fs = 12 * px;
    ctx.font = `${fs}px -apple-system, sans-serif`;
    ctx.fillStyle = rgba(THEME.label, Math.min(1, dim * 1.2));
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(smartLabel(node.name, 26), node.x, node.y + r + 2 * px);
  }
}

// pointer hit-area (color-picking): the dot AND the label row, so both are hoverable
function nodeArea(node, color, ctx, scale) {
  const future = node.bornTime > selT();
  if (future) return;
  ctx.fillStyle = color;
  const r = node.r, px = 1 / scale;
  ctx.beginPath(); ctx.arc(node.x, node.y, r + 3 * px, 0, 7); ctx.fill();
  const fs = 12 * px, w = smartLabel(node.name, 26).length * fs * 0.55;
  ctx.fillRect(node.x - w / 2, node.y + r + px, w, fs + 2 * px);
}

function onHover(node) {
  hover = node;
  const tip = document.getElementById('tip');
  if (node) {
    tip.hidden = false;
    tip.innerHTML = `<div class="tt">${esc(node.label)}${node.embeddable ? ' · indexed' : ''}</div><div class="tn">${esc(node.name)}</div><div class="ts" style="color:${node.stale ? 'var(--warn)' : 'var(--ok)'}">${esc(statusText(node))}</div>`;
    positionTip();
  } else tip.hidden = true;
}
function positionTip() {
  const tip = document.getElementById('tip');
  tip.style.left = Math.min(window.innerWidth - 240, lastMx + 14) + 'px';
  tip.style.top = Math.min(window.innerHeight - 90, lastMy + 16) + 'px';
}

// ── layout: size the graph canvas to the clear band (dock left, inspector right)
function layoutGraph() {
  document.body.classList.toggle('insp-open', inspOpen);
  document.body.classList.toggle('report-open', reportOpen);
  document.body.classList.toggle('dock-closed', !dockOpen);
  const rpt = document.getElementById('report');
  if (rpt) rpt.style.width = reportWidth() + 'px';
  if (!Graph) return;
  // Report mode keeps the graph as a context rail on the left of the big panel.
  const rightPanel = reportOpen ? reportWidth() : (inspOpen ? INSPW : 0);
  const w = window.innerWidth - (dockOpen ? DOCKW : 0) - rightPanel;
  const h = window.innerHeight - HEADER - TIMEBAR;
  Graph.width(Math.max(120, w)).height(Math.max(120, h));
}
window.addEventListener('resize', layoutGraph);

// ── focus / inspector ────────────────────────────────────────────────────────
// While focused, freeze the simulation positions of OUT-of-focus nodes so the dimmed
// background stops drifting — a still backdrop makes the associated subgraph legible
// (its links keep their flowing particles). `_ffrz` marks a focus-freeze so it's distinct
// from a user pin (which keeps its dashed ring); a node re-entering focus is released.
function applyFocusFreeze() {
  for (const n of NODES) {
    const inFocus = (focusDoi[n.id] || 0) >= 0.3;
    if (!inFocus && n.fx == null) { n.fx = n.x; n.fy = n.y; n._ffrz = true; }
    else if (inFocus && n._ffrz) { n.fx = n.fy = undefined; n._ffrz = false; }
  }
}
function releaseFocusFreeze() {
  for (const n of NODES) { if (n._ffrz) { n.fx = n.fy = undefined; n._ffrz = false; } }
}
function setFocus(id) {
  const A = byId[id]; if (!A) return;
  focusId = id;
  focusDoi = computeDoi(id, (x) => (byId[x] ? byId[x].adj : []));   // tested lib
  document.getElementById('focus-banner').hidden = false;
  document.getElementById('focus-name').textContent = trunc(A.name, 26);
  applyFocusFreeze();
  Graph && Graph.linkDirectionalParticles(particleCount);
  poke();
}
function clearFocus() { focusId = null; focusDoi = {}; releaseFocusFreeze(); document.getElementById('focus-banner').hidden = true; Graph && Graph.linkDirectionalParticles(particleCount); poke(); }
document.getElementById('focus-clear').onclick = () => { clearFocus(); Graph && Graph.zoomToFit(600, 50); };

// frame the bright subgraph (node + 1-hop). The canvas IS the clear band, so the
// library's zoomToFit centers it correctly — no manual camera math, DPR-correct.
function focusNode(node) {
  setFocus(node.id);
  inspOpen = true; layoutGraph();
  // center the clicked node at a comfortable zoom — always dead-center, never a
  // void; the focus dimming highlights its subgraph around it.
  setTimeout(() => { Graph.centerAt(node.x, node.y, 600); Graph.zoom(Math.max(1.4, Math.min(2.2, Graph.zoom() * 1.4)), 600); }, 30);
}

function selectNode(n) {
  sel = n.id;
  if (window.__onSelectNode) window.__onSelectNode(n.id);   // collapse associate panel on a node switch
  if (!reportOpen) {                          // report stays open across selections; it just updates
    inspOpen = true; layoutGraph();
    const insp = document.getElementById('insp'); insp.hidden = false;
    document.getElementById('i-dot').style.background = rgba(colorOf(n.label), 1);
    document.getElementById('i-type').textContent = n.label + (n.embeddable ? ' · indexed' : '');
    document.getElementById('i-name').textContent = n.name;
    const st = document.getElementById('i-status'); st.textContent = statusText(n); st.style.color = n.stale ? 'var(--warn)' : 'var(--ok)';
    const of = document.getElementById('i-openfile');             // 1-click access for file-backed nodes
    of.hidden = !n.file_path; of.onclick = () => openFile(n.file_path);
    document.getElementById('i-components').innerHTML = '<div class="dk-empty" style="font-size:11px">loading…</div>';
  }
  const nodeReq = fetch('/api/node?id=' + encodeURIComponent(n.id)).then((r) => r.json());
  // The "See" layer: read the node's primary file in parallel (sandboxed BFF).
  const srcReq = fetch('/api/source?id=' + encodeURIComponent(n.id)).then((r) => r.json()).catch(() => ({ source: null }));
  Promise.all([nodeReq, srcReq]).then(([{ node }, { source }]) => {
    node = node || {};
    const edges = node.edges || [];
    const edgeSources = edges.filter((e) => e.label === 'Source' && e.dir === 'in');
    // Prefer the server's full (uncapped) INFORMS list so provenance can show ALL
    // sources, not just those within the 60-edge graph cap.
    const sources = (node.all_sources && node.all_sources.length) ? node.all_sources : edgeSources;
    // The composable inspector: resolveLayout picks components from the node's
    // content-signals, the registry renders each. Merge the live graph node (raw
    // props for keyvalue/body) with derived resolver signals.
    const signals = {
      ...node, ...n,
      label: n.label,
      sourceKind: node.source_kind || n.source_kind,
      // a primary file may be the node's own, or its top incoming Source (from the BFF)
      filePath: node.file_path || n.file_path || (source && source.sourcePath),
      url: node.url || n.url,
      tags: node.tags || n.tags,
      hasText: !!(node.full_text || node.desc || n.desc || node.description),
      sourceCount: sources.length,
      edgeCount: edges.length - edgeSources.length,
      source_count: node.source_count,           // real uncapped counts (server COUNT)
      degree: node.degree != null ? node.degree : n.degree,
      superseded: !!node.superseded_by,
      confidence: node.confidence || n.confidence,
      citation: node.citation || n.citation,
      jurisdiction: node.jurisdiction || n.jurisdiction,
      status: node.status || n.status,
      full_text: node.full_text || n.full_text,
      desc: node.desc || n.desc,
    };
    const data = {
      edges, sources, source,
      degree: node.degree, relTypes: node.rel_types,
      created_at: node.created_at, valid_until: node.valid_until,
      superseded_by: node.superseded_by, invalidated_reason: node.invalidated_reason,
      superseded_by_id: node.superseded_by_id, superseded_by_name: node.superseded_by_name,
      resurface: resurfaceState(node.created_at, node.degree, { snoozedUntil: getSnooze(n.id), now: Date.now(), superseded: !!node.superseded_by }),
      chart: relationDistribution(node.rel_types || edges.map((e) => e.type)),
      notes: node.notes || [], protectedFacts: node.protected_facts || [], retiredFacts: node.retired_facts || [], id: n.id,
      goal_milestones: node.goal_milestones || [], goal_blockers: node.goal_blockers || [],
      propCount: node.props ? Object.keys(node.props).filter((k) => k !== 'embedding' && k !== 'embedding_hash' && node.props[k] != null).length : null,
    };
    current = { n, signals, data };
    if (studyMode) { study = { cards: buildCards(signals), idx: 0, revealed: false, reviewed: 0 }; renderStudy(); }
    else if (reportOpen) renderReport(); else renderInspector();
  }).catch(() => { const c = document.getElementById(reportOpen ? 'r-components' : 'i-components'); if (c) c.innerHTML = '<div class="dk-empty" style="font-size:11px">load failed</div>'; });
  setFocus(n.id);
  const pinBtn = document.getElementById('a-pin');
  const setPinLabel = () => (pinBtn.innerHTML = n.fx != null ? '<span>📌</span> Unpin' : '<span>📌</span> Pin');
  setPinLabel();
  pinBtn.onclick = () => { if (n.fx != null) { n.fx = n.fy = undefined; } else { n.fx = n.x; n.fy = n.y; } setPinLabel(); Graph.d3ReheatSimulation(); poke(); };
  document.getElementById('a-focus').onclick = () => focusNode(n);
  document.getElementById('a-similar').onclick = () => runSearch(n.name);
  poke();
}
// A key-fact that maps to a component you can jump to (click the count → see the items).
const KF_JUMP = { sources: 'provenance', connections: 'relations' };
// key-facts metric row → HTML (shared by inspector + report)
function keyFactsHtml(prefix) {
  if (!current) return '';
  const facts = keyFacts(current.signals, current.data);
  if (!facts.length) return '';
  return facts.map((f) => {
    const jump = KF_JUMP[f.label];
    const cls = jump ? ' kf-jump' : '';
    return `<div class="kf${cls}"${jump ? ` data-jump="${jump}"` : ''}><div class="kf-l">${esc(f.label)}</div><div class="kf-v">${esc(String(f.value))}</div></div>`;
  }).join('');
}
// Click a sources/connections card → scroll its component into view + flash it.
function wireKeyfactJump(host, componentsHost) {
  host.querySelectorAll('.kf-jump').forEach((kf) => {
    kf.onclick = () => {
      const el = componentsHost.querySelector('.c-' + kf.dataset.jump + ', .rpt-c-' + kf.dataset.jump);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('kf-flash'); setTimeout(() => el.classList.remove('kf-flash'), 900);
    };
  });
}

// The slim inspector (peek): identity + key facts + a compact component stack + Expand.
// ── Inspector section collapse (UX: stop sections bleeding together) ──────────
// Persisted, default-aware. List-heavy sections (Relations/Sources/Notes/History) and the
// editable attribute section are collapsible; the attribute editor starts collapsed so it
// doesn't stack redundantly under the read-only relations that show the same edges.
const COLLAPSE_KEY = 'sb.insp.collapsed';
const collapseStore = () => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'); } catch { return []; } };
const secCollapsed = (id, def) => isColRaw(collapseStore(), id, def);
const secToggle = (id, def) => { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(togColRaw(collapseStore(), id, def))); } catch (e) {} };
// component id → { title, count(data) } for the sections that get a collapsible header.
const SEC_TITLES = {
  provenance: { title: 'Sources', count: (d) => (d.sources || []).length },
  relations: { title: 'Relations', count: (d) => (d.degree != null ? d.degree : (d.edges || []).length) },
  notes: { title: 'Notes', count: (d) => (d.notes || []).length },
  'protected-facts': { title: 'Protected facts', count: (d) => (d.protectedFacts || []).length },
  timeline: { title: 'History' },
  keyvalue: { title: 'Properties', count: (d) => d.propCount },
};
// Sections that start collapsed (opt-in detail), so they don't bury the curated view.
const SEC_DEFAULT_COLLAPSED = { keyvalue: true };
function sectionHtml(p) {
  const meta = SEC_TITLES[p.id];
  if (!meta) return `<div class="insp-c insp-c-${p.id}">${p.html}</div>`;   // always-visible (progress, text, …)
  const n = meta.count ? meta.count(current.data) : null;
  const def = !!SEC_DEFAULT_COLLAPSED[p.id];
  const collapsed = secCollapsed('sec:' + p.id, def);
  return `<section class="insp-sec insp-c-${p.id}${collapsed ? ' collapsed' : ''}" data-sec="sec:${p.id}"${def ? ' data-defcollapsed="1"' : ''}>` +
    `<button class="insp-sec-h" type="button"><span class="insp-sec-t">${esc(meta.title)}</span>` +
    `${n != null ? `<span class="insp-sec-n">${n}</span>` : ''}<i class="insp-chev" aria-hidden="true">›</i></button>` +
    `<div class="insp-sec-b">${p.html}</div></section>`;
}
function renderInspector() {
  if (!current) return;
  document.getElementById('i-keyfacts').innerHTML = keyFactsHtml('i');
  wireKeyfactJump(document.getElementById('i-keyfacts'), document.getElementById('i-components'));
  const comps = document.getElementById('i-components');
  const parts = composeView(current.signals, current.data, caps, 'inspector');
  comps.innerHTML = parts.length
    ? parts.map((p) => sectionHtml(p)).join('')
    : '<div class="dk-empty" style="font-size:11px">no detail</div>';
  renderScheduleSection();
  renderFieldRows();
}

// Schedule section (#25 P2): set the node's intention dates. Review (revisit) for every
// node; Due (deadline) for non-Goal nodes — a Goal carries its deadline as target_date in
// goal-progress, so no double-due. Collapsible, default collapsed (like Edit attributes).
function renderScheduleSection() {
  const host = document.getElementById('i-schedule');
  if (!host) return;
  host.innerHTML = '';
  if (!current) return;
  const node = current.signals;
  const order = node.label === 'Goal' ? ['review_at'] : ['review_at', 'due_at'];
  const collapsed = secCollapsed('sec:schedule', true);
  const sec = document.createElement('section');
  sec.className = 'insp-sec insp-sec-schedule' + (collapsed ? ' collapsed' : '');
  sec.dataset.sec = 'sec:schedule';
  sec.dataset.defcollapsed = '1';
  sec.innerHTML = '<button class="insp-sec-h" type="button"><span class="insp-sec-t">Schedule</span><i class="insp-chev" aria-hidden="true">›</i></button>' +
    '<div class="insp-sec-b">' + order.map((k) => {
      const val = node[k] || '';
      const dl = val ? dueLabel(val, Date.now()) : '';
      const overdue = val && Date.parse(val + 'T00:00:00') < Date.now();
      return `<div class="sch-row"><span class="sch-label">${esc(KIND_META[k].label)}</span>` +
        `<input type="date" class="sch-date" data-schedule="${esc(k)}" value="${esc(val)}" aria-label="${esc(KIND_META[k].label)} date">` +
        (dl ? `<span class="sch-due${overdue ? ' overdue' : ''}">${esc(dl)}</span>` : '') + '</div>';
    }).join('') + '</div>';
  host.appendChild(sec);
}

// Per-field association rows (#29): each named field of the selected node (People /
// Projects / Goals / Skills …) becomes an inline picker — current members as removable
// chips, a typeahead (filtered to the field's target label) to add. Reuses createPicker
// in onPick (immediate-relate) mode + removeEdge (Stage 1). Grows the graph by field.
function renderFieldRows() {
  const host = document.getElementById('i-fields');
  if (!host) return;
  host.innerHTML = '';
  if (!current) return;
  const node = current.n, edges = (current.data && current.data.edges) || [];
  const fields = fieldRowsFor(node.label);
  if (!fields.length) return;
  // The editable attributes live in their own collapsible section, COLLAPSED by default —
  // it overlaps the read-only Relations above, so it's opt-in (expand to edit).
  const collapsed = secCollapsed('sec:fields', true);
  const sec = document.createElement('section');
  sec.className = 'insp-sec insp-sec-fields' + (collapsed ? ' collapsed' : '');
  sec.dataset.sec = 'sec:fields';
  sec.dataset.defcollapsed = '1';
  sec.innerHTML = '<button class="insp-sec-h" type="button"><span class="insp-sec-t">Edit attributes</span><i class="insp-chev" aria-hidden="true">›</i></button><div class="insp-sec-b"></div>';
  const body = sec.querySelector('.insp-sec-b');
  host.appendChild(sec);
  for (const f of fields) {
    const members = membersForField(edges, f);
    const row = document.createElement('div');
    row.className = 'ifld';
    row.dataset.fieldKey = f.key;   // lets callers target a specific field's picker (e.g. the goal on-ramp) by key, not render order
    row.innerHTML =
      `<div class="ifld-h">${esc(f.label)}</div>` +
      `<div class="ifld-members">${members.map((m) =>
        `<span class="al-token"><span class="al-token-name">${esc(m.name || '')}</span>` +
        (m.rel_id ? `<button class="al-token-x" data-unrel="${esc(m.rel_id)}" data-name="${esc(m.name || '')}" title="remove" aria-label="remove ${esc(m.name || '')}">×</button>` : '') +
        `</span>`).join('') || '<span class="ifld-empty">—</span>'}</div>` +
      `<div class="al-field ifld-add"><input type="text" class="ifld-input" placeholder="+ ${esc(f.label.toLowerCase())}…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" /><div class="al-menu ifld-menu" role="listbox" hidden></div></div>`;
    row.querySelectorAll('.al-token-x[data-unrel]').forEach((b) => { b.onclick = () => removeEdge(b.dataset.unrel, b.dataset.name); });
    const input = row.querySelector('.ifld-input'), menu = row.querySelector('.ifld-menu');
    createPicker({
      input, menu,
      filterLabel: f.targetLabel,                                   // only the field's target label
      getExclude: () => members.map((m) => m.id).concat(node.id),   // hide existing members + self
      onPick: async (opt) => {
        try {
          const r = await fetch('/api/relate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(relateArgs(f, node.id, opt.id)) }).then((x) => x.json());
          if (r.error) { input.placeholder = r.error; return; }     // non-blocking; filter makes this rare
          // Optimistic add: append the picked node as a removable chip. We use `opt` (not
          // the relate response, whose target end is the node itself for incoming fields)
          // + the new rel_id — so it shows even when the edge falls past the 60-edge cap.
          const relId = r.edge && r.edge.rel_id, memEl = row.querySelector('.ifld-members');
          const empty = memEl.querySelector('.ifld-empty'); if (empty) empty.remove();
          memEl.insertAdjacentHTML('beforeend',
            `<span class="al-token"><span class="al-token-name">${esc(opt.name)}</span>` +
            (relId ? `<button class="al-token-x" data-unrel="${esc(relId)}" data-name="${esc(opt.name)}" title="remove" aria-label="remove ${esc(opt.name)}">×</button>` : '') +
            `</span>`);
          const x = memEl.lastElementChild.querySelector('.al-token-x');
          if (x) x.onclick = () => removeEdge(x.dataset.unrel, x.dataset.name);
          members.push({ id: opt.id, name: opt.name, rel_id: relId });   // exclude from this field's future searches
          refreshGraphData();
        } catch (e) { /* ignore */ }
      },
    });
    body.appendChild(row);
  }
}

// The large report workspace: same components at report altitude (subgraph, big
// excerpt, full panels). Graph stays as the context rail on the left.
function renderReport() {
  if (!current) return;
  const n = current.n;
  document.getElementById('r-dot').style.background = rgba(colorOf(n.label), 1);
  document.getElementById('r-type').textContent = n.label + (n.embeddable ? ' · indexed' : '');
  document.getElementById('r-name').textContent = n.name;
  const rst = document.getElementById('r-status'); rst.textContent = statusText(n); rst.style.color = n.stale ? 'var(--warn)' : 'var(--ok)';
  document.getElementById('r-keyfacts').innerHTML = keyFactsHtml('r');
  wireKeyfactJump(document.getElementById('r-keyfacts'), document.getElementById('r-components'));
  const parts = composeView(current.signals, current.data, caps, 'report');
  const host = document.getElementById('r-components');
  if (!parts.length) { host.innerHTML = '<div class="dk-empty">no detail</div>'; return; }
  // Composable layout: each node *type* remembers how its cards were arranged + sized.
  const saved = parseLayout(localStorage.getItem(layoutKey(n)));
  const ordered = orderParts(parts, saved.order);
  host.innerHTML = ordered.map((p) => {
    const span = saved.spans[p.id] === 'wide' ? ' rpt-c--wide' : (saved.spans[p.id] === 'normal' ? ' rpt-c--narrow' : '');
    return `<section class="rpt-c rpt-c-${p.id}${span}" draggable="true" data-id="${esc(p.id)}">` +
      `<div class="rpt-c-h"><span class="rpt-grip" title="drag to rearrange">⠿</span><span class="rpt-c-t">${esc(p.id)}</span>` +
      `<button class="rpt-wide" title="toggle width" aria-label="toggle width">⤢</button></div>${p.html}</section>`;
  }).join('');
  wireCardLayout(host, n);
}
const layoutKey = (n) => `scatterbrained:layout:${n.label || 'node'}`;
function wireCardLayout(host, n) {
  const cards = [...host.querySelectorAll('.rpt-c')];
  const currentOrder = () => [...host.querySelectorAll('.rpt-c')].map((c) => c.dataset.id);
  const persist = (spans) => {
    const prev = parseLayout(localStorage.getItem(layoutKey(n)));
    localStorage.setItem(layoutKey(n), serializeLayout(currentOrder(), spans || prev.spans));
  };
  let dragId = null;
  cards.forEach((card) => {
    card.addEventListener('dragstart', (e) => { dragId = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); host.querySelectorAll('.drop-into').forEach((c) => c.classList.remove('drop-into')); });
    card.addEventListener('dragover', (e) => { e.preventDefault(); if (card.dataset.id !== dragId) card.classList.add('drop-into'); });
    card.addEventListener('dragleave', () => card.classList.remove('drop-into'));
    card.addEventListener('drop', (e) => {
      e.preventDefault(); card.classList.remove('drop-into');
      if (!dragId || card.dataset.id === dragId) return;
      const order = moveBefore(currentOrder(), dragId, card.dataset.id);
      const dragged = host.querySelector(`.rpt-c[data-id="${CSS.escape(dragId)}"]`);
      host.insertBefore(dragged, card);                  // reflect immediately, then persist
      void order; persist();
    });
    card.querySelector('.rpt-wide').addEventListener('click', () => {
      const spans = toggleSpan(parseLayout(localStorage.getItem(layoutKey(n))).spans, card.dataset.id);
      card.classList.toggle('rpt-c--wide', spans[card.dataset.id] === 'wide');
      card.classList.toggle('rpt-c--narrow', spans[card.dataset.id] === 'normal');
      persist(spans);
    });
  });
}

function openReport() {
  if (!current) return;
  reportOpen = true; inspOpen = false;
  document.getElementById('insp').hidden = true;
  document.getElementById('tip').hidden = true;       // drop any stray graph hover tooltip
  document.getElementById('report').hidden = false;
  layoutGraph();
  renderReport();
  focusNode(current.n);
  poke();
}
function collapseReport() {
  reportOpen = false; studyMode = false;
  document.getElementById('report').hidden = true;
  if (current) { inspOpen = true; document.getElementById('insp').hidden = false; renderInspector(); }
  layoutGraph();
  poke();
}
function closeReport() { reportOpen = false; studyMode = false; document.getElementById('report').hidden = true; sel = null; layoutGraph(); clearFocus(); poke(); }

// ── Study mode (M-H) — active recall over the current node's cards ────────────
function openStudy() {
  if (!current) return;
  study = { cards: buildCards(current.signals), idx: 0, revealed: false, reviewed: 0 };
  studyMode = true; reportOpen = true; inspOpen = false;
  document.getElementById('insp').hidden = true;
  document.getElementById('tip').hidden = true;
  document.getElementById('report').hidden = false;
  layoutGraph(); renderStudy(); poke();
}
function renderStudy() {
  const n = current.n;
  document.getElementById('r-dot').style.background = rgba(colorOf(n.label), 1);
  document.getElementById('r-type').textContent = 'study · ' + n.label;
  document.getElementById('r-name').textContent = n.name;
  document.getElementById('r-status').textContent = '';
  document.getElementById('r-keyfacts').innerHTML = '';
  const ctx = { esc, trunc, caps };
  document.getElementById('r-components').innerHTML =
    `<section class="rpt-c rpt-c-flashcard">${REGISTRY.flashcard.render(current.signals, { cards: study.cards, study }, ctx)}</section>`;
}
function handleCard(action) {
  if (!study) return;
  if (action === 'reveal') study.revealed = true;
  else if (action === 'restart') { study.idx = 0; study.revealed = false; study.reviewed = 0; }
  else if (action.startsWith('grade:')) {
    const grade = action.slice(6);
    const card = study.cards[study.idx];
    if (card && !card.auto) {                               // persist schedule for real (non-auto) cards
      const key = cardSchedKey(current.n.id, study.idx);
      let prev = {}; try { prev = JSON.parse(localStorage.getItem(key)) || {}; } catch {}
      const next = nextReview(grade, prev);
      next.dueAt = Date.now() + next.interval * 86400000;
      localStorage.setItem(key, JSON.stringify(next));
    }
    study.reviewed += 1; study.idx += 1; study.revealed = false;
  }
  renderStudy();
}

// panels eat the hover tooltip (it lives in graph space and won't otherwise clear)
['report', 'insp'].forEach((id) => document.getElementById(id)
  .addEventListener('mouseenter', () => { const t = document.getElementById('tip'); if (t) t.hidden = true; }));
// in-component navigation (e.g. timeline's "superseded by" link → the resolving node)
['i-components', 'r-components'].forEach((id) => document.getElementById(id)
  .addEventListener('click', (e) => {
    const sh = e.target.closest('.insp-sec-h');
    if (sh) { const sec = sh.closest('.insp-sec'); secToggle(sec.dataset.sec, sec.dataset.defcollapsed === '1'); sec.classList.toggle('collapsed'); return; }
    const rx = e.target.closest('.rel-x[data-unrel]');
    if (rx) { e.preventDefault(); removeEdge(rx.dataset.unrel, rx.dataset.name); return; }
    const nav = e.target.closest('.nav-node');
    if (nav) { e.preventDefault(); selectByIdOrName(nav.dataset.id, nav.dataset.name); return; }
    const gp = e.target.closest('[data-gp-action="link-project"]');
    if (gp) {
      // Goal degraded-state on-ramp: open the "Edit attributes" section and focus the existing
      // "Achieved by" relate picker — reuse the field machinery, don't build a parallel one.
      e.preventDefault();
      const host = gp.closest('#i-components, #r-components') || document;
      const sec = host.querySelector('.insp-sec-fields') || document.querySelector('.insp-sec-fields');
      if (sec) {
        if (sec.classList.contains('collapsed')) { secToggle(sec.dataset.sec, sec.dataset.defcollapsed === '1'); sec.classList.remove('collapsed'); }
        // Focus the "Achieved by" (goal-project) picker by KEY, not render order; fall back to the first.
        const input = sec.querySelector('.ifld[data-field-key="goal-project"] .ifld-input') || sec.querySelector('.ifld-input');
        if (input) { input.scrollIntoView({ block: 'center', behavior: 'smooth' }); input.focus(); }
      }
      return;
    }
    const rs = e.target.closest('[data-resurface]');
    if (rs) { e.preventDefault(); handleResurface(rs.dataset.resurface); return; }
    const card = e.target.closest('[data-card]');
    if (card) { e.preventDefault(); handleCard(card.dataset.card); return; }
    const ai = e.target.closest('button[data-ai]');
    if (ai) { e.preventDefault(); handleAi(ai.dataset.ai); }
  }));
['i-components', 'r-components'].forEach((id) => document.getElementById(id)
  .addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-ai]'); if (!form) return;
    e.preventDefault(); handleAi(form.dataset.ai, form);
  }));
// Collapse toggle for the attribute-editor + schedule sections (own containers).
['i-fields', 'i-schedule'].forEach((id) => document.getElementById(id).addEventListener('click', (e) => {
  const sh = e.target.closest('.insp-sec-h'); if (!sh) return;
  const sec = sh.closest('.insp-sec'); secToggle(sec.dataset.sec, sec.dataset.defcollapsed === '1'); sec.classList.toggle('collapsed');
}));
// Schedule (#25 P2): commit an intention date → narrow setter, then refresh labels.
document.getElementById('i-schedule').addEventListener('change', async (e) => {
  const di = e.target.closest('[data-schedule]'); if (!di || !current) return;
  try {
    const r = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current.n.id, kind: di.dataset.schedule, when: di.value }) }).then((x) => x.json());
    if (r.error) { di.title = r.error; return; }
    current.signals[di.dataset.schedule] = r.value || '';
    rerenderActive();   // refresh the relative due label
  } catch (err) { /* ignore */ }
});
// Goal target_date (#25 P1): commit the date input → narrow setter, then re-render.
['i-components', 'r-components'].forEach((id) => document.getElementById(id)
  .addEventListener('change', async (e) => {
    const di = e.target.closest('[data-goaldate]'); if (!di) return;
    try {
      const r = await fetch('/api/goal/target-date', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: di.dataset.goaldate, date: di.value }) }).then((x) => x.json());
      if (r.error) { di.title = r.error; return; }
      if (current && current.signals) current.signals.target_date = r.target_date || '';   // keep state in sync
      rerenderActive();   // refresh the due label
    } catch (err) { /* ignore */ }
  }));
function rerenderActive() { if (studyMode) return; if (reportOpen) renderReport(); else renderInspector(); }
function handleAi(action, formEl) {
  if (!current) return;
  const id = current.n.id; current.data.ai = current.data.ai || {};
  if (action === 'summary') {
    current.data.ai.summary = { loading: true }; rerenderActive();
    fetch('/api/ai/summary?id=' + encodeURIComponent(id)).then((r) => r.json()).then((res) => {
      current.data.ai.summary = res.available === false ? { error: 'no local model connected' }
        : res.error ? { error: res.error } : { text: res.text, model: res.model };
      rerenderActive();
    }).catch(() => { current.data.ai.summary = { error: 'request failed' }; rerenderActive(); });
  } else if (action === 'ask' && formEl) {
    const q = formEl.querySelector('.ai-qa-in').value.trim(); if (!q) return;
    current.data.ai.qa = { question: q, loading: true }; rerenderActive();
    fetch('/api/ai/ask?id=' + encodeURIComponent(id) + '&q=' + encodeURIComponent(q)).then((r) => r.json()).then((res) => {
      current.data.ai.qa = { question: q, answer: res.available === false ? 'no local model connected' : (res.text || res.error || 'no answer') };
      rerenderActive();
    }).catch(() => { current.data.ai.qa = { question: q, answer: 'request failed' }; rerenderActive(); });
  }
}
function handleResurface(action) {
  if (!current) return;
  const id = current.n.id;
  if (action === 'snooze') setSnooze(id, Date.now() + 7 * 86400000);
  else if (action === 'unsnooze') setSnooze(id, 0);
  else if (action === 'pin') { const n = current.n; if (n.fx != null) { n.fx = n.fy = undefined; } else { n.fx = n.x; n.fy = n.y; } Graph.d3ReheatSimulation(); poke(); }
  current.data.resurface = resurfaceState(current.data.created_at, current.signals.degree, { snoozedUntil: getSnooze(id), now: Date.now(), superseded: !!current.data.superseded_by });
  if (reportOpen) renderReport(); else renderInspector();
}
document.getElementById('i-expand').onclick = openReport;
document.getElementById('a-study').onclick = openStudy;
document.getElementById('r-collapse').onclick = collapseReport;
document.getElementById('r-export').onclick = () => {
  if (!current) return;
  const md = nodeToMarkdown(current.signals, current.data);
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = exportFilename(current.n.name);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
document.getElementById('report-x').onclick = closeReport;
document.getElementById('r-focus').onclick = () => current && focusNode(current.n);
document.getElementById('r-pin').onclick = () => { const n = current && current.n; if (!n) return; if (n.fx != null) { n.fx = n.fy = undefined; } else { n.fx = n.x; n.fy = n.y; } Graph.d3ReheatSimulation(); poke(); };

function closeInsp() { sel = null; inspOpen = false; clearFocus(); layoutGraph(); document.getElementById('insp').hidden = true; poke(); }
document.getElementById('insp-x').onclick = closeInsp;

function focusByName(name) {
  const n = NODES.find((x) => x.name === name) || NODES.find((x) => x.name && name && x.name.toLowerCase() === name.toLowerCase());
  if (n) { selectNode(n); focusNode(n); } else { runSearch(name); document.getElementById('q').value = name; }
}
window.__focus = focusByName;
// Open a node by id (works off-canvas: selectNode fetches /api/node by id even when the node
// isn't a rendered constellation node). Used by the dock so a Goal opens the GOAL, not its project.
window.__open = (id, name, label) => { selectNode({ id, name, label }); refreshGraphData(name); };

// ── file reader: load a whole source/code file in-app (sandboxed by the server) ──
const FR = document.getElementById('filereader');
let frState = null;   // { text, kind, path } of the loaded file, for view switching
let pdfTask = null;
function closeFile() {
  if (frEdit.active) { releaseLock(true); leaveEditUi(); }   // release the edit lock on close
  FR.hidden = true;
  document.getElementById('fr-body').innerHTML = ''; document.getElementById('fr-md').innerHTML = '';
  document.getElementById('fr-embed').src = 'about:blank';
  const pane = document.getElementById('fr-pdf'); pane.innerHTML = ''; pane.hidden = true;
  document.getElementById('fr-loading').hidden = true; setHistoryOpen(false);
  if (pdfTask) { try { pdfTask.destroy(); } catch { /* ignore */ } pdfTask = null; }
}
function renderReader(mode) {
  const body = document.getElementById('fr-body'), md = document.getElementById('fr-md');
  const rendered = mode === 'rendered';
  body.hidden = rendered; md.hidden = !rendered;
  document.getElementById('fr-rendered').classList.toggle('on', rendered);
  document.getElementById('fr-raw').classList.toggle('on', !rendered);
  if (rendered) {
    if (frState.kind === 'csv' || frState.kind === 'xlsx') {
      const rows = frState.rows || (frState.rows = parseCsv(frState.text));
      buildSheet(md, rows, { notes: frState.notes, filePath: frState.path });
    } else {
      md.innerHTML = miniMarkdown(frState.text, esc);
      decorateSections(md, frState.notes);   // heading note-buttons + existing section notes
      md.scrollTop = 0;
    }
  } else {
    body.innerHTML = rawLinesHtml(frState.text, frState.notes, esc);   // per-line gutters + anchored notes
    body.scrollTop = 0;
  }
}
// Per-line ("anchored") notes — click a line's gutter (raw view) to attach a note
// to that line; it persists as a Note ABOUT the file's Source, anchored by line +
// snippet. Works for documents and for a CSV opened raw (a line is a row).
document.getElementById('fr-body').addEventListener('click', (e) => {
  const gut = e.target.closest('.fr-gut');
  if (gut) openLineNoteInput(gut.closest('.fr-line'));
});
function openLineNoteInput(lineEl) {
  if (!lineEl || !frState) return;
  const next = lineEl.nextElementSibling;
  if (next && next.classList.contains('fr-addrow')) { next.querySelector('textarea').focus(); return; }
  const ln = Number(lineEl.dataset.line);
  const row = document.createElement('div');
  row.className = 'fr-addrow';
  row.innerHTML = `<textarea class="fr-add-tx" rows="2" placeholder="note on line ${ln}…" aria-label="note text"></textarea><button class="fr-add-expand" title="open large editor" aria-label="open large editor">⤢</button><button class="fr-add-go">add note</button>`;
  lineEl.after(row);
  const ta = row.querySelector('.fr-add-tx'); ta.focus();
  const snippet = lineEl.querySelector('.fr-tx') ? lineEl.querySelector('.fr-tx').textContent : '';
  const submitText = async (text) => {
    text = String(text || '').trim(); if (!text) { row.remove(); return; }
    try {
      const res = await fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: frState.path, anchor_kind: 'line', locator: ln, snippet, text }) });
      const j = await res.json();
      if (j.note) { frState.notes = [...(frState.notes || []), j.note]; renderReader('raw'); } else { row.remove(); }
    } catch (e) { row.remove(); }
  };
  const submit = () => submitText(ta.value);
  row.querySelector('.fr-add-go').onclick = submit;
  row.querySelector('.fr-add-expand').onclick = () => { const draft = ta.value; row.remove(); openNoteModal({ title: `note on line ${ln}`, text: draft, onSubmit: submitText }); };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') row.remove(); });
}
// POST a note (any anchor kind) and return the created note, or null on failure.
async function postNote(body) {
  try {
    const res = await fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    return j.note || null;
  } catch { return null; }
}
// 0-based column index -> spreadsheet letter ("A", "Z", "AA").
function colLabel(c) {
  let s = '', n = c;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
// A single floating note popover, reused by cell + section anchors: shows existing
// notes (annoHtml) and an add form. onSubmit(text) gets the trimmed note text.
let notePop = null;
function closeNotePop() { if (notePop) { notePop.remove(); notePop = null; } }
function showNotePopover(rect, { title, existing, onSubmit }) {
  closeNotePop();
  const p = document.createElement('div');
  p.className = 'fr-pop';
  p.innerHTML =
    `<div class="fr-pop-h">${esc(title)}</div>` +
    (existing && existing.length ? `<div class="fr-pop-notes">${annoHtml(existing, esc)}</div>` : '') +
    `<textarea class="fr-pop-tx" rows="2" placeholder="note…" aria-label="note text"></textarea>` +
    `<div class="fr-pop-actions"><button class="fr-pop-expand" title="open large editor" aria-label="open large editor">⤢</button><button class="fr-pop-go">add note</button><button class="fr-pop-cancel">cancel</button></div>`;
  document.body.appendChild(p);
  notePop = p;
  // position under the anchor, clamped on-screen
  const w = 260, pad = 8;
  const left = Math.min(Math.max(pad, rect.left), window.innerWidth - w - pad);
  const top = Math.min(rect.bottom + 6, window.innerHeight - 140);
  p.style.left = left + 'px'; p.style.top = top + 'px'; p.style.width = w + 'px';
  const ta = p.querySelector('.fr-pop-tx'); ta.focus();
  const submit = async () => {
    const text = ta.value.trim(); if (!text) { closeNotePop(); return; }
    p.querySelector('.fr-pop-go').disabled = true;
    await onSubmit(text);
    closeNotePop();
  };
  p.querySelector('.fr-pop-go').onclick = submit;
  p.querySelector('.fr-pop-cancel').onclick = closeNotePop;
  p.querySelector('.fr-pop-expand').onclick = () => openNoteModal({ title, text: ta.value, existing, onSubmit });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    if (e.key === 'Escape') { e.stopPropagation(); closeNotePop(); }
  });
}
// dismiss the popover on outside click / Escape
document.addEventListener('mousedown', (e) => { if (notePop && !notePop.contains(e.target) && !e.target.closest('.cell-note-btn,.md-sec-note')) closeNotePop(); });

// A large, comfortable note editor modal — opened via the ⤢ on any note input (line /
// cell / row / column / section / PDF page / node). Carries the in-progress draft over and
// submits through the SAME onSubmit, with a Markdown preview. onSubmit(text) gets trimmed text.
let noteModal = null;
function closeNoteModal() { if (noteModal) { noteModal.remove(); noteModal = null; document.removeEventListener('keydown', noteModalKey, true); } }
function noteModalKey(e) { if (noteModal && e.key === 'Escape') { e.stopPropagation(); closeNoteModal(); } }
function openNoteModal({ title, text = '', existing = [], onSubmit }) {
  closeNoteModal(); closeNotePop();
  const m = document.createElement('div');
  m.className = 'note-modal-backdrop';
  m.innerHTML =
    '<div class="note-modal" role="dialog" aria-modal="true">' +
      `<div class="nm-head"><span class="nm-title">${esc(title || 'note')}</span><button class="nm-x" aria-label="close">×</button></div>` +
      (existing && existing.length ? `<div class="nm-existing">${annoHtml(existing, esc)}</div>` : '') +
      '<textarea class="nm-text" placeholder="write your note… (Markdown supported · ⌘↵ to save)" aria-label="note text"></textarea>' +
      '<div class="nm-prev fr-md" hidden></div>' +
      '<div class="nm-actions"><button class="nm-preview fe-btn">preview</button><span class="nm-grow"></span>' +
      '<button class="nm-cancel fe-btn">cancel</button><button class="nm-go fe-btn fe-save">add note</button></div>' +
    '</div>';
  document.body.appendChild(m);
  noteModal = m;
  const ta = m.querySelector('.nm-text');
  ta.value = text; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const submit = async () => {
    const t = ta.value.trim(); if (!t) { closeNoteModal(); return; }
    m.querySelector('.nm-go').disabled = true;
    await onSubmit(t);
    closeNoteModal();
  };
  m.querySelector('.nm-go').onclick = submit;
  m.querySelector('.nm-cancel').onclick = closeNoteModal;
  m.querySelector('.nm-x').onclick = closeNoteModal;
  m.querySelector('.nm-preview').onclick = () => {
    const prev = m.querySelector('.nm-prev'), btn = m.querySelector('.nm-preview');
    if (prev.hidden) { prev.innerHTML = miniMarkdown(ta.value, esc); prev.hidden = false; ta.style.display = 'none'; btn.textContent = 'edit'; }
    else { prev.hidden = true; ta.style.display = ''; btn.textContent = 'preview'; }
  };
  m.addEventListener('mousedown', (e) => { if (e.target === m) closeNoteModal(); });   // backdrop click
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); });
  document.addEventListener('keydown', noteModalKey, true);
}
// expand handler for the node-notes panel form (registry.js renders the ⤢ button)
window.__expandNote = (btn) => {
  const form = btn.closest('form'); if (!form) return;
  const target = form.elements.tid.value;
  const ta = form.querySelector('textarea[name=text]');
  openNoteModal({
    title: (current && current.node && (current.node.name || current.node.title)) ? `note on “${current.node.name || current.node.title}”` : 'note',
    text: ta ? ta.value : '',
    existing: (current && current.data && current.data.notes) || [],
    onSubmit: async (text) => {
      const note = await postNote({ target, text });
      if (note && current && current.data) { current.data.notes = [...(current.data.notes || []), note]; reRenderNotePanel(); }
    },
  });
};

// Add a section ("heading") note affordance to a rendered-markdown container:
// each heading gets a stable slug id, a hover note-button, and any existing notes.
function decorateSections(host, notes) {
  const idx = sectionNotesIndex(notes);
  host.querySelectorAll('h1,h2,h3,h4').forEach((h) => {
    if (h.querySelector('.md-sec-note')) return;          // idempotent
    const heading = h.textContent.trim();
    const slug = slugify(heading);
    h.classList.add('md-h');
    const btn = document.createElement('button');
    btn.className = 'md-sec-note'; btn.type = 'button';
    btn.title = 'add a note on this section'; btn.textContent = '🗒';
    btn.dataset.section = slug; btn.dataset.heading = heading;
    h.prepend(btn);
    const list = idx.get(slug);
    if (list && list.length) {
      h.classList.add('has-note');
      const box = document.createElement('div');
      box.className = 'fr-secnotes'; box.innerHTML = annoHtml(list, esc);
      h.after(box);
    }
  });
}

async function openFile(filePath) {
  if (!filePath) return;
  const body = document.getElementById('fr-body'), md = document.getElementById('fr-md'), embed = document.getElementById('fr-embed');
  const toggle = document.getElementById('fr-toggle');
  const newtab = document.getElementById('fr-newtab');
  const pdfPane = document.getElementById('fr-pdf'), loading = document.getElementById('fr-loading');
  if (frEdit.active) { releaseLock(true); leaveEditUi(); }   // abandon any edit when switching files
  frState = null; toggle.hidden = true; md.hidden = true; embed.hidden = true; embed.src = 'about:blank'; body.hidden = false; newtab.hidden = true;
  pdfPane.hidden = true; pdfPane.innerHTML = ''; loading.hidden = true;
  document.getElementById('fr-edit').hidden = true; document.getElementById('fr-history').hidden = true; setHistoryOpen(false);
  if (pdfTask) { try { pdfTask.destroy(); } catch { /* ignore */ } pdfTask = null; }
  document.getElementById('fr-path').textContent = filePath;
  document.getElementById('fr-meta').textContent = '';
  document.getElementById('fr-kind').textContent = '…';
  body.innerHTML = '<span class="fr-note">loading…</span>';
  FR.hidden = false;
  try {
    const r = await fetch('/api/file?path=' + encodeURIComponent(filePath));
    const f = (await r.json()).file || {};
    document.getElementById('fr-kind').textContent = f.kind || 'file';
    document.getElementById('fr-path').textContent = f.path || filePath;
    if (f.blocked) return void (body.innerHTML = '<span class="fr-note">outside the read sandbox — not loaded</span>');
    if (f.missing) return void (body.innerHTML = '<span class="fr-note">file not found</span>');
    if (f.tooLarge) return void (body.innerHTML = '<span class="fr-note">file too large to load here</span>');
    if (f.embed === 'pdf') {                                  // render PDFs in-app via pdf.js → canvas
      const raw = '/api/raw?path=' + encodeURIComponent(f.path || filePath);
      frState = { kind: 'pdf', path: f.path || filePath, notes: f.notes || [], text: '', rows: null };
      const nCount = anchoredCount(frState.notes);
      document.getElementById('fr-meta').textContent = 'PDF' + (nCount ? ` · ${nCount} note${nCount > 1 ? 's' : ''}` : '');
      newtab.href = raw; newtab.hidden = false;               // always-available fallback
      renderPdf(raw);
      return;
    }
    if (f.unsupported) return void (body.innerHTML = `<span class="fr-note">${esc(f.kind)} — no in-app viewer yet</span>`);
    if (f.error) return void (body.innerHTML = `<span class="fr-note">${esc(f.error)}</span>`);
    frState = { text: String(f.text || ''), kind: f.kind, path: f.path || filePath, notes: f.notes || [], rows: f.rows || null };
    const extracted = f.extracted ? ` · extracted from ${esc(f.extracted)}` : '';
    const nCount = anchoredCount(frState.notes);
    const noteTag = nCount ? ` · ${nCount} note${nCount > 1 ? 's' : ''}` : '';
    document.getElementById('fr-meta').textContent = `${f.lines || frState.text.split('\n').length} lines${extracted}${noteTag}`;
    // Markdown, CSV and xlsx get a pretty ⇄ raw switch (rendered prose / spreadsheet table).
    const isSheet = f.kind === 'csv' || f.kind === 'xlsx';
    const pretty = f.kind === 'markdown' || isSheet;
    toggle.hidden = !pretty;
    document.getElementById('fr-rendered').textContent = isSheet ? 'table' : 'rendered';
    // Markdown files are editable (lock + save + git history); show the affordances.
    const editable = f.kind === 'markdown';
    document.getElementById('fr-edit').hidden = !editable;
    document.getElementById('fr-history').hidden = !editable;
    renderReader(pretty ? 'rendered' : 'raw');
  } catch (err) { body.innerHTML = `<span class="fr-note">${esc(String(err))}</span>`; }
}
// Interactive spreadsheet: sort (click header), filter (search), resize columns,
// toggle row density. State is per-open and local to this view; the data is read-only.
function buildSheet(host, allRows, noteCtx = { notes: [], filePath: null }) {
  let sortCol = null, sortDir = 'none', query = '', comfy = false, view = 'table', chartCol = null;
  const numericCols = (allRows[0] || []).map((_, c) => isNumericColumn(allRows, c));
  // Reference→original-row-index map (sort/filter preserve row identity) so a cell
  // note anchors to its true position regardless of the current view ordering.
  const origIdx = new Map(allRows.map((r, i) => [r, i]));
  // Open the shared note popover for a cell, a whole row, or a whole column.
  const openCellNote = (cellEl) => {
    const r = Number(cellEl.dataset.r), c = Number(cellEl.dataset.c);
    const snippet = String((allRows[r] && allRows[r][c]) != null ? allRows[r][c] : '');
    const existing = cellNotesIndex(noteCtx.notes).get(`${r},${c}`) || [];
    showNotePopover(cellEl.getBoundingClientRect(), {
      title: `cell ${colLabel(c)}${r + 1}`, existing,
      onSubmit: async (text) => {
        const note = await postNote({ filePath: noteCtx.filePath, anchor_kind: 'cell', locator: makeCellLocator(r, c), snippet, text });
        if (note) { noteCtx.notes.push(note); render(); }
      },
    });
  };
  const openRowNote = (el) => {
    const r = Number(el.dataset.r);
    const snippet = (allRows[r] || []).filter(Boolean).slice(0, 4).join(' · ');
    const existing = rowNotesIndex(noteCtx.notes).get(r) || [];
    showNotePopover(el.getBoundingClientRect(), {
      title: `row ${r}`, existing,
      onSubmit: async (text) => {
        const note = await postNote({ filePath: noteCtx.filePath, anchor_kind: 'row', locator: makeRowLocator(r), snippet, text });
        if (note) { noteCtx.notes.push(note); render(); }
      },
    });
  };
  const openColNote = (el) => {
    const c = Number(el.dataset.c);
    const snippet = String((allRows[0] && allRows[0][c]) != null ? allRows[0][c] : '');
    const existing = colNotesIndex(noteCtx.notes).get(c) || [];
    showNotePopover(el.getBoundingClientRect(), {
      title: `column ${colLabel(c)}${snippet ? ` (${snippet})` : ''}`, existing,
      onSubmit: async (text) => {
        const note = await postNote({ filePath: noteCtx.filePath, anchor_kind: 'col', locator: makeColLocator(c), snippet, text });
        if (note) { noteCtx.notes.push(note); render(); }
      },
    });
  };
  const numCols = profileColumns(allRows).filter((c) => c.numeric);
  const viewBtn = () => `<button class="sheet-view ${view === 'chart' ? 'on' : ''}" title="table / chart">${view === 'chart' ? '▦ table' : '📊 chart'}</button>`;
  const render = (focusFilter) => {
    if (view === 'chart') {
      const header = allRows[0] || [];
      const spec = chartCol != null
        ? histogramSpec(columnValues(allRows, chartCol), 12, `distribution of ${header[chartCol]}`)
        : recommendChart(allRows);
      const picker = numCols.length
        ? `<select class="sheet-col" title="column"><option value="">auto</option>` +
          numCols.map((c) => `<option value="${c.index}" ${chartCol === c.index ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + `</select>`
        : '';
      const chartHtml = spec ? REGISTRY.chart.render({}, { chart: spec }, { esc, trunc })
        : `<div class="fr-note" style="padding:24px">no numeric columns to chart</div>`;
      host.innerHTML = `<div class="sheet-bar">${picker}<span class="sheet-count">${spec ? spec.kind : ''}</span>${viewBtn()}</div>` +
        `<div class="sheet-scroll sheet-chartview">${chartHtml}</div>`;
      wire(focusFilter); return;
    }
    let rows = filterRows(allRows, query);
    rows = sortRows(rows, sortCol, sortDir);
    const header = rows[0] || [], body = rows.slice(1);
    const cellIdx = cellNotesIndex(noteCtx.notes), rowIdx = rowNotesIndex(noteCtx.notes), colIdx = colNotesIndex(noteCtx.notes);
    const dot = (n) => (n ? `<span class="cell-dot" title="${n} note${n > 1 ? 's' : ''}"></span>` : '');
    const ind = (i) => (sortCol === i ? (sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : '') : '');
    const ncols = header.length;
    // header row: corner cell + a column-note button on every header
    const ths = `<th class="rownum-h"></th>` + header.map((h, i) => {
      const noted = (colIdx.get(i) || []).length;
      return `<th data-col="${i}" data-c="${i}" class="${numericCols[i] ? 'num ' : ''}${noted ? 'has-note' : ''}">` +
        `<span class="th-l">${esc(h)}</span><span class="sort-ind">${ind(i)}</span>` +
        `<button class="col-note-btn" type="button" title="note on this column" tabindex="-1">+</button>` +
        dot(noted) + `<span class="col-resize" data-col="${i}"></span></th>`;
    }).join('');
    const trs = body.map((r) => {
      const ri = origIdx.has(r) ? origIdx.get(r) : -1;
      const rNotes = ri >= 0 ? (rowIdx.get(ri) || []) : [];
      const rownum = `<td class="rownum ${rNotes.length ? 'has-note' : ''}" data-r="${ri}">` +
        `<span class="rn-v">${ri >= 0 ? ri : ''}</span>` +
        `<button class="row-note-btn" type="button" title="note on this row" tabindex="-1">+</button>` + dot(rNotes.length) + `</td>`;
      const cells = r.map((c, i) => {
        const noted = ri >= 0 ? (cellIdx.get(`${ri},${i}`) || []).length : 0;
        return `<td data-r="${ri}" data-c="${i}" class="${numericCols[i] ? 'num ' : ''}${noted ? 'has-note' : ''}">` +
          `<span class="cell-v">${esc(c)}</span>` +
          `<button class="cell-note-btn" type="button" title="note on this cell" tabindex="-1">+</button>` + dot(noted) + `</td>`;
      }).join('');
      let tr = `<tr>${rownum}${cells}</tr>`;
      if (rNotes.length) tr += `<tr class="row-anno"><td class="rownum"></td><td colspan="${ncols}">${annoHtml(rNotes, esc)}</td></tr>`;
      return tr;
    }).join('');
    const total = Math.max(0, allRows.length - 1), shown = body.length;
    host.innerHTML =
      `<div class="sheet-bar"><input class="sheet-filter" placeholder="filter rows…" value="${esc(query)}"/>` +
      `<span class="sheet-count">${shown === total ? total + ' rows' : shown + ' of ' + total}</span>` +
      `<button class="sheet-density ${comfy ? 'on' : ''}" title="row height">↕ density</button>${viewBtn()}</div>` +
      `<div class="sheet-scroll"><table class="csv-table sheet ${comfy ? 'comfy' : ''}"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
    wire(focusFilter);
  };
  const wire = (focusFilter) => {
    host.querySelector('.sheet-view').onclick = () => { view = view === 'chart' ? 'table' : 'chart'; render(); };
    const sel = host.querySelector('.sheet-col');
    if (sel) sel.onchange = () => { chartCol = sel.value === '' ? null : +sel.value; render(); };
    const fi = host.querySelector('.sheet-filter');
    if (!fi) return;                              // chart view has no table controls
    fi.oninput = () => { const p = fi.selectionStart; query = fi.value; render(true); const n = host.querySelector('.sheet-filter'); n.focus(); n.setSelectionRange(p, p); };
    if (focusFilter) fi.focus();
    host.querySelector('.sheet-density').onclick = () => { comfy = !comfy; render(); };
    host.querySelectorAll('td:not(.rownum) .cell-note-btn').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); openCellNote(b.closest('td')); };
    });
    host.querySelectorAll('.row-note-btn').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); openRowNote(b.closest('td.rownum')); };
    });
    host.querySelectorAll('.col-note-btn').forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); openColNote(b.closest('th')); };
    });
    host.querySelectorAll('th:not(.rownum-h)').forEach((th) => {
      th.addEventListener('click', (e) => {
        if (e.target.classList.contains('col-resize') || e.target.closest('.col-note-btn')) return;
        const c = +th.dataset.col;
        if (sortCol === c) { sortDir = sortDir === 'asc' ? 'desc' : sortDir === 'desc' ? 'none' : 'asc'; if (sortDir === 'none') sortCol = null; }
        else { sortCol = c; sortDir = 'asc'; }
        render();
      });
    });
    host.querySelectorAll('.col-resize').forEach((rz) => {
      rz.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const th = rz.closest('th'); const startX = e.pageX, startW = th.offsetWidth;
        const mv = (me) => { th.style.width = Math.max(44, startW + me.pageX - startX) + 'px'; };
        const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      });
    });
  };
  render();
}
// Render a PDF in-app via vendored pdf.js → canvas (reliable in headless/plugin-less
// browsers, unlike a native <iframe>). The constellation loader covers the load — the
// lib is ~1.6 MB but lazy-imported only when a PDF opens. Falls back to the iframe.
async function renderPdf(raw) {
  const body = document.getElementById('fr-body'), embed = document.getElementById('fr-embed');
  const pane = document.getElementById('fr-pdf'), loading = document.getElementById('fr-loading');
  body.hidden = true; embed.hidden = true; pane.hidden = true; pane.innerHTML = ''; delete pane.dataset.rendered;
  loading.hidden = false;
  try {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    pdfTask = pdfjs.getDocument({ url: raw });
    const pdf = await pdfTask.promise;
    const pageCount = pdf.numPages;
    const updateMeta = () => {
      const n = anchoredCount(frState ? frState.notes : []);
      document.getElementById('fr-meta').textContent = `PDF · ${pageCount} page${pageCount > 1 ? 's' : ''}` + (n ? ` · ${n} note${n > 1 ? 's' : ''}` : '');
    };
    updateMeta();
    const dpr = window.devicePixelRatio || 1;
    // Re-render just one page's notes box in place (after adding a note).
    const refreshPageNotes = (num) => {
      const wrap = pane.querySelector(`.pdf-page[data-page="${num}"]`); if (!wrap) return;
      let box = wrap.querySelector('.pdf-pagenotes');
      const list = pageNotesIndex(frState ? frState.notes : []).get(num) || [];
      if (!box) { box = document.createElement('div'); box.className = 'pdf-pagenotes'; wrap.appendChild(box); }
      box.innerHTML = annoHtml(list, esc);
      wrap.classList.toggle('has-note', list.length > 0);
    };
    const renderPage = async (num) => {
      const page = await pdf.getPage(num);
      const vp = page.getViewport({ scale: 1.5 });
      const wrap = document.createElement('div');
      wrap.className = 'pdf-page'; wrap.dataset.page = String(num);
      wrap.style.width = Math.floor(vp.width) + 'px';
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = Math.floor(vp.width) + 'px';
      wrap.appendChild(canvas);
      // Selectable text layer over the canvas (so a note can quote selected text).
      const tlDiv = document.createElement('div');
      tlDiv.className = 'pdf-textlayer';
      tlDiv.style.setProperty('--scale-factor', vp.scale);
      tlDiv.style.width = Math.floor(vp.width) + 'px'; tlDiv.style.height = Math.floor(vp.height) + 'px';
      wrap.appendChild(tlDiv);
      // Per-page note affordance (select text first to quote it as context).
      const btn = document.createElement('button');
      btn.className = 'pdf-note-btn'; btn.type = 'button';
      btn.title = 'add a note on this page (select text first to quote it)';
      btn.textContent = '🗒 note';
      btn.onclick = () => {
        const sel = (window.getSelection && String(window.getSelection())).trim ? String(window.getSelection()).trim() : '';
        const existing = pageNotesIndex(frState ? frState.notes : []).get(num) || [];
        const quoted = sel ? ` · “${sel.slice(0, 38)}${sel.length > 38 ? '…' : ''}”` : '';
        showNotePopover(btn.getBoundingClientRect(), {
          title: `page ${num}${quoted}`, existing,
          onSubmit: async (text) => {
            const note = await postNote({ filePath: frState.path, anchor_kind: 'pdf', locator: makePageLocator(num), snippet: sel, text });
            if (note) { frState.notes.push(note); refreshPageNotes(num); updateMeta(); }
          },
        });
      };
      wrap.appendChild(btn);
      pane.appendChild(wrap);
      await page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      try {
        const tc = await page.getTextContent();
        await new pdfjs.TextLayer({ textContentSource: tc, container: tlDiv, viewport: vp }).render();
      } catch { /* selection is a nicety; canvas + page notes still work */ }
      refreshPageNotes(num);
    };
    await renderPage(1);                       // first page, then reveal
    loading.hidden = true; pane.hidden = false;
    for (let i = 2; i <= pdf.numPages; i++) { if (FR.hidden || pdfTask === null) return; await renderPage(i); }
    pane.dataset.rendered = '1';               // sentinel for headless screenshot tests
  } catch (err) {
    loading.hidden = true; pane.hidden = true; // graceful fallback: native iframe + the open-in-tab link
    embed.hidden = false; embed.src = raw;
  }
}
window.__openFile = openFile;
// Inline filter for the provenance source list — shows/hides rows by name/kind
// substring so a long source list stays scannable without leaving the inspector.
window.__provFilter = (input) => {
  const q = (input.value || '').trim().toLowerCase();
  const list = input.parentElement && input.parentElement.querySelector('.prov-list');
  if (!list) return;
  let shown = 0;
  for (const row of list.querySelectorAll('.prov-row')) {
    const hit = !q || (row.dataset.f || '').includes(q);
    row.style.display = hit ? '' : 'none';
    if (hit) shown++;
  }
  const empty = list.querySelector('.prov-empty');
  if (empty) empty.style.display = shown ? 'none' : '';
};
// Notes — add a note / cycle its state, then re-render whichever panel is open.
const reRenderNotePanel = () => { if (reportOpen) renderReport(); else renderInspector(); };
window.__addNote = (form) => {
  const target = form.elements.tid.value, text = form.elements.text.value.trim();
  if (!text || !target) return;
  const btn = form.querySelector('.note-add-btn'); if (btn) btn.disabled = true;
  fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, text }) })
    .then((r) => r.json()).then((j) => {
      if (j && j.note && current && current.data) {
        current.data.notes = [...(current.data.notes || []), j.note];
        reRenderNotePanel();
      } else if (btn) btn.disabled = false;
    }).catch(() => { if (btn) btn.disabled = false; });
};
window.__noteCycle = (btn) => {
  const ORDER = ['raw', 'cued', 'addressed', 'skipped'];
  const id = btn.dataset.id, next = ORDER[(ORDER.indexOf(btn.dataset.state || 'raw') + 1) % ORDER.length];
  fetch('/api/note/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, state: next }) })
    .then((r) => r.json()).then((j) => {
      if (j && j.state && current && current.data && current.data.notes) {
        const nt = current.data.notes.find((x) => x.id === id); if (nt) nt.state = j.state;
        reRenderNotePanel();
      }
    }).catch(() => {});
};
// Protected facts (#23) — pin/unpin/resolve, then refresh the panel from the server (a
// resolve can supersede + create nodes, so re-fetch rather than guess the new state).
async function refreshProtectedFacts() {
  if (!current || !current.data) return;
  try {
    const { node } = await fetch('/api/node?id=' + encodeURIComponent(current.n.id)).then((r) => r.json());
    current.data.protectedFacts = (node && node.protected_facts) || [];
    current.data.retiredFacts = (node && node.retired_facts) || [];
    reRenderNotePanel();
  } catch (e) {}
  if (typeof loadDock === 'function') loadDock();   // the dock's needs-review count may have changed
}
window.__pinFact = (form) => {
  const target = form.closest('.pf-add').dataset.tid;
  const value = form.elements.value.value.trim();
  if (!value || !target) return;
  const note = form.elements.note ? form.elements.note.value.trim() : '';
  const kind = (detectCandidates(value)[0] || {}).kind || 'other';   // auto-derived, internal
  const btn = form.querySelector('.pf-pin-btn'); if (btn) btn.disabled = true;
  fetch('/api/protected-fact/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, value, kind, note: note || null }) })
    .then((r) => r.json()).then((j) => { if (j && j.ok) { form.reset(); refreshProtectedFacts(); } else if (btn) btn.disabled = false; })
    .catch(() => { if (btn) btn.disabled = false; });
};
window.__restoreFact = (btn) => {
  const id = btn && btn.dataset && btn.dataset.fid; if (!id) return;
  btn.disabled = true;
  fetch('/api/protected-fact/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    .then((r) => r.json()).then((j) => { if (j && j.ok) refreshProtectedFacts(); else btn.disabled = false; }).catch(() => { btn.disabled = false; });
};
// Edit a fact's human note in place (blur/Enter). Skips the round-trip if unchanged.
window.__setFactNote = (input) => {
  const id = input.dataset.fid; if (!id) return;
  const f = ((current && current.data && current.data.protectedFacts) || []).find((x) => x.id === id);
  const note = input.value.trim();
  if (f && (f.note || '') === note) return;
  fetch('/api/protected-fact/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, note }) })
    .then((r) => r.json()).then((j) => { if (j && j.ok) refreshProtectedFacts(); }).catch(() => {});
};
// Removing a protected fact drops a safeguard, so confirm inline: first click arms the
// button ("remove?"), second click within ~3s commits. (Soft unpin — history kept, re-pin
// revives — but an accidental single click shouldn't silently un-guard a value.)
window.__unpinFact = (btn) => {
  const id = btn && btn.dataset && btn.dataset.fid;
  if (!id) return;
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = 'remove?';
    btn.classList.add('pf-confirm');
    btn._disarm = setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '×'; btn.classList.remove('pf-confirm'); }, 3000);
    return;
  }
  clearTimeout(btn._disarm);
  btn.disabled = true;
  fetch('/api/protected-fact/unpin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    .then((r) => r.json()).then((j) => { if (j && j.ok) refreshProtectedFacts(); else btn.disabled = false; }).catch(() => { btn.disabled = false; });
};
window.__resolveFact = (id, decision) => {
  if (!id) return;
  fetch('/api/protected-fact/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision }) })
    .then((r) => r.json()).then((j) => { if (j && j.ok) refreshProtectedFacts(); }).catch(() => {});
};
window.__suggestFacts = (btn) => {
  const wrap = btn.closest('.pf-add'); const target = wrap.dataset.tid;
  const out = wrap.querySelector('.pf-suggestions'); if (!target || !out) return;
  btn.disabled = true; out.innerHTML = '<span class="pf-hint">scanning…</span>';
  fetch('/api/protected-fact/suggest?id=' + encodeURIComponent(target)).then((r) => r.json()).then((j) => {
    btn.disabled = false;
    const cands = (j && j.candidates) || [];
    if (!cands.length) { out.innerHTML = '<span class="pf-hint">no candidates found in the text</span>'; return; }
    out.innerHTML = cands.map((c) =>
      `<button class="pf-cand" data-v="${esc(c.value)}" data-k="${esc(c.kind)}" title="pin ${esc(c.kind)}">${esc(c.value)}</button>`).join('');
    out.querySelectorAll('.pf-cand').forEach((b) => b.onclick = () => {
      b.disabled = true;
      fetch('/api/protected-fact/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, value: b.dataset.v, kind: b.dataset.k }) })
        .then((r) => r.json()).then((res) => { if (res && res.ok) refreshProtectedFacts(); else b.disabled = false; }).catch(() => { b.disabled = false; });
    });
  }).catch(() => { btn.disabled = false; out.innerHTML = '<span class="pf-hint">scan failed</span>'; });
};
document.getElementById('fr-x').onclick = closeFile;
document.getElementById('fr-rendered').onclick = () => renderReader('rendered');
document.getElementById('fr-raw').onclick = () => renderReader('raw');
// Section ("heading") notes in the rendered-markdown view.
document.getElementById('fr-md').addEventListener('click', (e) => {
  const b = e.target.closest('.md-sec-note'); if (!b || !frState) return;
  const slug = b.dataset.section, heading = b.dataset.heading || slug;
  const existing = sectionNotesIndex(frState.notes).get(slug) || [];
  showNotePopover(b.getBoundingClientRect(), {
    title: `section “${heading}”`, existing,
    onSubmit: async (text) => {
      const note = await postNote({ filePath: frState.path, anchor_kind: 'section', locator: slug, snippet: heading, text });
      if (note) { frState.notes.push(note); renderReader('rendered'); }
    },
  });
});
FR.addEventListener('click', (e) => { if (e.target === FR && !frEdit.active) closeFile(); });
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || FR.hidden) return;
  if (frEdit.active) cancelEdit(); else closeFile();   // Escape cancels an edit before closing
});

// ── Markdown editor: lock + save-confirm + git versioning ───────────────────
// Edit mode swaps the raw view for a <textarea>; the file is locked on its :Source node
// (so agents see it), saved atomically, committed to git, and the lock released.
let frEdit = { active: false, path: null, baseHash: null };
const feText = () => document.getElementById('fe-text');

function startEditUi(text, baseHash) {
  frEdit = { active: true, path: frState.path, baseHash };
  document.getElementById('fr-body').hidden = true;
  document.getElementById('fr-md').hidden = true;
  document.getElementById('fr-toggle').hidden = true;
  document.getElementById('fr-edit').hidden = true;
  document.getElementById('fr-history').hidden = true;
  setHistoryOpen(false);
  const ta = feText(); ta.value = text; ta.style.display = '';
  document.getElementById('fe-prev').hidden = true;
  document.getElementById('fe-conflict').hidden = true;
  document.getElementById('fe-confirm').hidden = true;
  document.getElementById('fr-edit-pane').hidden = false;
  document.getElementById('fe-lock').textContent = '🔒 editing — locked for you';
  const live = document.getElementById('fe-live'); live.hidden = true; live.dataset.hash = '';
  ta.focus();
  startLiveWatch();
}
function leaveEditUi() {
  stopLiveWatch();
  document.getElementById('fr-edit-pane').hidden = true;
  document.getElementById('fr-body').hidden = false;
  document.getElementById('fr-toggle').hidden = false;
  if (frState && frState.kind === 'markdown') { document.getElementById('fr-edit').hidden = false; document.getElementById('fr-history').hidden = false; }
  frEdit = { active: false, path: null, baseHash: null };
}
// Live watch: while editing, poll for an on-disk change (an agent / another editor writing
// the same file) and warn BEFORE save. Non-blocking — the save-time conflict check + the
// git snapshot are the actual safety net; this is just an early heads-up.
let frWatch = null;
function startLiveWatch() {
  stopLiveWatch();
  frWatch = setInterval(async () => {
    if (!frEdit.active) return;
    try {
      const s = await fetch('/api/file/stat?path=' + encodeURIComponent(frEdit.path)).then((r) => r.json());
      if (s && s.hash && s.hash !== frEdit.baseHash) showLiveWarning(s.hash);
    } catch { /* ignore a transient poll failure */ }
  }, 3000);
}
function stopLiveWatch() { if (frWatch) { clearInterval(frWatch); frWatch = null; } }
function showLiveWarning(diskHash) {
  const box = document.getElementById('fe-live');
  if (box.dataset.hash === diskHash) return;                 // already warned for this version
  box.dataset.hash = diskHash; box.hidden = false;
  box.innerHTML = '⚠ This file just changed on disk (an agent or another editor). Your edits are safe — saving will catch the conflict and the prior bytes are kept in git. ' +
    '<button class="fe-btn" id="fe-live-reload">load theirs</button>';
  document.getElementById('fe-live-reload').onclick = async () => {
    const lk = await fetch('/api/file/lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: frEdit.path, reason: 'reload after external change' }) }).then((r) => r.json());
    if (lk.acquired) { feText().value = lk.text; frEdit.baseHash = lk.baseHash; box.hidden = true; box.dataset.hash = ''; }
  };
}
async function releaseLock(useBeacon) {
  if (!frEdit.active || !frEdit.path) return;
  const body = JSON.stringify({ path: frEdit.path });
  if (useBeacon && navigator.sendBeacon) { navigator.sendBeacon('/api/file/unlock', new Blob([body], { type: 'application/json' })); return; }
  try { await fetch('/api/file/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); } catch { /* best-effort */ }
}
async function enterEdit(force) {
  if (!frState || frState.kind !== 'markdown') return;
  const res = await fetch('/api/file/lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: frState.path, reason: 'editing in Studio', force: !!force }) });
  const j = await res.json().catch(() => ({}));
  if (!force && (res.status === 423 || j.acquired === false)) {
    const since = j.lockAt ? new Date(j.lockAt).toLocaleString() : 'recently';
    if (confirm(`This file is locked by "${j.holder || 'someone'}" since ${since}.\n\nTake over the lock?`)) return enterEdit(true);
    return;
  }
  if (j.error || !j.acquired) { alert('Could not start editing: ' + (j.error || 'lock unavailable')); return; }
  startEditUi(j.text || '', j.baseHash);
}
async function cancelEdit() {
  await releaseLock(false);
  leaveEditUi();
  renderReader(document.getElementById('fr-rendered').classList.contains('on') ? 'rendered' : 'raw');
}
async function doSave(overwrite) {
  document.getElementById('fe-confirm').hidden = true;
  const text = feText().value;
  const res = await fetch('/api/file/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: frEdit.path, text, baseHash: frEdit.baseHash, overwrite: !!overwrite }) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 409 || j.conflict) { showConflict(j.currentText || ''); return; }
  if (res.status === 423 || j.lockLost) { alert(`The lock was taken over by "${j.holder || 'someone'}". Your changes were NOT saved — copy them out before closing.`); return; }
  if (j.error) { alert('Save failed: ' + j.error); return; }
  frState.text = text;
  leaveEditUi();
  renderReader(document.getElementById('fr-rendered').classList.contains('on') ? 'rendered' : 'raw');
  const snap = j.snapshot ? (j.snapshot.method === 'commit' ? `prior bytes snapshotted ${(j.snapshot.rev || '').slice(0, 7)} · ` : 'prior bytes backed up · ') : '';
  fileToast(snap + (j.committed ? `saved · committed ${(j.rev || '').slice(0, 7)}` : (j.gitError ? `saved · not versioned (${j.gitError})` : 'saved')));
}
function showConflict(currentText) {
  const box = document.getElementById('fe-conflict');
  box.hidden = false;
  box.innerHTML = '<span class="fe-conflict-msg">⚠ This file changed on disk since you opened it (an agent or another editor).</span>' +
    '<button class="fe-btn" id="fe-reload">load theirs</button>' +
    '<button class="fe-btn fe-save" id="fe-overwrite">overwrite with mine</button>' +
    '<button class="fe-btn" id="fe-cdismiss">keep editing</button>';
  document.getElementById('fe-reload').onclick = () => { feText().value = currentText; box.hidden = true; };
  document.getElementById('fe-overwrite').onclick = () => { box.hidden = true; doSave(true); };
  document.getElementById('fe-cdismiss').onclick = () => { box.hidden = true; };
}
function togglePreview() {
  const prev = document.getElementById('fe-prev'), ta = feText();
  if (prev.hidden) { prev.innerHTML = miniMarkdown(ta.value, esc); prev.hidden = false; ta.style.display = 'none'; }
  else { prev.hidden = true; ta.style.display = ''; }
}
let frToastT = null;
function fileToast(msg) {
  let el = document.getElementById('fr-toast');
  if (!el) { el = document.createElement('div'); el.id = 'fr-toast'; el.className = 'fr-toast'; document.querySelector('.fr-panel').appendChild(el); }
  el.textContent = msg; el.classList.add('on');
  clearTimeout(frToastT); frToastT = setTimeout(() => el.classList.remove('on'), 4500);
}
document.getElementById('fr-edit').onclick = () => enterEdit(false);
document.getElementById('fe-cancel').onclick = cancelEdit;
document.getElementById('fe-save').onclick = () => { document.getElementById('fe-confirm').hidden = false; };
document.getElementById('fe-confirm-go').onclick = () => doSave(false);
document.getElementById('fe-confirm-no').onclick = () => { document.getElementById('fe-confirm').hidden = true; };
document.getElementById('fe-preview').onclick = togglePreview;
window.addEventListener('pagehide', () => releaseLock(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releaseLock(true); });

// ── Version history (git log of the file) + one-click restore ───────────────
// History shows as a right-side column beside the content; widen the panel for it.
function setHistoryOpen(open) {
  document.getElementById('fr-versions').hidden = !open;
  const p = document.querySelector('.fr-panel');
  if (p) p.classList.toggle('history-open', open);
}
async function openHistory() {
  const box = document.getElementById('fr-versions');
  if (!box.hidden) { setHistoryOpen(false); return; }          // toggle off
  if (!frState) return;
  box.innerHTML = '<div class="vh-h">loading history…</div>'; setHistoryOpen(true);
  const j = await fetch('/api/file/history?path=' + encodeURIComponent(frState.path)).then((r) => r.json()).catch(() => ({ error: 'failed' }));
  if (j.error) { box.innerHTML = `<div class="vh-h">version history</div><div class="fr-note">${esc(j.error)}</div>`; return; }
  if (!j.versions || !j.versions.length) { box.innerHTML = `<div class="vh-h">version history</div><div class="fr-note">${j.repo ? 'no commits yet for this file' : 'not in a git repo — saves won’t be versioned'}</div>`; return; }
  box.innerHTML = `<div class="vh-h">version history · ${j.versions.length}</div>` + j.versions.map((v, i) =>
    `<div class="vh-row" data-rev="${esc(v.rev)}"><span class="vh-rev">${esc(v.rev.slice(0, 7))}</span>` +
    `<span class="vh-sub">${esc(v.subject)}</span><span class="vh-date">${esc((v.date || '').slice(0, 10))}</span>` +
    `<button class="vh-restore" data-rev="${esc(v.rev)}" data-sub="${esc(v.subject)}"${i === 0 ? ' disabled title="current version"' : ''}>restore</button></div>`).join('');
}
document.getElementById('fr-versions').addEventListener('click', async (e) => {
  const rb = e.target.closest('.vh-restore');
  if (rb) { e.stopPropagation(); return restoreVersion(rb.dataset.rev, rb.dataset.sub); }
  const row = e.target.closest('.vh-row'); if (!row) return;
  // toggle an inline rendered preview of that version under the row
  const next = row.nextElementSibling;
  if (next && next.classList.contains('vh-preview')) { next.remove(); return; }
  document.querySelectorAll('.vh-preview').forEach((n) => n.remove());
  const j = await fetch(`/api/file/version?path=${encodeURIComponent(frState.path)}&rev=${encodeURIComponent(row.dataset.rev)}`).then((r) => r.json()).catch(() => ({ error: 'failed' }));
  const div = document.createElement('div'); div.className = 'vh-preview fr-md';
  div.innerHTML = j.error ? `<span class="fr-note">${esc(j.error)}</span>` : miniMarkdown(j.text || '', esc);
  row.after(div);
});
async function restoreVersion(rev, subject) {
  if (!frState) return;
  const short = String(rev).slice(0, 7);
  const v = await fetch(`/api/file/version?path=${encodeURIComponent(frState.path)}&rev=${encodeURIComponent(rev)}`).then((r) => r.json()).catch(() => ({ error: 'failed' }));
  if (v.error) { alert('Could not read that version: ' + v.error); return; }
  if (!confirm(`Restore to ${short} — “${subject}”?\n\nThis writes that version over the current file and adds a new commit (your current version stays in history).`)) return;
  const lock = await fetch('/api/file/lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: frState.path, reason: 'restoring a version' }) }).then((r) => r.json());
  if (!lock.acquired) { alert(`File is locked by "${lock.holder || 'someone'}". Try again shortly.`); return; }
  const save = await fetch('/api/file/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: frState.path, text: v.text, baseHash: lock.baseHash, overwrite: true, restoreOf: short }) }).then((r) => r.json());
  if (!save.saved) { alert('Restore failed: ' + (save.error || 'unknown')); return; }
  frState.text = v.text;
  setHistoryOpen(false);
  renderReader(document.getElementById('fr-rendered').classList.contains('on') ? 'rendered' : 'raw');
  fileToast(save.committed ? `restored ${short} · committed ${(save.rev || '').slice(0, 7)}` : `restored ${short}`);
}
document.getElementById('fr-history').onclick = openHistory;

// ── codebase map (dev lens): a repo's module graph in its own canvas/namespace ───
const LANG_COLORS = {
  js: '#e0b25a', ts: '#79b4ab', py: '#5a9fd4', go: '#6fc5d6', rust: '#d77f42',
  css: '#c77dff', html: '#ef9a5b', vue: '#7fd6a0', svelte: '#e06b5a',
  doc: '#8f8a7c', data: '#9aa0ab', shell: '#9ad06f', sql: '#d6a05a',
  image: '#d6688a', font: '#b07fd6', media: '#5fb0a0', other: '#6c727c',
};
const langColor = (l) => LANG_COLORS[l] || LANG_COLORS.other;
let cbGraph = null, cbRepos = null, cbHover = null;

async function openCodebase() {
  pauseMainGraph();
  document.getElementById('codebase').hidden = false;
  const sel = document.getElementById('cb-repo');
  if (!cbRepos) {
    try { cbRepos = (await fetch('/api/repos').then((r) => r.json())).repos || []; } catch { cbRepos = []; }
    sel.innerHTML = cbRepos.map((r) => `<option value="${esc(r.path)}">${esc(r.name)}</option>`).join('');
    sel.onchange = () => loadRepo(sel.value);
  }
  if (!cbRepos.length) { showCbEmpty('no mappable repos in the allowlist'); return; }
  const pref = cbRepos[0];
  sel.value = pref.path;
  loadRepo(pref.path);
}
function closeCodebase() { document.getElementById('codebase').hidden = true; if (cbGraph) cbGraph.pauseAnimation(); resumeMainGraph(); }
function showCbEmpty(msg) {
  const e = document.getElementById('cb-empty'); e.textContent = msg; e.hidden = false;
  document.getElementById('cb-meta').textContent = '';
  document.getElementById('cb-legend').innerHTML = '';
}
async function loadRepo(repoPath) {
  document.getElementById('cb-empty').hidden = true;
  document.getElementById('cb-meta').textContent = 'mapping…';
  let repo;
  try { repo = (await fetch('/api/repo?path=' + encodeURIComponent(repoPath)).then((r) => r.json())).repo || {}; }
  catch (err) { return showCbEmpty(String(err)); }
  if (repo.blocked) return showCbEmpty('outside the read sandbox');
  if (repo.missing || repo.notDir) return showCbEmpty('repo not found');
  if (!repo.nodes || !repo.nodes.length) return showCbEmpty('no files to map');
  document.getElementById('cb-meta').textContent =
    `${repo.fileCount} files · ${repo.edgeCount} imports${repo.truncated ? ' · truncated' : ''}`;
  const langs = [...new Set(repo.nodes.map((n) => n.lang))].sort();
  document.getElementById('cb-legend').innerHTML = langs
    .map((l) => `<span class="lg"><i style="background:${langColor(l)}"></i>${esc(l)}</span>`).join('');

  const host = document.getElementById('cb-graph');
  const maxDeg = Math.max(1, ...repo.nodes.map((n) => n.deg || 0));
  const nodes = repo.nodes.map((n) => ({ ...n, r: 3 + 7 * Math.sqrt((n.deg || 0) / maxDeg) }));
  const links = repo.links.map((l) => ({ source: l.source, target: l.target }));
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#ece6d8';

  if (!cbGraph) cbGraph = ForceGraph()(host);
  cbGraph.resumeAnimation();
  cbGraph
    .width(host.clientWidth).height(host.clientHeight)
    .backgroundColor('rgba(0,0,0,0)')
    .graphData({ nodes, links })
    .nodeRelSize(4).nodeVal((n) => n.r)
    .nodeLabel((n) => n.rel)
    .nodeColor((n) => langColor(n.lang))
    .nodeCanvasObjectMode(() => 'after')
    .nodeCanvasObject((n, ctx, scale) => {
      if (scale < 0.85 && (n.deg || 0) < 3 && n !== cbHover) return;       // declutter when zoomed out
      ctx.font = `${11 / scale}px ui-monospace, monospace`;
      ctx.fillStyle = ink; ctx.textBaseline = 'middle';
      ctx.globalAlpha = n === cbHover ? 1 : 0.75;
      ctx.fillText(n.name, n.x + n.r + 2 / scale, n.y);
      ctx.globalAlpha = 1;
    })
    .linkColor(() => 'rgba(150,140,124,0.22)').linkWidth(0.5)
    .onNodeHover((n) => { cbHover = n; host.style.cursor = n ? 'pointer' : ''; })
    .onNodeClick((n) => { if (n.path) openFile(n.path); })
    .cooldownTime(4000);
  cbGraph.zoomToFit(0, 50);
  setTimeout(() => cbGraph && cbGraph.zoomToFit(600, 50), 700);
}
document.getElementById('set-filter').onclick = (e) => {
  e.stopPropagation();
  const p = document.getElementById('filter-panel');
  p.hidden = !p.hidden;
  document.getElementById('set-filter').classList.toggle('on', !p.hidden);
};
// click outside closes the filter panel
document.addEventListener('click', (e) => {
  const p = document.getElementById('filter-panel');
  if (!p.hidden && !p.contains(e.target) && e.target.closest('#set-filter') == null) {
    p.hidden = true; document.getElementById('set-filter').classList.remove('on');
  }
});
document.getElementById('set-code').onclick = openCodebase;
document.getElementById('cb-x').onclick = closeCodebase;

// ── Code review surface (#34) ───────────────────────────────────────────────
// Open a code-graph'd repo, frozen at a git ref; comment on lines → Notes PART_OF
// a Review node (author='you'). Reuses /api/repo (tree), /api/file/version (frozen
// read), the file-reader's line rendering (rawLinesHtml), and /api/note.
let rvReview = null, rvFiles = [], rvComments = [], rvActive = null, rvFrozenLines = [];
let rvCollapsed = new Set();   // collapsed directory paths in the review tree
let rvChanges = new Map(), rvChangedOnly = true;   // rel → A|M|D|R status; "changed only" filter

function rvExtLang(rel) {
  const e = (String(rel).split('.').pop() || '').toLowerCase();
  return ({ js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'ts', jsx: 'js', py: 'py', go: 'go', md: 'markdown', json: 'json', css: 'css', html: 'html', cypher: 'cypher', sql: 'sql', yml: 'yaml', yaml: 'yaml' })[e] || e || 'file';
}
// File nodes to show when "Changed only" is on: every changed rel, using the code-graph
// node if present, else a synthetic node (so files outside the walked set still appear).
function changedFileNodes() {
  return [...rvChanges.keys()].map((rel) => rvFiles.find((x) => x.rel === rel) || { rel, path: rvReview.repo + '/' + rel, lang: rvExtLang(rel) });
}
// Fetch the changed-file set for the current base and refresh the tree; auto-open the
// first changed file so the reviewer lands on real work, not a random file.
// Populate the "vs <base>" dropdown with real refs so the user PICKS instead of typing
// git syntax: a parent default, a few range presets, branches (for a PR), recent commits.
async function populateBaseSelect() {
  const sel = document.getElementById('rv-base');
  let refs; try { refs = await fetch('/api/review/refs?repo=' + encodeURIComponent(rvReview.repo)).then((x) => x.json()); } catch (e) { refs = {}; }
  const ref = rvReview.git_ref;
  let html = '<option value="">Parent commit (last change)</option>' +
    `<optgroup label="Range"><option value="${esc(ref)}~3">3 commits back</option><option value="${esc(ref)}~5">5 commits back</option><option value="${esc(ref)}~10">10 commits back</option></optgroup>`;
  if (refs.branches && refs.branches.length) html += '<optgroup label="Branch (PR base)">' + refs.branches.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('') + '</optgroup>';
  if (refs.commits && refs.commits.length) html += '<optgroup label="Recent commits">' + refs.commits.map((c) => `<option value="${esc(c.sha)}">${esc(c.sha)} — ${esc(trunc(c.subject, 38))}</option>`).join('') + '</optgroup>';
  sel.innerHTML = html;
  sel.value = '';
}
async function loadReviewChanges() {
  const base = document.getElementById('rv-base').value.trim();
  const q = `repo=${encodeURIComponent(rvReview.repo)}&ref=${encodeURIComponent(rvReview.git_ref)}${base ? '&base=' + encodeURIComponent(base) : ''}`;
  let ch; try { ch = await fetch('/api/review/changes?' + q).then((x) => x.json()); } catch (e) { ch = { changes: [] }; }
  rvChanges = new Map((ch.changes || []).map((c) => [c.rel, c.status]));
  renderReviewTree();
  const firstRel = [...rvChanges.keys()].find((rel) => rvFiles.some((f) => f.rel === rel));
  const f = firstRel && rvFiles.find((x) => x.rel === firstRel);
  if (f) openReviewFile(f);
}
function rvShortRef() { return rvReview ? (rvReview.git_ref || '').slice(0, 7) : ''; }
function rvCommentsForFile(fp) { return rvComments.filter((c) => c.file_path === fp && c.anchor_kind === 'line'); }
// Create the Review node on demand (lazy creation): the first comment or verdict
// materializes it at repo@sha; until then it has id:null and nothing is persisted.
async function ensureReview() {
  if (rvReview && rvReview.id) return rvReview.id;
  try {
    const r = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo: rvReview.repo, gitRef: rvReview.git_ref }) }).then((x) => x.json());
    if (r.review && r.review.id) { rvReview.id = r.review.id; rvReview.created_at = r.review.created_at; rvReview.status = r.review.status; }
  } catch (e) { /* leave id null; caller handles */ }
  return rvReview.id;
}

async function openReview() {
  pauseMainGraph();
  document.getElementById('review').hidden = false;
  const sel = document.getElementById('rv-repo');
  if (!cbRepos) { try { cbRepos = (await fetch('/api/repos').then((r) => r.json())).repos || []; } catch { cbRepos = []; } }
  sel.innerHTML = cbRepos.map((r) => `<option value="${esc(r.path)}">${esc(r.name)}</option>`).join('');
  sel.onchange = () => startReview(sel.value);
  if (!cbRepos.length) { document.getElementById('rv-meta').textContent = 'no repos in the allowlist'; return; }
  const pref = cbRepos[0];
  sel.value = pref.path;
  startReview(pref.path);
}
function closeReview() { document.getElementById('review').hidden = true; if (rvGraph) rvGraph.pauseAnimation(); resumeMainGraph(); }

async function startReview(repoPath) {
  document.getElementById('rv-meta').textContent = 'opening…';
  document.getElementById('rv-tree').innerHTML = '';
  document.getElementById('rv-code').innerHTML = '<div class="rv-hint">Pick a file from the tree to review it.</div>';
  document.getElementById('rv-view-head').textContent = '';
  rvActive = null; rvCollapsed = new Set(); rvChanges = new Map();
  document.getElementById('rv-base').value = '';
  // Lazy creation (#34): RESOLVE the commit + load any existing review, but DON'T create
  // a node — opening to browse should never leave an empty Review. The node is created on
  // the first comment (ensureReview).
  let r;
  try { r = await fetch(`/api/review/resolve?repo=${encodeURIComponent(repoPath)}&gitRef=HEAD`).then((x) => x.json()); }
  catch (e) { document.getElementById('rv-meta').textContent = 'failed to open review'; return; }
  if (r.error) { document.getElementById('rv-meta').textContent = r.error; return; }
  rvReview = r.review;                              // id is null until the first comment
  document.getElementById('rv-ref').textContent = (rvReview.ref_label || 'HEAD') + ' · ' + rvShortRef();
  const repo = await fetch('/api/repo?path=' + encodeURIComponent(repoPath)).then((x) => x.json()).then((x) => x.repo || {});
  rvFiles = (repo.nodes || []).slice().sort((a, b) => (a.rel || '').localeCompare(b.rel || ''));
  rvComments = rvReview.comments || [];
  renderReviewSummary();
  renderReviewGraph();
  await populateBaseSelect();                        // refs dropdown for the diff base
  loadReviewChanges();                              // marks/filters changed files + opens the first one
}

// The live review graph (#34 make-or-break: real + click-through, not decorative):
// Review (center) → the files that carry comments → each comment (colored by state) →
// the Project (if linked). Clicking a comment opens its file + scrolls to the line;
// clicking a file opens it. Reflects live review state, never a static picture.
let rvGraph = null, rvGraphHover = null;
function relBasename(p) { const f = rvFiles.find((x) => x.path === p); return f ? f.rel : (p || '').split('/').pop(); }
function renderReviewGraph() {
  const host = document.getElementById('rv-graph');
  const wrap = document.querySelector('.rv-graph-wrap');
  let empty = wrap.querySelector('.rv-graph-empty');
  if (!rvComments.length) {
    if (rvGraph) { rvGraph.graphData({ nodes: [], links: [] }); }
    if (!empty) { empty = document.createElement('div'); empty.className = 'rv-graph-empty'; empty.textContent = 'Comment on a line — the review takes shape here.'; host.appendChild(empty); }
    return;
  }
  if (empty) empty.remove();
  const cssv = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  const ember = cssv('--accent', '#ef9a5b'), teal = cssv('--teal', '#5ad1c4'), faint = cssv('--ink-faint', '#7c7568');
  const stateColor = { raw: ember, cued: '#c9a98f', addressed: teal, skipped: faint };
  const nodes = [{ id: 'review', kind: 'review', label: rvShortRef(), color: ember, val: 10 }];
  const links = [];
  if (rvReview.project) { nodes.push({ id: 'project', kind: 'project', label: rvReview.project, color: cssv('--node-project', '#7aa2f7'), val: 7 }); links.push({ source: 'review', target: 'project' }); }
  const filesWith = [...new Set(rvComments.map((c) => c.file_path))];
  filesWith.forEach((fp) => { nodes.push({ id: 'file:' + fp, kind: 'file', path: fp, label: relBasename(fp).split('/').pop(), color: faint, val: 4 }); links.push({ source: 'review', target: 'file:' + fp }); });
  rvComments.forEach((c) => { nodes.push({ id: c.id, kind: 'comment', commentId: c.id, path: c.file_path, locator: c.locator, text: c.text, label: 'L' + (c.locator != null ? c.locator : '?'), color: stateColor[c.state] || ember, val: 3.5 }); links.push({ source: 'file:' + c.file_path, target: c.id }); });

  if (!rvGraph) rvGraph = ForceGraph()(host);
  rvGraph.resumeAnimation();
  rvGraph
    .width(host.clientWidth).height(host.clientHeight)
    .backgroundColor('rgba(0,0,0,0)')
    .graphData({ nodes, links })
    .nodeLabel((n) => n.kind === 'comment' ? `${esc(n.text || '')} (line ${n.locator})` : (n.kind === 'file' ? relBasename(n.path) : n.label))
    // Constellation-style glow nodes — same library AND look/physics as the main graph:
    // a soft radial halo + a readable label on EVERY node (review/project/file/comment).
    .nodeCanvasObjectMode(() => 'replace')
    .nodeCanvasObject((n, ctx, scale) => {
      const ink = cssv('--ink', '#ece6d8');
      const r = 1.8 + (n.val || 4) * 0.7;
      ctx.shadowColor = n.color; ctx.shadowBlur = (n === rvGraphHover ? r * 2.6 : r * 1.5);
      ctx.fillStyle = n.color; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = `${(n.kind === 'review' ? 11 : 9.5) / scale}px ui-monospace, monospace`;
      ctx.fillStyle = ink; ctx.textBaseline = 'middle';
      ctx.globalAlpha = (n.kind === 'review' || n.kind === 'project' || n === rvGraphHover) ? 1 : 0.72;
      ctx.fillText(n.label, n.x + r + 3 / scale, n.y);
      ctx.globalAlpha = 1;
    })
    .linkColor(() => 'rgba(150,140,124,0.28)').linkWidth(0.6)
    .linkDirectionalParticles(2).linkDirectionalParticleWidth(1.8)
    .linkDirectionalParticleColor(() => cssv('--accent', '#ef9a5b'))
    .onNodeHover((n) => { rvGraphHover = n; host.style.cursor = n && (n.kind === 'comment' || n.kind === 'file') ? 'pointer' : ''; })
    .onNodeClick((n) => {
      if (n.kind === 'file' || n.kind === 'comment') {
        const f = rvFiles.find((x) => x.path === n.path);
        if (f) openReviewFile(f).then(() => {
          if (n.kind === 'comment' && n.locator) {
            const line = document.querySelector(`#rv-code .fr-line[data-line="${n.locator}"]`);
            if (line) { line.scrollIntoView({ block: 'center' }); line.classList.add('rv-flash'); setTimeout(() => line.classList.remove('rv-flash'), 1200); }
          }
        });
      }
    })
    .warmupTicks(60).cooldownTime(6000);
  // Same force feel as the main constellation (charge/link/decay).
  rvGraph.d3Force('charge').strength(-90).distanceMax(400);
  rvGraph.d3Force('link').distance(40).strength(0.5);
  rvGraph.d3VelocityDecay(0.36);
  setTimeout(() => rvGraph && rvGraph.zoomToFit(500, 26), 400);
}

function renderReviewTree() {
  const byFile = {};
  rvComments.forEach((c) => { if (c.file_path) byFile[c.file_path] = (byFile[c.file_path] || 0) + 1; });
  const showChanged = rvChangedOnly && rvChanges.size > 0;
  const filesForTree = showChanged ? changedFileNodes() : rvFiles;
  const changedRels = [...rvChanges.keys()];
  document.getElementById('rv-meta').textContent = rvChanges.size
    ? `${rvChanges.size} changed${showChanged ? '' : ' / ' + rvFiles.length} · ${rvComments.length} comments`
    : `${rvFiles.length} files · ${rvComments.length} comments`;
  const rows = flattenTree(buildFileTree(filesForTree), rvCollapsed);
  document.getElementById('rv-tree').innerHTML = rows.map((r) => {
    const pad = `style="padding-left:${10 + r.depth * 13}px"`;
    if (r.type === 'dir') {
      const hasCh = changedRels.some((rel) => rel.startsWith(r.path + '/'));
      return `<div class="rv-dir${hasCh ? ' has-changes' : ''}" data-dir="${esc(r.path)}" ${pad}>` +
        `<span class="rv-chev">${r.collapsed ? '▸' : '▾'}</span>` +
        `<span class="rv-dn">${esc(r.name)}</span></div>`;
    }
    const n = byFile[r.path] || 0;
    const st = rvChanges.get(r.rel);
    return `<div class="rv-f${rvActive && rvActive.path === r.path ? ' on' : ''}${st ? ' changed' : ''}" data-path="${esc(r.path)}" ${pad} title="${esc(r.rel)}${st ? ' · ' + st : ''}">` +
      (st ? `<span class="rv-chg rv-chg-${esc(st)}">${esc(st)}</span>` : '<span class="rv-dot" style="background:' + langColor(r.lang) + '"></span>') +
      `<span class="rv-fn">${esc(r.name)}</span>` +
      (n ? `<span class="rv-badge">${n}</span>` : '') + '</div>';
  }).join('');
  const tree = document.getElementById('rv-tree');
  tree.querySelectorAll('.rv-dir').forEach((el) => {
    el.onclick = () => { const p = el.dataset.dir; rvCollapsed.has(p) ? rvCollapsed.delete(p) : rvCollapsed.add(p); renderReviewTree(); };
  });
  tree.querySelectorAll('.rv-f').forEach((el) => {
    el.onclick = () => openReviewFile(rvFiles.find((f) => f.path === el.dataset.path));
  });
}

async function openReviewFile(f) {
  if (!f || !rvReview) return;
  rvActive = f;
  renderReviewTree();
  const head = document.getElementById('rv-view-head');
  head.innerHTML = `<span class="rv-dot" style="background:${langColor(f.lang)}"></span> ${esc(f.rel)} <span style="color:var(--ink-faint)">· frozen @ ${esc(rvShortRef())}</span>`;
  const code = document.getElementById('rv-code');
  code.innerHTML = '<div class="rv-hint">loading…</div>';
  let v;
  try { v = await fetch(`/api/file/version?path=${encodeURIComponent(f.path)}&rev=${encodeURIComponent(rvReview.git_ref)}`).then((x) => x.json()); }
  catch (e) { code.innerHTML = '<div class="rv-hint">failed to read file</div>'; return; }
  if (v.error) { code.innerHTML = `<div class="rv-hint">${esc(v.error)}</div>`; return; }
  rvFrozenLines = String(v.text || '').split('\n');
  renderReviewCode();
}

// Render the ACTIVE file's frozen lines + its comments into #rv-code from the cached
// `rvFrozenLines` — NO network. Used by openReviewFile (after the fetch) AND by the note-add
// path, so adding a comment never re-fetches the whole file (the perf bug, #34).
function renderReviewCode() {
  const f = rvActive; if (!f) return;
  const isJsonFile = /\.jsonc?5?$/i.test(f.path || f.rel || '');
  const hlLang = isJsonFile ? 'json' : f.lang;
  const text = rvFrozenLines.join('\n');
  const depths = isJsonFile ? jsonDepths(text) : null;
  const hl = (s, i) => highlightCode(s, hlLang, esc, depths ? depths[i] : 0);
  document.getElementById('rv-code').innerHTML = rawLinesHtml(text, rvCommentsForFile(f.path), esc, hl);
}

// gutter click → inline comment input → POST a line Note PART_OF the review (author=you)
document.getElementById('rv-code').addEventListener('click', (e) => {
  const gut = e.target.closest('.fr-gut');
  if (gut) openReviewLineInput(gut.closest('.fr-line'));
});
function openReviewLineInput(lineEl) {
  if (!lineEl || !rvActive) return;
  const next = lineEl.nextElementSibling;
  if (next && next.classList.contains('fr-addrow')) { next.querySelector('textarea').focus(); return; }
  const ln = Number(lineEl.dataset.line);
  const snippet = rvFrozenLines[ln - 1] || '';
  const row = document.createElement('div');
  row.className = 'fr-addrow';
  row.innerHTML = `<textarea class="fr-add-tx" rows="2" placeholder="comment on line ${ln}… (⌘/Ctrl+Enter to save)" aria-label="review comment"></textarea>` +
    '<button class="fr-add-expand" title="open large editor" aria-label="open large editor">⤢</button>' +
    '<button class="fr-add-go">comment</button>';
  lineEl.after(row);
  const ta = row.querySelector('.fr-add-tx'); ta.focus();
  const submitText = async (text) => {
    text = String(text || '').trim(); if (!text) { row.remove(); return; }
    try {
      const reviewId = await ensureReview();                 // materialize the Review on first comment
      const res = await fetch('/api/note', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: rvActive.path, anchor_kind: 'line', locator: ln, snippet, text, author: 'you', reviewId }) }).then((x) => x.json());
      if (res.note) {
        rvComments = [...rvComments, { ...res.note, file_path: rvActive.path }];
        renderReviewCode();        // re-render the active file from CACHE (no /api/file/version refetch)
        renderReviewTree(); renderReviewSummary();
        requestAnimationFrame(() => renderReviewGraph());   // graph rebuild off the critical path
      } else row.remove();
    } catch (e) { row.remove(); }
  };
  row.querySelector('.fr-add-go').onclick = () => submitText(ta.value);
  row.querySelector('.fr-add-expand').onclick = () => { const draft = ta.value; row.remove(); openNoteModal({ title: `comment on ${rvActive.rel}:${ln}`, text: draft, onSubmit: submitText }); };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitText(ta.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); row.remove(); }   // contextual: cancel the comment, NOT the whole review
  });
}

function renderReviewSummary() {
  const counts = { raw: 0, cued: 0, addressed: 0, skipped: 0 };
  rvComments.forEach((c) => { if (counts[c.state] != null) counts[c.state]++; });
  const files = new Set(rvComments.map((c) => c.file_path)).size;
  const el = document.getElementById('rv-summary');
  el.innerHTML =
    '<div class="rv-s-title">Review summary</div>' +
    `<div style="font-size:11px;color:var(--ink-dim);margin-bottom:10px">${esc(rvReview ? rvReview.repo.split('/').pop() : '')} · ${esc(rvShortRef())}</div>` +
    '<div class="rv-counts">' +
      `<div class="rv-count new"><b>${counts.raw}</b><span>new</span></div>` +
      `<div class="rv-count"><b>${counts.cued}</b><span>cued</span></div>` +
      `<div class="rv-count done"><b>${counts.addressed}</b><span>done</span></div>` +
    '</div>' +
    `<div style="font-size:11px;color:var(--ink-faint);margin-bottom:12px">${rvComments.length} comments · ${files} files touched</div>` +
    '<div class="rv-verdict-l">Verdict</div>' +
    `<textarea class="rv-verdict" id="rv-verdict" placeholder="overall verdict…">${esc(rvReview && rvReview.verdict ? rvReview.verdict : '')}</textarea>` +
    '<button class="rv-verdict-save" id="rv-verdict-save">Save verdict</button>';
  document.getElementById('rv-verdict-save').onclick = async () => {
    const btn = document.getElementById('rv-verdict-save'); btn.disabled = true; btn.textContent = 'saving…';
    try {
      const v = document.getElementById('rv-verdict').value;
      const id = await ensureReview();                        // materialize the Review if saving a verdict first
      const res = await fetch('/api/review/verdict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, verdict: v }) }).then((x) => x.json());
      if (res.ok) { rvReview.verdict = res.review.verdict; btn.textContent = '✓ saved'; }
      else btn.textContent = 'failed';
    } catch (e) { btn.textContent = 'failed'; }
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Save verdict'; }, 1400);
  };
}

document.getElementById('set-review').onclick = openReview;
document.getElementById('rv-x').onclick = closeReview;
document.getElementById('rv-changed-toggle').onclick = () => {
  rvChangedOnly = !rvChangedOnly;
  document.getElementById('rv-changed-toggle').classList.toggle('on', rvChangedOnly);
  renderReviewTree();
};
document.getElementById('rv-base').addEventListener('change', () => { if (rvReview) loadReviewChanges(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.getElementById('review').hidden) return;
  // contextual: don't close the whole review if a comment input is open
  if (document.querySelector('#rv-code .fr-addrow')) return;
  closeReview();
});

// ── folder permissions: view/grant/revoke the read & map allowlist ───────────────
const PERMS = document.getElementById('perms');
function permsMsg(text, ok) { const m = document.getElementById('perms-msg'); m.textContent = text || ''; m.classList.toggle('ok', !!ok); }
async function loadPerms() {
  permsMsg('');
  let data; try { data = await fetch('/api/roots').then((r) => r.json()); } catch (e) { return permsMsg(String(e)); }
  const list = document.getElementById('perms-list');
  list.innerHTML = (data.roots || []).map((r) => `
    <div class="perms-row ${r.exists ? '' : 'gone'}">
      <span class="pr-dot" title="${r.exists ? 'available' : 'folder missing'}"></span>
      <span class="pr-main"><div class="pr-name">${esc(r.name)}</div><div class="pr-path">${esc(r.path)}</div>${(r.tags && r.tags.length) ? `<div class="pr-tags">${esc(r.tags.join(' · '))}</div>` : ''}</span>
      <button class="pr-revoke" data-path="${esc(r.path)}">revoke</button>
    </div>`).join('') || '<div class="dk-empty" style="padding:14px 0">no folders granted</div>';
  list.querySelectorAll('.pr-revoke').forEach((b) => { b.onclick = () => mutatePerms('remove', b.dataset.path); });
}
async function mutatePerms(action, p, tags) {
  permsMsg(action === 'add' ? 'granting…' : 'revoking…');
  let res; try { res = await fetch('/api/roots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, path: p, tags }) }).then((r) => r.json()); }
  catch (e) { return permsMsg(String(e)); }
  if (res.error) return permsMsg(res.error);
  permsMsg(action === 'add' ? 'granted ✓' : 'revoked ✓', true);
  document.getElementById('perms-path').value = ''; document.getElementById('perms-tags').value = '';
  cbRepos = null;                       // codebase repo list derives from roots — refresh next open
  loadPerms();
}
function openPerms() { PERMS.hidden = false; loadPerms(); }
function closePerms() { PERMS.hidden = true; }
// set-folders moved into Settings (declutter); openPerms is still reached via the
// Settings "manage" link. Guard in case the toolbar button is absent.
{ const b = document.getElementById('set-folders'); if (b) b.onclick = openPerms; }

// ── Settings pane (#27) — appearance prefs + READ-ONLY local system status ──
const SETTINGS = document.getElementById('settings');
function closeSettings() { SETTINGS.hidden = true; }
async function openSettings() {
  SETTINGS.hidden = false;
  renderSettings(null);                                   // paint prefs immediately
  try { renderSettings(await fetch('/api/status').then((r) => r.json())); } catch (e) { renderSettings({ error: true }); }
}
function fmtWhen(iso) {
  if (!iso) return 'never';
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 172800) return Math.round(s / 3600) + ' h ago';
  return d.toISOString().slice(0, 10);
}
function renderSettings(st) {
  const themes = THEME_ORDER.map((name) => {
    const sw = THEMES[name][curMode].accent;
    return `<button class="set-theme${name === curTheme ? ' on' : ''}" data-theme="${esc(name)}"><span class="sw" style="background:${sw}"></span>${esc(THEMES[name].label)}</button>`;
  }).join('');
  const sys = !st ? '<div class="set-row"><span class="set-k">loading…</span></div>'
    : st.error ? '<div class="set-row"><span class="set-k">status unavailable</span></div>'
    : `<div class="set-row"><span class="set-k">Neo4j</span><span class="set-v"><span class="set-dot ${st.neo4j.ok ? 'ok' : 'bad'}"></span>${st.neo4j.ok ? 'connected' : 'unreachable'} · ${esc(st.neo4j.uri)}</span></div>` +
      `<div class="set-row"><span class="set-k">Graph</span><span class="set-v">${st.counts.nodes} nodes · ${st.counts.edges} edges · ${st.counts.indexed} indexed</span></div>` +
      `<div class="set-row"><span class="set-k">Last backup</span><span class="set-v">${esc(fmtWhen(st.backup.lastModified))}</span></div>` +
      `<div class="set-row"><span class="set-k">Allowed folders</span><span class="set-v">${st.folders} · <a class="set-link" id="set-folders-link">manage</a></span></div>` +
      `<div class="set-row"><span class="set-k">Neo4j browser</span><span class="set-v"><a class="set-link" href="${esc(st.neo4j.browser)}" target="_blank" rel="noopener">open ↗</a></span></div>`;
  document.getElementById('set-body').innerHTML =
    '<div class="set-section"><div class="set-section-t">Appearance</div>' +
      `<div class="set-row"><span class="set-k">Theme</span></div><div class="set-themes">${themes}</div>` +
      `<div class="set-row"><span class="set-k">Mode</span><button class="set-toggle" id="set-mode-t">${curMode === 'light' ? '☀ Light' : '☾ Dark'}</button></div>` +
      `<div class="set-row"><span class="set-k">Calm mode <span style="color:var(--ink-faint)">· less motion</span></span><button class="set-toggle${calm ? ' on' : ''}" id="set-calm-t">${calm ? 'On' : 'Off'}</button></div>` +
      `<div class="set-row"><span class="set-k">Loading animation</span><span class="set-seg" id="set-anim">${['off', 'light', 'full'].map((l) => `<button class="set-seg-b${curAnim === l ? ' on' : ''}" data-anim="${l}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</span></div>` +
    '</div>' +
    '<div class="set-section"><div class="set-section-t">System · read-only</div>' + sys + '</div>';
  // wire
  document.querySelectorAll('#set-body .set-theme').forEach((b) => { b.onclick = () => { applyTheme(b.dataset.theme, curMode); renderSettings(st); }; });
  document.getElementById('set-mode-t').onclick = () => { applyTheme(curTheme, curMode === 'light' ? 'dark' : 'light'); renderSettings(st); };
  document.getElementById('set-calm-t').onclick = () => { setCalm(!calm); renderSettings(st); };
  document.querySelectorAll('#set-anim .set-seg-b').forEach((b) => { b.onclick = () => { applyAnim(b.dataset.anim); renderSettings(st); }; });
  const fl = document.getElementById('set-folders-link'); if (fl) fl.onclick = () => { closeSettings(); openPerms(); };
}
document.getElementById('set-settings').onclick = openSettings;
document.getElementById('settings-x').onclick = closeSettings;
SETTINGS.addEventListener('click', (e) => { if (e.target === SETTINGS) closeSettings(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !SETTINGS.hidden) closeSettings(); });

// Add-link intake (#19): save a web/YouTube link as a Resource, fuzzy-attach to a
// Project/Goal, refresh the constellation and focus the new node.
async function refreshGraphData(focusName) {
  try {
    const g = await fetch('/api/graph?limit=300').then((r) => r.json());
    if (g.nodes && g.nodes.length) {
      ingest(g);
      if (Graph) Graph.graphData({ nodes: NODES, links: LINKS });
      if (focusName) setTimeout(() => window.__focus && window.__focus(focusName), 450);
    }
  } catch (e) { /* ignore */ }
}
(function initAddLink() {
  const pop = document.getElementById('addlink-pop');
  if (!pop) return;
  const urlIn = document.getElementById('al-url'), attachIn = document.getElementById('al-attach');
  const menu = document.getElementById('al-attach-menu'), chips = document.getElementById('al-attach-chips');
  const msg = document.getElementById('al-msg'), sug = document.getElementById('al-suggest'), btn = document.getElementById('al-add');
  let lastLinkId = null;
  // #29 — live fuzzy-association typeahead on the "attach to…" field: query
  // /api/search as you type, pick ANY node by exact id (no blind fuzzy-on-submit).
  // Multi-select: a link can apply to several nodes, so picks accumulate as chips.
  // The "attach to…" field now reuses the shared createPicker() controller (#29 —
  // kills the duplicated typeahead+chips logic). `targets` is the picker's live array;
  // resetAttach/closeMenu delegate, so the submit + dismiss handlers below are unchanged.
  const picker = createPicker({ input: attachIn, menu, chips });
  const targets = picker.targets;
  const resetAttach = () => picker.reset();
  const closeMenu = () => picker.closeMenu();

  // Dismiss model: a SOFT dismiss (Esc, click-outside, toolbar toggle) just hides
  // the popover and KEEPS the in-progress capture (url + chips), so an interruption
  // doesn't lose work; only the × button HARD-discards. Either way the transient
  // post-save feedback (message + suggestion chips) is cleared — it's not "work".
  function clearFeedback() { sug.innerHTML = ''; msg.textContent = ''; }
  function openAddLink() { pop.hidden = false; clearFeedback(); urlIn.focus(); }   // restores preserved state
  function softCloseAddLink() { pop.hidden = true; closeMenu(); clearFeedback(); }  // preserve url + chips
  function hardCloseAddLink() { pop.hidden = true; closeMenu(); urlIn.value = ''; resetAttach(); clearFeedback(); }  // discard
  document.getElementById('set-addlink').onclick = () => { pop.hidden ? openAddLink() : softCloseAddLink(); };
  document.getElementById('al-x').onclick = hardCloseAddLink;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) softCloseAddLink(); });
  // Click outside the popover dismisses it (soft) — but ignore clicks on the toggle
  // (it owns its own open/close) and any click within the popover (incl. the dropdown).
  document.addEventListener('mousedown', (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || document.getElementById('set-addlink').contains(e.target)) return;
    softCloseAddLink();
  });
  const submit = async () => {
    const url = urlIn.value.trim(); if (!url) return;
    btn.disabled = true; msg.textContent = 'saving…';
    try {
      // Picked node(s) → attach each by exact id afterward (no fuzzy). None picked but
      // text typed → keep the legacy fuzzy attachTo string so a quick free-text associates.
      const attachTo = targets.length ? undefined : (attachIn.value.trim() || undefined);
      const res = await fetch('/api/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, attachTo }) });
      const j = await res.json();
      if (j.error) { msg.textContent = j.error; btn.disabled = false; return; }
      lastLinkId = j.node.id;
      const attachedNames = [];
      if (j.attached) attachedNames.push(j.attached.name);
      for (const t of targets) {
        await fetch('/api/link/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkId: lastLinkId, targetId: t.id }) });
        attachedNames.push(t.name);
      }
      const attachedTxt = attachedNames.length
        ? ` · attached to ${attachedNames.length > 2 ? attachedNames.slice(0, 2).join(', ') + ` +${attachedNames.length - 2} more` : attachedNames.join(', ')}`
        : '';
      msg.textContent = (j.kind === 'video' ? '🎬 ' : '🔗 ') + 'saved' + attachedTxt;
      urlIn.value = ''; resetAttach();
      refreshGraphData();
      // Open the inspector for the new link directly by id — robust even when the
      // low-degree node falls outside the loaded graph subset.
      selectNode({ id: j.node.id, name: j.node.title, label: 'Resource', url: j.node.url });
      sug.innerHTML = (j.suggestions || []).length
        ? '<span class="al-sug-l">attach to:</span>' + j.suggestions.map((s) => `<button class="al-chip" data-id="${esc(s.id)}">${esc(s.name)}</button>`).join('')
        : '';
      sug.querySelectorAll('.al-chip').forEach((c) => { c.onclick = async () => {
        await fetch('/api/link/attach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkId: lastLinkId, targetId: c.dataset.id }) });
        c.classList.add('on'); msg.textContent = 'attached to ' + c.textContent; refreshGraphData();
      }; });
    } catch (e) { msg.textContent = 'failed'; }
    btn.disabled = false;
  };
  btn.onclick = submit;
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
})();

// Reusable fuzzy multi-picker controller (#29): the typeahead+chips behavior shared
// by the add-link field and the inspector associate control, built on the tested
// pure lib (buildOptions/nextIndex/optionAt). Caller reads the live `targets` array.
// onPick: when supplied, a chosen option fires onPick(opt) immediately instead of
//   accumulating into chips — the per-field rows use this (pick → relate now).
// getExclude: extra ids to hide from results (a field's existing members), on top of
//   any accumulated chips.
// filterLabel: restrict results to one node label (a field only accepts its target
//   label — e.g. People shows only Person nodes, never a same-named Organization).
function createPicker({ input, menu, chips, onPick, getExclude, filterLabel }) {
  const targets = [];
  let options = [], active = -1, debounce = null;
  function closeMenu() { menu.hidden = true; menu.innerHTML = ''; options = []; active = -1; input.setAttribute('aria-expanded', 'false'); }
  function renderChips() {
    if (!chips) return;
    chips.hidden = targets.length === 0;
    chips.innerHTML = targets.map((t) => {
      const label = t.label ? ` <span class="al-opt-label">${esc(t.label)}</span>` : '';
      return `<span class="al-token"><span class="al-token-name">${esc(t.name)}</span>${label}<button class="al-token-x" data-id="${esc(t.id)}" title="remove" aria-label="remove ${esc(t.name)}">×</button></span>`;
    }).join('');
    chips.querySelectorAll('.al-token-x').forEach((b) => { b.onclick = () => { const i = targets.findIndex((t) => t.id === b.dataset.id); if (i >= 0) targets.splice(i, 1); renderChips(); }; });
  }
  function renderMenu() {
    if (!options.length) { menu.innerHTML = '<div class="al-menu-empty">no matches</div>'; }
    else {
      menu.innerHTML = options.map((o, i) => {
        const cls = 'al-opt' + (i === active ? ' active' : '') + (o.superseded ? ' al-opt-superseded' : '');
        const label = o.label ? `<span class="al-opt-label">${esc(o.label)}</span>` : '';
        return `<div class="${cls}" role="option" data-i="${i}"><span class="al-opt-name">${esc(o.name)}</span>${label}</div>`;
      }).join('');
      menu.querySelectorAll('.al-opt').forEach((el) => { el.onmousedown = (e) => { e.preventDefault(); pick(optionAt(options, +el.dataset.i)); }; });
    }
    menu.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function pick(opt) {
    if (!opt) return;
    if (onPick) { input.value = ''; closeMenu(); onPick(opt); input.focus(); return; }   // immediate-relate mode
    if (targets.some((t) => t.id === opt.id)) return;
    targets.push({ id: opt.id, name: opt.name, label: opt.label });
    renderChips(); input.value = ''; closeMenu(); input.focus();
  }
  async function search(q) {
    try {
      let { results } = await fetch('/api/search?q=' + encodeURIComponent(q)).then((r) => r.json());
      if (filterLabel) results = (results || []).filter((r) => r.label === filterLabel);
      const exclude = targets.map((t) => t.id).concat(getExclude ? getExclude() : []);
      options = buildOptions(results, q, { max: 8, exclude }); active = -1; renderMenu();
    } catch (e) { closeMenu(); }
  }
  input.addEventListener('input', () => { const q = input.value.trim(); clearTimeout(debounce); if (!q) { closeMenu(); return; } debounce = setTimeout(() => search(q), 140); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && targets.length) { targets.pop(); renderChips(); return; }
    if (menu.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = nextIndex(options.length, active, e.key === 'ArrowDown' ? 1 : -1); renderMenu(); }
    else if (e.key === 'Enter') { const opt = optionAt(options, active); if (opt) { e.preventDefault(); pick(opt); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  });
  input.addEventListener('blur', () => setTimeout(closeMenu, 120));
  return { targets, closeMenu, reset() { targets.length = 0; input.value = ''; renderChips(); closeMenu(); } };
}

// Inspector associate control (#29): relate the selected node to other existing
// nodes via the fuzzy multi-picker + a closed-vocab relationship type. Edge is
// (selected)-[:TYPE]->(target). Grows the graph by typing, no Cypher.
(function initAssociate() {
  const wrap = document.getElementById('i-associate');
  if (!wrap) return;
  const toggle = document.getElementById('i-assoc-toggle'), panel = document.getElementById('i-assoc-panel');
  const typeSel = document.getElementById('i-assoc-type'), fromEl = document.getElementById('i-assoc-from');
  const dirBtn = document.getElementById('i-assoc-dir');
  const input = document.getElementById('i-assoc-input'), menu = document.getElementById('i-assoc-menu'), chips = document.getElementById('i-assoc-chips');
  const addBtn = document.getElementById('i-assoc-add'), msg = document.getElementById('i-assoc-msg');
  const picker = createPicker({ input, menu, chips });
  let typesLoaded = false, boundId = null;   // the node the open panel is bound to
  let forward = true;                        // true: (this)-[:TYPE]->(picked); false: reversed
  function renderDir() { dirBtn.textContent = forward ? '→' : '←'; dirBtn.title = forward ? 'this node → picked (flip)' : 'picked → this node (flip)'; }
  dirBtn.onclick = () => { forward = !forward; renderDir(); };
  async function loadTypes() {
    if (typesLoaded) return; typesLoaded = true;
    try {
      const { types } = await fetch('/api/reltypes').then((r) => r.json());
      typeSel.innerHTML = (types || []).map((t) => `<option value="${esc(t)}"${t === 'ABOUT' ? ' selected' : ''}>${esc(t)}</option>`).join('');
    } catch (e) { typesLoaded = false; }
  }
  function collapse() { panel.hidden = true; picker.reset(); msg.textContent = ''; boundId = null; forward = true; renderDir(); }
  toggle.onclick = () => {
    if (panel.hidden) { loadTypes(); boundId = current && current.n.id; fromEl.textContent = (current && current.n.name ? current.n.name : 'this'); renderDir(); panel.hidden = false; input.focus(); }
    else collapse();
  };
  addBtn.onclick = async () => {
    if (!current) return;
    const type = typeSel.value, picks = picker.targets.slice();
    if (!picks.length) { msg.textContent = 'pick a node first'; return; }
    addBtn.disabled = true; msg.textContent = 'relating…';
    let ok = 0, lastErr = '';
    for (const t of picks) {
      // direction decides which end is the source: forward = (this)->(picked), reverse = (picked)->(this)
      const sourceId = forward ? current.n.id : t.id, targetId = forward ? t.id : current.n.id;
      try {
        const r = await fetch('/api/relate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId, targetId, type }) }).then((x) => x.json());
        if (r.ok) ok++; else lastErr = r.error || 'rejected';
      } catch (e) { lastErr = 'failed'; }
    }
    addBtn.disabled = false;
    msg.textContent = ok ? `✓ ${type} ${forward ? '→' : '←'} ${ok} node${ok > 1 ? 's' : ''}` + (lastErr ? ` · ${picks.length - ok} rejected` : '') : (lastErr || 'failed');
    if (ok) { picker.reset(); refreshGraphData(); const n = current.n; selectNode(n); }   // re-render inspector with the new edge(s)
  };
  // Collapse only when the inspector switches to a DIFFERENT node — so the post-relate
  // self-refresh (same node) keeps the panel + success message open.
  window.__onSelectNode = (id) => { if (!panel.hidden && id !== boundId) collapse(); };
})();

// ── Calendar lens (#25 P1): a read-only month view over the graph's record + intention
// dates — created_at activity heatmap, dots for valid_until expiries + Goal target dates.
// Click a day → its items; click an item → open it in the graph. A READ lens, no writes.
(function initCalendar() {
  const overlay = document.getElementById('calendar');
  if (!overlay) return;
  const gridEl = document.getElementById('cal-grid'), titleEl = document.getElementById('cal-title'), dayEl = document.getElementById('cal-day');
  const KIND_RANK = { due: 0, review: 1, target: 2, expiry: 3, created: 4 };
  const KIND_LABEL = { due: 'due', review: 'review', target: 'goal date', expiry: 'expires', created: 'created' };
  let cur = null, bucket = {}, maxHeat = 0, selectedDay = null;
  const pad = (n) => String(n).padStart(2, '0');
  const thisMonth = () => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  async function load() {
    const { from, to } = gridRange(cur.year, cur.month);
    let items = [];
    try { items = (await fetch(`/api/calendar?from=${from}&to=${to}`).then((r) => r.json())).items || []; } catch (e) { /* ignore */ }
    bucket = bucketByDay(items);
    maxHeat = Math.max(0, ...Object.values(bucket).map((a) => a.filter((x) => x.kind === 'created').length));
    render();
  }
  function render() {
    titleEl.textContent = monthLabel(cur.year, cur.month);
    const today = isoToday();
    gridEl.innerHTML = monthGrid(cur.year, cur.month).flat().map((cell) => {
      const items = bucket[cell.date] || [];
      const heat = heatIntensity(items.filter((x) => x.kind === 'created').length, maxHeat);
      const dots = ['due', 'review', 'target', 'expiry']
        .filter((k) => items.some((x) => x.kind === k))
        .map((k) => `<i class="cal-dot cal-dot-${k}"></i>`).join('');
      const cls = ['cal-cell', cell.inMonth ? '' : 'out', `heat-${heat}`, cell.date === today ? 'today' : '', cell.date === selectedDay ? 'sel' : '']
        .filter(Boolean).join(' ');
      return `<button class="${cls}" data-date="${cell.date}"><span class="cal-d">${cell.day}</span><span class="cal-dots">${dots}</span></button>`;
    }).join('');
  }
  function showDay(date) {
    selectedDay = date; render();
    const items = (bucket[date] || []).slice().sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || String(a.name || '').localeCompare(b.name || ''));
    if (!items.length) { dayEl.innerHTML = `<div class="cal-day-h">${esc(date)}</div><div class="cal-day-hint">nothing on this day</div>`; return; }
    dayEl.innerHTML = `<div class="cal-day-h">${esc(date)} · ${items.length}</div>` +
      items.map((it) => `<button class="cal-item" data-id="${esc(it.id)}" data-name="${esc(it.name || '')}" data-label="${esc(it.label || '')}">` +
        `<i class="rel-dot" style="background:${rgba(colorOf(it.label), 1)}"></i>` +
        `<span class="cal-item-n">${esc(it.name || '')}</span><span class="cal-item-k cal-k-${it.kind}">${KIND_LABEL[it.kind]}</span></button>`).join('');
  }
  function open() { pauseMainGraph(); overlay.hidden = false; cur = cur || thisMonth(); load(); }
  function close() { overlay.hidden = true; resumeMainGraph(); }

  gridEl.addEventListener('click', (e) => { const c = e.target.closest('[data-date]'); if (c) showDay(c.dataset.date); });
  dayEl.addEventListener('click', (e) => {
    const it = e.target.closest('.cal-item'); if (!it) return;
    close();
    // Open by id directly (selectNode fetches /api/node) — robust even for a low-degree
    // node outside the loaded graph subset, then nudge the graph toward it.
    selectNode({ id: it.dataset.id, name: it.dataset.name, label: it.dataset.label });
    refreshGraphData(it.dataset.name);
  });
  document.getElementById('cal-prev').onclick = () => { selectedDay = null; cur = stepMonth(cur.year, cur.month, -1); load(); };
  document.getElementById('cal-next').onclick = () => { selectedDay = null; cur = stepMonth(cur.year, cur.month, 1); load(); };
  document.getElementById('cal-today').onclick = () => { cur = thisMonth(); selectedDay = isoToday(); load().then(() => showDay(selectedDay)); };
  document.getElementById('cal-x').onclick = close;
  document.getElementById('set-calendar').onclick = () => (overlay.hidden ? open() : close());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
})();

// ── Roadmap / timeline lens (#28): the quarters × goals zoom. Project swimlanes, goal cards
// placed by target_date (exact) / timeframe (tentative) / unscheduled gutter, current-quarter
// highlight, status colors, click → open in the graph. A READ lens; no writes. ─────────────
(function initRoadmap() {
  const overlay = document.getElementById('roadmap');
  if (!overlay) return;
  const grid = document.getElementById('rm-grid');
  const pad = (n) => String(n).padStart(2, '0');
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  let loaded = false;

  function goalCard(g, place) {
    const st = classifyStatus(g.status);
    const date = g.target_date || g.due_at;
    const tag = place.precision === 'exact' && date ? dueLabel(date, Date.now())
      : place.precision === 'tentative' ? '~ ' + (g.timeframe || 'someday') : '';
    return `<button class="rm-card st-${st}${place.precision === 'tentative' ? ' tentative' : ''}" ` +
      `data-id="${esc(g.id)}" data-name="${esc(g.name)}" title="${esc(g.name)}${g.status ? ' · ' + esc(g.status) : ''}">` +
      `<span class="rm-card-n">${esc(g.name)}</span>${tag ? `<span class="rm-card-d">${esc(tag)}</span>` : ''}</button>`;
  }

  let data = [];
  function render() {
    const now = new Date(), nowISO = isoToday();
    const axis = quarterAxis(now.getFullYear(), now.getMonth() + 1, { fwd: 4 });
    const span = axis.length + 1;   // gutter + quarters (for the milestone sub-row)
    grid.style.gridTemplateColumns = `184px 128px repeat(${axis.length}, minmax(116px, 1fr))`;
    let html = '<div class="rm-corner"></div><div class="rm-colh">Unscheduled</div>' +
      axis.map((c) => `<div class="rm-colh${c.isCurrent ? ' cur' : ''}">${esc(c.label)}</div>`).join('');
    for (const p of data) {
      const pst = classifyStatus(p.project.status);
      const expanded = !secCollapsed('rmlane:' + p.project.id, true);
      const nMile = (p.milestones || []).length;
      html += `<div class="rm-lane" data-pid="${esc(p.project.id)}" role="button" title="${esc(p.project.name)} — click to ${expanded ? 'hide' : 'show'} milestones">` +
        `<i class="rm-caret${expanded ? ' open' : ''}">${nMile ? '›' : ''}</i>` +
        `<span class="rm-ldot st-${pst}"></span><span class="rm-ln">${esc(p.project.name)}</span>` +
        (nMile ? `<span class="rm-mcount">${nMile}</span>` : '') + `</div>`;
      const cells = { gutter: [] };
      axis.forEach((c) => { cells[c.key] = []; });
      for (const g of p.goals || []) {
        const place = placeItem(g, axis, nowISO);
        (place.colKey && cells[place.colKey] ? cells[place.colKey] : cells.gutter).push(goalCard(g, place));
      }
      html += `<div class="rm-cell rm-gut">${cells.gutter.join('')}</div>` +
        axis.map((c) => `<div class="rm-cell${c.isCurrent ? ' cur' : ''}">${cells[c.key].join('')}</div>`).join('');
      // expanded → a milestone sub-row spanning the data columns (ideas are mostly undated)
      if (expanded && nMile) {
        const pills = p.milestones.map((m) =>
          `<button class="rm-pill st-${classifyStatus(m.status)}" data-id="${esc(m.id)}" data-name="${esc(m.name)}" title="${esc(m.name)}${m.status ? ' · ' + esc(m.status) : ''}">${esc(m.name)}</button>`).join('');
        html += '<div class="rm-sublane">milestones</div>' +
          `<div class="rm-subcells" style="grid-column: span ${span}">${pills}</div>`;
      }
    }
    grid.innerHTML = data.length ? html : '<div class="cal-day-hint" style="padding:16px">No goals with a project yet.</div>';
  }
  async function load() {
    try { data = (await fetch('/api/roadmap').then((r) => r.json())).projects || []; } catch (e) { data = []; }
    render();
  }
  function open() { pauseMainGraph(); overlay.hidden = false; if (!loaded) { loaded = true; load(); } }
  function close() { overlay.hidden = true; resumeMainGraph(); }

  grid.addEventListener('click', (e) => {
    const open2 = (id, name, label) => { close(); selectNode({ id, name, label }); refreshGraphData(name); };
    const card = e.target.closest('.rm-card[data-id]');
    if (card) return open2(card.dataset.id, card.dataset.name, 'Goal');
    const pill = e.target.closest('.rm-pill[data-id]');
    if (pill) return open2(pill.dataset.id, pill.dataset.name, 'Idea');
    const lane = e.target.closest('.rm-lane[data-pid]');
    if (lane) { secToggle('rmlane:' + lane.dataset.pid, true); render(); }
  });
  document.getElementById('rm-x').onclick = close;
  document.getElementById('set-roadmap').onclick = () => (overlay.hidden ? open() : close());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
})();
document.getElementById('perms-x').onclick = closePerms;
document.getElementById('perms-grant').onclick = () => {
  const p = document.getElementById('perms-path').value.trim();
  const tags = document.getElementById('perms-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
  if (p) mutatePerms('add', p, tags);
};
document.getElementById('perms-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('perms-grant').click(); });
PERMS.addEventListener('click', (e) => { if (e.target === PERMS) closePerms(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !PERMS.hidden) closePerms(); });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.getElementById('codebase').hidden && FR.hidden) closeCodebase(); });
// Coordinated Escape for the graph's own surfaces — runs after the overlay/modal Esc handlers
// above (each guards on its own hidden state), so it only acts when no overlay is open and no
// text field is focused. Unwinds one layer: report → inspector (which also clears focus) → focus.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!FR.hidden || !document.getElementById('review').hidden || !SETTINGS.hidden
      || !PERMS.hidden || !document.getElementById('codebase').hidden) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  if (reportOpen) closeReport();
  else if (inspOpen) closeInsp();
  else if (focusId) clearFocus();
});
window.addEventListener('resize', () => { if (cbGraph && !document.getElementById('codebase').hidden) { const h = document.getElementById('cb-graph'); cbGraph.width(h.clientWidth).height(h.clientHeight); } });

// ── UI: health, lenses, search, time, zoom, dock, settings ───────────────────
function paintHealth(h) {
  document.getElementById('s-total').textContent = h.total;
  document.getElementById('s-index').textContent = h.indexed;
  document.getElementById('s-review').textContent = (h.orphans || 0) + (h.superseded || 0);
  healthData = h;
  renderResumeBrief();
}

// The "where were we" re-entry brief: a one-glance summary at the top of the dock, composed from
// data already on the client — /api/health (freshness + newest) + /api/pulse (live goals, due,
// open notes). No /api/resume endpoint: that would re-run queries pulse already issues. Renders
// progressively — health paints it on boot, pulse enriches the counts when it arrives.
function renderResumeBrief() {
  const h = healthData; if (!h) return;
  const el = document.getElementById('dock-resume-v'); if (!el) return;
  document.getElementById('dock-resume').hidden = false;
  const p = dockData;
  // Actionable stat chips (only when pulse has loaded): goals + undated, due, open notes.
  const stats = [];
  if (p) {
    const goals = p.goals || [];
    const undated = goals.filter((g) => !g.target_date).length;
    const due = (p.due || []).length;
    const notes = (p.review && p.review.notes ? p.review.notes.length : 0);
    if (goals.length) stats.push(`<span class="br-stat">🎯 ${goals.length} goal${goals.length !== 1 ? 's' : ''}${undated ? ` · ${undated} undated` : ''}</span>`);
    if (due) stats.push(`<span class="br-stat warn">⏰ ${due} due</span>`);
    if (notes) stats.push(`<span class="br-stat warn">🗒️ ${notes} note${notes !== 1 ? 's' : ''}</span>`);
  }
  const newest = h.newest
    ? `<div class="br-newest">Newest: <b>${esc(trunc(h.newest.name, 40))}</b>${h.newest.created_at ? ' · ' + h.newest.created_at.slice(0, 10) : ''}</div>`
    : '';
  // Stale-memory reminder (>24h since last full sync). A REMINDER, not a button — a full sync
  // (re-ingest docs, capture insights, lint, back up) is agent work; surfacing it is the honest move.
  let staleChip = '';
  const since = h.last_sync ? Math.round((Date.now() - Date.parse(String(h.last_sync))) / 36e5) : null;
  if (since != null && since > 24) {
    const ago = since >= 48 ? `${Math.round(since / 24)}d` : `${since}h`;
    staleChip = `<div class="dk-stale" title="Run the graph-sync skill to re-ingest docs, capture insights, lint, and back up">⚠️ Memory ${ago} stale — run <code>graph-sync</code></div>`;
  }
  el.innerHTML = (stats.length ? `<div class="br-stats">${stats.join('')}</div>` : '') + newest + staleChip;
}
const labelPlural = (d) => (d === 'Person' ? 'People' : d + 's');
// Repaint + sync both filter surfaces (left shortcut chips, right HUD panel) to state.
function applyFilter() {
  if (Graph) Graph.linkDirectionalParticles(particleCount);
  // left chips: All on when nothing filtered; Projects/Goals on when that's the sole type
  document.querySelectorAll('#lenses .chip').forEach((c) => {
    const k = c.dataset.lens;
    let on = false;
    if (k === 'all') on = !isFiltered();
    else if (k === 'stale') on = staleOnly;
    else on = activeTypes.size === 1 && activeTypes.has(k);
    c.classList.toggle('on', on);
  });
  // right panel checkboxes
  document.querySelectorAll('#filter-panel .ft-type').forEach((b) => b.classList.toggle('on', activeTypes.has(b.dataset.type)));
  const sb = document.getElementById('ft-stale'); if (sb) sb.classList.toggle('on', staleOnly);
  poke();
}
function buildLenses() {
  // Left dock = the two primary "what I work on" toggles + All + review. Everything else
  // (Sources, Insights, Ideas, …) lives in the HUD filter panel (the right menu).
  const present = ['Project', 'Goal'].filter((d) => domains.includes(d));
  const items = [['all', 'All'], ...present.map((d) => [d, labelPlural(d)]), ['stale', '⚠ Needs review']];
  const el = document.getElementById('lenses'); el.innerHTML = '';
  items.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = label; b.dataset.lens = k;
    b.onclick = () => {
      if (k === 'all') { activeTypes.clear(); staleOnly = false; }
      else if (k === 'stale') { staleOnly = !staleOnly; }       // toggle, keeps any type filter
      else {                                                     // Projects/Goals = single-focus shortcut (toggle)
        const sole = activeTypes.size === 1 && activeTypes.has(k);
        activeTypes.clear(); if (!sole) activeTypes.add(k);
      }
      applyFilter();
    };
    el.appendChild(b);
  });
  buildFilterPanel();
  applyFilter();
}
// The HUD filter panel: full multi-select over every node type present in the graph.
function buildFilterPanel() {
  const wrap = document.getElementById('filter-types'); if (!wrap) return;
  wrap.innerHTML = domains.map((d) =>
    `<button class="ft-type chip" data-type="${esc(d)}"><i class="ft-dot" style="background:${rgba(colorOf(d), 1)}"></i>${esc(labelPlural(d))}</button>`).join('');
  wrap.querySelectorAll('.ft-type').forEach((b) => {
    b.onclick = () => { const t = b.dataset.type; if (activeTypes.has(t)) activeTypes.delete(t); else activeTypes.add(t); applyFilter(); };
  });
  document.getElementById('ft-stale').onclick = () => { staleOnly = !staleOnly; applyFilter(); };
  document.getElementById('ft-clear').onclick = () => { activeTypes.clear(); staleOnly = false; applyFilter(); };
}
const qEl = document.getElementById('q');
const intentPanel = document.getElementById('intent-panel');
let qTimer = null;
qEl.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => handleQuery(qEl.value), 220); });
qEl.addEventListener('focus', () => { if (!qEl.value.trim()) showIntentHints(); });
// command-palette keyboard UX: ↑/↓ move, Enter opens the highlighted result, Esc closes
qEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideIntentPanel(); qEl.blur(); return; }
  const rows = intentPanel.hidden ? [] : ipRows();
  if (!rows.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActiveRow(ipActive + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveRow(ipActive - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); rows[ipActive >= 0 ? ipActive : 0].click(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) hideIntentPanel(); });
function hideIntentPanel() { intentPanel.hidden = true; intentPanel.innerHTML = ''; }

// Intent-based navigation: a recognized intent ("what's blocked / changed / due")
// resolves to a curated result set; anything else falls back to node search.
function handleQuery(raw) {
  const { kind } = parseIntent(raw);
  if (kind === 'search') { hideIntentPanel(); runSearch(raw); return; }
  searchHits = new Set(); document.getElementById('qcount').textContent = ''; poke();
  fetch('/api/intent?kind=' + encodeURIComponent(kind)).then((r) => r.json()).then(({ results }) => {
    renderIntentResults(kind, results || []);
  }).catch(() => hideIntentPanel());
}
// One result surface for both intents and plain search — a clickable list so a
// non-technical user (persona P4) never has to hunt the dimmed graph for a hit.
let ipActive = -1;                          // keyboard-highlighted result row
function ipRows() { return [...intentPanel.querySelectorAll('.ip-row')]; }
function setActiveRow(i) {
  const rows = ipRows(); if (!rows.length) return;
  ipActive = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle('active', k === ipActive));
  rows[ipActive].scrollIntoView({ block: 'nearest' });
}
function renderResultsPanel(headText, results, subOf) {
  const head = `<div class="ip-head">${esc(headText)}</div>`;
  if (!results.length) { intentPanel.innerHTML = head + '<div class="ip-empty">nothing here right now</div>'; intentPanel.hidden = false; ipActive = -1; return; }
  intentPanel.innerHTML = head + results.map((r) => {
    const sub = subOf ? subOf(r) : (r.sub || '');
    return `<button class="ip-row" data-id="${esc(r.id)}" data-name="${esc(r.name || '')}">` +
      `<span class="ip-dot" style="background:${rgba(colorOf(r.label), 1)}"></span>` +
      `<span class="ip-main"><span class="ip-name">${esc(trunc(r.name || '—', 46))}</span>` +
      `<span class="ip-sub">${esc(r.label)}${sub ? ' · ' + esc(sub) : ''}</span></span></button>`;
  }).join('');
  intentPanel.querySelectorAll('.ip-row').forEach((btn) => {
    btn.onclick = () => { selectByIdOrName(btn.dataset.id, btn.dataset.name); hideIntentPanel(); };
  });
  intentPanel.hidden = false;
  setActiveRow(0);                          // first result highlighted → Enter opens it
}
function renderIntentResults(kind, results) {
  const meta = INTENTS.find((i) => i.kind === kind);
  renderResultsPanel(`${meta ? meta.label : kind} · ${results.length}`, results, (r) => r.sub);
}
function showIntentHints() {
  intentPanel.innerHTML = '<div class="ip-head">try asking</div>' +
    INTENTS.map((i) => `<button class="ip-hint" data-q="${esc(i.label.toLowerCase())}">${esc(i.label)}</button>`).join('');
  intentPanel.querySelectorAll('.ip-hint').forEach((b) => { b.onclick = () => { qEl.value = b.dataset.q; handleQuery(b.dataset.q); }; });
  intentPanel.hidden = false;
}
function selectByIdOrName(id, name) {
  const n = (id && byId[id]) || NODES.find((x) => x.name === name);
  if (n) { selectNode(n); focusNode(n); }
  else if (id) { selectNode({ id, name }); refreshGraphData(name); }   // off-canvas → fetch by id
  else if (name) { focusByName(name); }
}
// Remove one association edge (#29) by its relationship id, then refresh the inspector
// (re-select the same node so the relations list reflects the prune) + the graph.
async function removeEdge(edgeId, name) {
  if (!edgeId || !current) return;
  if (!confirm(`Remove this relationship${name ? ` to “${name}”` : ''}?`)) return;
  try {
    const r = await fetch('/api/relate/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edgeId }) }).then((x) => x.json());
    if (r.error) { alert(r.error); return; }
    const n = current.n; refreshGraphData(); selectNode(n);
  } catch (e) { /* ignore */ }
}
function runSearch(q) {
  q = (q || '').trim(); qEl.value = q;
  if (!q) { searchHits = new Set(); document.getElementById('qcount').textContent = ''; hideIntentPanel(); poke(); return; }
  fetch('/api/search?q=' + encodeURIComponent(q)).then((r) => r.json()).then(({ results }) => {
    results = results || [];
    searchHits = new Set(results.map((r) => r.id));              // graph highlight
    document.getElementById('qcount').textContent = results.length ? `${results.length} found` : 'no matches';
    renderResultsPanel(`Matches for “${q}” · ${results.length}`, results, (r) => (r.superseded ? 'superseded' : ''));  // clickable list
    poke();
  }).catch(() => {});
}
const timeEl = document.getElementById('time');
timeEl.addEventListener('input', () => {
  tv = +timeEl.value;
  document.getElementById('time-date').textContent = tv >= 100 ? 'now' : new Date(selT()).toISOString().slice(0, 10);
  Graph && Graph.linkDirectionalParticles(particleCount); poke();
});
document.getElementById('tb-now').onclick = () => { timeEl.value = 100; tv = 100; document.getElementById('time-date').textContent = 'now'; poke(); };

document.getElementById('z-in').onclick = () => { Graph.zoom(Graph.zoom() * 1.3, 250); poke(); };
document.getElementById('z-out').onclick = () => { Graph.zoom(Graph.zoom() / 1.3, 250); poke(); };
document.getElementById('z-fit').onclick = () => { Graph.zoomToFit(500, 50); poke(); };

const graphEl = document.getElementById('graph');
graphEl.addEventListener('mousemove', (e) => { lastMx = e.clientX; lastMy = e.clientY; if (hover) positionTip(); if (calm) poke(); });

const TF = { '30_days': '30 days', short_term: 'Short term', '90_days': '90 days', '1_year': '1 year', long_term: 'Long term' };
document.getElementById('dock-toggle').onclick = () => { dockOpen = !dockOpen; layoutGraph(); poke(); };
// Keyboard activation for the dock's role=button rows + section headers (delegated once;
// #dock-scroll persists across re-renders). Enter/Space fires the element's click.
document.getElementById('dock-scroll').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.dk-item, .dk-h');
  if (el) { e.preventDefault(); el.click(); }
});
function loadDock() {
  const el = document.getElementById('dock-scroll');
  fetch('/api/pulse').then((r) => r.json()).then((p) => renderDock(p)).catch((e) => { el.innerHTML = '<div class="dk-empty">could not load: ' + esc(String(e)) + '</div>'; });
}
// Dock sections collapse/expand (persisted) + show-all for capped lists.
const DOCK_COLLAPSE_KEY = 'scatterbrained:dock:collapsed';
let dockCollapsed = new Set((() => { try { return JSON.parse(localStorage.getItem(DOCK_COLLAPSE_KEY) || '[]'); } catch { return []; } })());
const dockShowAll = new Set();
let dockData = null;
let healthData = null;   // stashed /api/health for the resume brief (composed with pulse, no new endpoint)
function dockSection(key, icon, title, count, bodyHtml) {
  const collapsed = dockCollapsed.has(key) ? ' collapsed' : '';
  const n = count != null ? ` <span class="dk-n">${count}</span>` : '';
  return `<div class="dk-grp sec-${key}${collapsed}" data-sec="${key}">` +
    `<div class="dk-h" role="button" tabindex="0"><i class="ti ti-${icon}" aria-hidden="true"></i> ${title}${n}<span class="dk-caret">▾</span></div>` +
    `<div class="dk-body">${bodyHtml}</div></div>`;
}
// Render up to `cap` item strings; the rest behind a show-all toggle (per-section).
function cappedItems(key, items, cap) {
  if (items.length <= cap) return items.join('');
  if (dockShowAll.has(key)) return items.join('') + `<button class="dk-more" data-sec="${key}">show less</button>`;
  return items.slice(0, cap).join('') + `<button class="dk-more" data-sec="${key}">show all (${items.length})</button>`;
}
function renderDock(p) {
  dockData = p;
  const J = (name) => `onclick="__focus(${JSON.stringify(name || '').replace(/"/g, '&quot;')})"`;
  const item = (name, meta, cls) => `<div class="dk-item ${cls || ''}" role="button" tabindex="0" ${J(name)}>${esc(trunc(name || '(unnamed)', 48))}${meta || ''}</div>`;
  const empty = (t) => `<div class="dk-empty">${t}</div>`;
  const groups = [];
  (p.goals || []).forEach((g) => { const k = TF[g.timeframe] || 'Ongoing'; let grp = groups.find((x) => x.k === k); if (!grp) { grp = { k, items: [] }; groups.push(grp); } grp.items.push(g); });
  // A goal row opens the GOAL (by id, off-canvas-safe) — not its project. Goal name is primary;
  // timeframe · delivering project · due date are secondary meta.
  const goalItems = groups.flatMap((grp) => grp.items.map((g) => {
    const proj = g.projects && g.projects[0] ? ' · ' + esc(trunc(g.projects[0], 22)) : '';
    // A goal with no target date never reaches the Due rail / digest — nudge to set one.
    // Clicking the row opens the goal's inspector, where the Schedule control lives.
    const due = g.target_date
      ? ' · ' + esc(dueLabel(g.target_date, Date.now()) || g.target_date)
      : ' · <span class="dk-nudge">⏳ set a date</span>';
    const open = `onclick="__open(${JSON.stringify(g.id || '').replace(/"/g, '&quot;')},${JSON.stringify(g.name || '').replace(/"/g, '&quot;')},'Goal')"`;
    return `<div class="dk-item" role="button" tabindex="0" ${open}>${esc(trunc(g.name || '(unnamed)', 48))}<div class="dk-meta">${esc(grp.k)}${proj}${due}</div></div>`;
  }));
  // Due / Overdue — the intention clock surfaced where the eye lands (QI_DUE: nodes whose
  // soonest due_at/review_at/target_date is overdue or within ~14d). Overdue rows go warn.
  const dueItems = (p.due || []).map((d) => {
    const overdue = /^overdue/.test(d.sub || '');
    const open = `onclick="__open(${JSON.stringify(d.id || '').replace(/"/g, '&quot;')},${JSON.stringify(d.name || '').replace(/"/g, '&quot;')},${JSON.stringify(d.label || '')})"`;
    return `<div class="dk-item ${overdue ? 'warn' : ''}" role="button" tabindex="0" ${open}>${esc(trunc(d.name || '(unnamed)', 48))}<div class="dk-meta">${esc(d.sub || '')}${d.label ? ' · ' + esc(d.label) : ''}</div></div>`;
  });
  const nowBody = `<span class="dk-pill"><span class="dot-now">●</span> ${(p.projects || []).length} now</span><span class="dk-pill"><span class="dot-next">●</span> ${(p.next || []).length} next</span>` +
    (p.blocked || []).map((b) => item(b.name, `<div class="dk-meta">blocked by ${esc(trunc(b.blocker, 22))}</div>`, 'warn')).join('');
  const newItems = (p.whatsNew || []).map((w) => item(w.name, `<div class="dk-meta">${w.created_at ? w.created_at.slice(0, 10) : ''}${(w.tags && w.tags.length) ? ' · ' + esc(w.tags[0]) : ''}</div>`));
  const rv = p.review || { superseded: [], lowConfidence: [], orphans: [], aliasDrift: [], protectedFacts: [], notes: [] };
  // Open Notes (raw/cued) first — they're explicit asks left for the next agent/session, the
  // most actionable thing in the queue. The row opens the note's anchor node (not the note).
  const noteRows = (rv.notes || []).map((nt) => {
    const open = `onclick="__open(${JSON.stringify(nt.anchor_id || '').replace(/"/g, '&quot;')},${JSON.stringify(nt.anchor_name || '').replace(/"/g, '&quot;')},${JSON.stringify(nt.anchor_label || '')})"`;
    return `<div class="dk-item warn" role="button" tabindex="0" ${open}><span class="dk-badge">note · ${esc(nt.state)}</span> ${esc(trunc(nt.anchor_name || '(unnamed)', 40))}<div class="dk-meta">“${esc(trunc(nt.text || '', 46))}”</div></div>`;
  });
  const reviewItems = [
    ...noteRows,
    ...(rv.protectedFacts || []).map((k) => item(k.target_name, `<span class="dk-badge">fact ${esc(k.pending_status)}</span><div class="dk-meta">“${esc(trunc(k.value, 24))}”${k.pending_new ? ' → “' + esc(trunc(k.pending_new, 18)) + '”' : ''}</div>`, 'warn')),
    ...(rv.aliasDrift || []).map((d) => item(d.name, `<span class="dk-badge">renamed · ${esc(d.label)}</span>${d.former_name ? `<div class="dk-meta">was “${esc(trunc(d.former_name, 28))}”</div>` : ''}`, 'warn')),
    ...rv.lowConfidence.map((r) => item(r.name, `<div class="dk-meta">${esc(r.confidence)} confidence</div>`, 'warn')),
    ...rv.superseded.map((s) => item(s.name, `<span class="dk-badge">${esc(s.label)}</span>`, 'warn')),
    ...rv.orphans.map((o) => item(o.name, `<span class="dk-badge">orphan · ${esc(o.label)}</span>`, 'warn')),
  ];
  document.getElementById('dock-scroll').innerHTML = [
    dockSection('goals', 'target', 'Goals', (p.goals || []).length, goalItems.length ? cappedItems('goals', goalItems, 8) : empty('No goals yet — define one to track it here')),
    dockSection('due', 'calendar-clock', 'Due / Overdue', dueItems.length, dueItems.length ? cappedItems('due', dueItems, 8) : empty('nothing due — set target dates on goals')),
    dockSection('now', 'flame', 'Now · Next · Blocked', null, nowBody),
    dockSection('new', 'sparkles', "What's new", (p.whatsNew || []).length, newItems.length ? cappedItems('new', newItems, 6) : empty('no insights')),
    dockSection('review', 'alert-triangle', 'Needs review', reviewItems.length, reviewItems.length ? cappedItems('review', reviewItems, 8) : empty('all clean')),
  ].join('');
  wireDock();
  renderResumeBrief();   // enrich the re-entry brief with pulse counts now that they've loaded
}
function wireDock() {
  document.querySelectorAll('#dock-scroll .dk-grp').forEach((grp) => {
    grp.querySelector('.dk-h').addEventListener('click', () => {
      const key = grp.dataset.sec;
      const collapsed = grp.classList.toggle('collapsed');
      if (collapsed) dockCollapsed.add(key); else dockCollapsed.delete(key);
      localStorage.setItem(DOCK_COLLAPSE_KEY, JSON.stringify([...dockCollapsed]));
    });
  });
  document.querySelectorAll('#dock-scroll .dk-more').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.dataset.sec;
      if (dockShowAll.has(k)) dockShowAll.delete(k); else dockShowAll.add(k);
      renderDock(dockData);
    });
  });
}

function fail(e) {
  const d = document.createElement('div'); d.className = 'err';
  d.innerHTML = `<div><b>Can't reach the graph.</b><br><br>${esc(e.message || String(e))}<br><br>Make sure your local Neo4j is running and the studio server is up:<br><code>docker compose up -d</code><br><code>npm run studio</code></div>`;
  document.body.appendChild(d);
  document.getElementById('boot').classList.add('gone');
}

// theme + calm moved into Settings (declutter); dark/light stays on the toolbar.
{ const b = document.getElementById('set-theme'); if (b) b.onclick = () => { const i = THEME_ORDER.indexOf(curTheme); applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length], curMode); }; }
document.getElementById('set-mode').onclick = () => applyTheme(curTheme, curMode === 'light' ? 'dark' : 'light');
{ const b = document.getElementById('set-calm'); if (b) b.onclick = () => setCalm(!calm); }
(function initSettings() {
  let st, sm, sc;
  try { st = localStorage.getItem('scatterbrained.theme'); sm = localStorage.getItem('scatterbrained.mode'); sc = localStorage.getItem('scatterbrained.calm'); } catch (e) {}
  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  applyTheme(st || 'observatory', sm || (mq('(prefers-color-scheme: light)') ? 'light' : 'dark'));
  calm = sc != null ? sc === '1' : mq('(prefers-reduced-motion: reduce)');
  document.body.classList.toggle('calm', calm);
  const cb = document.getElementById('set-calm'); if (cb) cb.classList.toggle('on', calm);   // moved into Settings; may be absent
  let sa; try { sa = localStorage.getItem('scatterbrained.anim'); } catch (e) {}
  applyAnim(sa || (mq('(prefers-reduced-motion: reduce)') ? 'off' : 'full'));
})();

boot();

// Detect a local model (M-E). When present, the ai-* components light up; otherwise
// the no-LLM keyFacts remains the "Understand" surface. Re-render an open node so
// the components appear without a reselect.
fetch('/api/ai/ping').then((r) => r.json()).then((p) => {
  caps.llm = !!p.available;
  document.body.classList.toggle('has-llm', caps.llm);
  if (caps.llm && current) rerenderActive();
}).catch(() => {});

// ── Guided tour (#14) — Northwind-style auto-play that drives the real Studio ──────
// Declarative steps live in /lib/tour.js; here we interpret each over the live app
// (every action try/caught so a missing demo node never breaks the walk). Stop button
// + #tour deep-link. Best over the demo graph (examples/seed-demo.cypher).
let _tourTimer = null, _tourOn = false;
function _tourAction(s) {
  try {
    if (s.escape) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if ('focus' in s) {
      if (s.focus === null) { const fc = document.getElementById('focus-clear'); if (fc) fc.click(); }
      else if (window.__focus) window.__focus(s.focus);
    }
    if (s.click) (Array.isArray(s.click) ? s.click : [s.click]).forEach((sel) => { const el = document.querySelector(sel); if (el) el.click(); });
    if (s.type != null) { const q = document.getElementById('q'); if (q) { q.value = s.type; q.dispatchEvent(new Event('input', { bubbles: true })); } }
    if (s.scrollTo) setTimeout(() => { const el = document.querySelector(s.scrollTo); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 400);
  } catch (e) {}
}
function _tourCap(html, i) {
  const c = document.getElementById('tour-cap'); if (!c) return;
  c.classList.remove('show');
  const dots = TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
  setTimeout(() => { c.innerHTML = `<span class="tour-text">${html}</span><span class="tour-dots">${dots}</span>`; c.classList.add('show'); }, 160);
}
function _tourStep(i) {
  if (!_tourOn) return;
  if (i >= TOUR.length) { setTimeout(stopTour, 1200); return; }
  _tourAction(TOUR[i]);
  _tourCap(TOUR[i].caption, i);
  _tourTimer = setTimeout(() => _tourStep(i + 1), TOUR[i].wait);
}
function startTour() {
  if (_tourOn) return;
  _tourOn = true;
  const b = document.getElementById('tour-btn'); if (b) b.textContent = '■ Stop';
  _tourStep(0);
}
function stopTour() {
  _tourOn = false;
  clearTimeout(_tourTimer);
  const b = document.getElementById('tour-btn'); if (b) b.textContent = '▶ Tour';
  const c = document.getElementById('tour-cap'); if (c) c.classList.remove('show');
}
window.__toggleTour = () => (_tourOn ? stopTour() : startTour());
{ const b = document.getElementById('tour-btn'); if (b) b.onclick = window.__toggleTour; }
if (location.hash === '#tour') setTimeout(startTour, 1400);   // deep-link auto-start (for the showcase)

// ── SSE: graph-changed banner ────────────────────────────────────────────────
(function initStaleBanner() {
  const banner = document.getElementById('stale-banner');
  const reloadBtn = document.getElementById('stale-reload');
  const dismissBtn = document.getElementById('stale-dismiss');
  if (!banner || !reloadBtn || !dismissBtn) return;

  reloadBtn.onclick = async () => {
    banner.hidden = true;
    await refreshGraphData();
  };
  dismissBtn.onclick = () => { banner.hidden = true; };

  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('graph-changed', () => { banner.hidden = false; });
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  }
  connect();
}());
