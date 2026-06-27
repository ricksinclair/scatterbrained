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
import { initTour } from '/lib/tour-ui.js';
import { initStaleBanner } from '/lib/stale-banner-ui.js';
import { initReview } from '/lib/review-ui.js';
import { initFileReader } from '/lib/file-reader-ui.js';

// Resurface snooze state is browser-local (UI state, not canonical knowledge).
const snoozeKey = (id) => 'scatterbrained:snooze:' + id;
const getSnooze = (id) => +localStorage.getItem(snoozeKey(id)) || 0;
const setSnooze = (id, until) => (until ? localStorage.setItem(snoozeKey(id), String(until)) : localStorage.removeItem(snoozeKey(id)));
import { parseIntent, INTENTS } from '/lib/intent.js';
import { buildOptions, nextIndex, optionAt } from '/lib/typeahead.js';
import { fieldRowsFor, membersForField, relateArgs } from '/lib/fields.js';
import { initCalendar, initRoadmap } from '/lib/time-lenses.js';
import { isCollapsed as isColRaw, toggleCollapsed as togColRaw } from '/lib/collapse.js';
import { KIND_META } from '/lib/schedule.js';
import { initCodebase } from '/lib/codebase-ui.js';
import { langColor } from '/lib/lang-colors.js';
import { initSettings } from '/lib/settings-ui.js';
import { initPerms } from '/lib/perms-ui.js';
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
  renderReportGraph();
}

// Live 1-hop relations map in the report (the same vendored force-graph as the constellation, not a
// static SVG): the node + its non-source/non-annotation neighbors, clickable + prunable. #rel-live is
// re-created on every renderReport (r-components is re-innerHTML'd), so rebuild the instance each time.
let reportGraph = null, reportGraphHover = null;
function teardownReportGraph() { if (reportGraph) { reportGraph.pauseAnimation(); reportGraph = null; } }
function renderReportGraph() {
  teardownReportGraph();
  const host = document.getElementById('rel-live');
  if (!host || !current) return;
  const n = current.n;
  const ANN = ['Note', 'ProtectedFact', 'Review'];
  const rel = ((current.data && current.data.edges) || []).filter((e) => !(e.label === 'Source' && e.dir === 'in') && !ANN.includes(e.label));
  const cssv = (v, d) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || d;
  const nodes = [{ id: n.id, center: true, label: trunc(n.name || '', 20), color: rgba(colorOf(n.label), 1), val: 9 }];
  const links = []; const seen = new Set([n.id]);
  rel.slice(0, 40).forEach((e) => {
    if (!e.id || seen.has(e.id)) return; seen.add(e.id);
    nodes.push({ id: e.id, label: trunc(e.name || '', 16), name: e.name, type: e.type, color: rgba(colorOf(e.label), 1), val: 4 });
    links.push(e.dir === 'in' ? { source: e.id, target: n.id } : { source: n.id, target: e.id });
  });
  reportGraph = ForceGraph()(host);
  reportGraph.width(host.clientWidth).height(host.clientHeight).backgroundColor('rgba(0,0,0,0)')
    .graphData({ nodes, links })
    .nodeLabel((d) => esc(d.center ? (d.label || '') : `${d.type || ''} · ${d.name || ''}`))
    .nodeCanvasObjectMode(() => 'replace')
    .nodeCanvasObject((d, ctx, scale) => {
      const ink = cssv('--ink', '#ece6d8');
      const r = 1.8 + (d.val || 4) * 0.7;
      ctx.shadowColor = d.color; ctx.shadowBlur = (d === reportGraphHover ? r * 2.6 : r * 1.5);
      ctx.fillStyle = d.color; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      if (d.center) { ctx.strokeStyle = cssv('--accent', '#ef9a5b'); ctx.lineWidth = 1.5 / scale; ctx.beginPath(); ctx.arc(d.x, d.y, r + 3 / scale, 0, 7); ctx.stroke(); }
      ctx.font = `${(d.center ? 11 : 9.5) / scale}px ui-monospace, monospace`;
      ctx.fillStyle = ink; ctx.textBaseline = 'middle';
      ctx.globalAlpha = (d.center || d === reportGraphHover) ? 1 : 0.74;
      ctx.fillText(d.label, d.x + r + 3 / scale, d.y);
      ctx.globalAlpha = 1;
    })
    .linkColor(() => 'rgba(150,140,124,0.28)').linkWidth(0.6)
    .linkDirectionalParticles(1).linkDirectionalParticleWidth(1.6).linkDirectionalParticleColor(() => cssv('--accent', '#ef9a5b'))
    .onNodeHover((d) => { reportGraphHover = d; host.style.cursor = d && !d.center ? 'pointer' : ''; })
    .onNodeClick((d) => { if (d && !d.center) selectByIdOrName(d.id, d.name); })
    .warmupTicks(60).cooldownTime(5000);
  reportGraph.d3Force('charge').strength(-90).distanceMax(400);
  reportGraph.d3Force('link').distance(46).strength(0.5);
  reportGraph.d3VelocityDecay(0.36);
  setTimeout(() => reportGraph && reportGraph.zoomToFit(500, 30), 400);
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
  teardownReportGraph();
  document.getElementById('report').hidden = true;
  if (current) { inspOpen = true; document.getElementById('insp').hidden = false; renderInspector(); }
  layoutGraph();
  poke();
}
function closeReport() { reportOpen = false; studyMode = false; teardownReportGraph(); document.getElementById('report').hidden = true; sel = null; layoutGraph(); clearFocus(); poke(); }

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
// Type-aware expand: a Review opens the code-review viewer at its frozen repo@git_ref (so its
// line-comment Notes load); every other node type expands to the report slide-over.
document.getElementById('i-expand').onclick = () => {
  const s = current && current.signals;
  if (s && s.label === 'Review' && s.props && s.props.repo) reviewUi.openReview({ repo: s.props.repo, gitRef: s.props.git_ref });
  else openReport();
};
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

// ── file reader → lib/file-reader-ui.js (deps esc+trunc; openFile/openNoteModal/postNote come back) ──
const fr = initFileReader({ esc, trunc });
const { openFile, openNoteModal, postNote } = fr;

// ── inspector note + protected-fact handlers (window.__*) — drive the inspector/report panels ──
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
// Repo list cache — shared by the codebase-map + code-review surfaces; reset by the folder-
// permissions pane so the next open refetches. getRepos() lazily fills it.
let cbRepos = null;
async function getRepos() {
  if (!cbRepos) { try { cbRepos = (await fetch('/api/repos').then((r) => r.json())).repos || []; } catch { cbRepos = []; } }
  return cbRepos;
}
const cbUi = initCodebase({ esc, pauseMainGraph, resumeMainGraph, openFile, getRepos });

// ── Code review surface (#34) → lib/review-ui.js (repos shared via getRepos, like the codebase map) ──
const reviewUi = initReview({ esc, trunc, pauseMainGraph, resumeMainGraph, openNoteModal, getRepos });

// ── folder permissions pane → lib/perms-ui.js (grant/revoke resets the shared repo cache) ──
const perms = initPerms({ esc, onRootsChanged: () => { cbRepos = null; } });


initSettings({
  esc, THEMES, THEME_ORDER, applyTheme, applyAnim, setCalm, openPerms: perms.open,
  getTheme: () => ({ curTheme, curMode, calm, curAnim }),
});

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
        const was = o.former ? `<span class="al-opt-was">was ${esc(o.former)}</span>` : '';
        return `<div class="${cls}" role="option" data-i="${i}"><span class="al-opt-name">${esc(o.name)}</span>${label}${was}</div>`;
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

// Temporal read-lenses (Activity heatmap + Roadmap), extracted to lib/time-lenses.js.
initCalendar({ esc, rgba, colorOf, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData });
initRoadmap({ esc, secCollapsed, secToggle, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData });

window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.getElementById('codebase').hidden && !fr.isOpen()) cbUi.close(); });
// Coordinated Escape for the graph's own surfaces — runs after the overlay/modal Esc handlers
// above (each guards on its own hidden state), so it only acts when no overlay is open and no
// text field is focused. Unwinds one layer: report → inspector (which also clears focus) → focus.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (fr.isOpen() || !document.getElementById('review').hidden || !document.getElementById('settings').hidden
      || !document.getElementById('perms').hidden || !document.getElementById('codebase').hidden) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  if (reportOpen) closeReport();
  else if (inspOpen) closeInsp();
  else if (focusId) clearFocus();
});

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
  renderLensList();
  poke();
}
// Lens results list (#32): the active lens's matching nodes as a flat clickable picker in the
// dock — click a row to open it instead of hunting on the canvas. Reuses lensActive() so it
// always matches exactly what the graph dims to. Hidden when no lens is active ("All").
function renderLensList() {
  const el = document.getElementById('lens-list');
  if (!el) return;
  if (!isFiltered()) { el.hidden = true; el.innerHTML = ''; return; }
  const matches = NODES.filter((n) => lensActive(n) && n.name)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const single = activeTypes.size === 1 ? [...activeTypes][0] : null;
  const title = single ? labelPlural(single) : (staleOnly && !activeTypes.size ? 'Needs review' : 'Filtered');
  const cap = 50, shown = matches.slice(0, cap);
  el.innerHTML = `<div class="ll-head">${esc(title)}<span class="ll-n">${matches.length}</span></div>` +
    shown.map((n) => `<button class="ll-row" data-id="${esc(n.id)}" data-name="${esc(n.name)}" title="${esc(n.name)}">` +
      `<span class="ll-dot" style="background:${rgba(colorOf(n.label), 1)}"></span>` +
      `<span class="ll-name">${esc(trunc(n.name, 34))}</span>` +
      (n.stale ? '<span class="ll-stale" title="needs review">⚠</span>' : '') + '</button>').join('') +
    (matches.length > cap ? `<div class="ll-more">+${matches.length - cap} more on the graph</div>` : '');
  el.querySelectorAll('.ll-row').forEach((b) => { b.onclick = () => selectByIdOrName(b.dataset.id, b.dataset.name); });
  el.hidden = false;
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
    renderResultsPanel(`Matches for “${q}” · ${results.length}`, results, (r) => {
      // "was <old name>" when this result surfaced because the query matched its former_name
      // (and not the current name) — explains an otherwise-puzzling alias match.
      const ql = q.toLowerCase(), nm = (r.name || '').toLowerCase();
      const sub = [];
      if (r.former_name && r.former_name.toLowerCase().includes(ql) && !nm.includes(ql)) sub.push('was ' + r.former_name);
      if (r.superseded) sub.push('superseded');
      return sub.join(' · ');
    });  // clickable list

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

// ── Guided tour (#14) → lib/tour-ui.js (self-contained: reads window.__focus, drives the DOM) ──
initTour();

// ── SSE: graph-changed banner → lib/stale-banner-ui.js ──
initStaleBanner({ refreshGraphData });
