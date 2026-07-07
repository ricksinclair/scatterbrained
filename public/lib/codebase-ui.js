// codebase-ui.js — the Code lens "Map" tab: a repo's RANKED structural insights (hubs to
// read first · unreferenced code · import cycles), NOT a force-graph hairball — plus a
// per-file IMPACT view (what breaks if you change it · what it pulls in) drawn as our own
// UML-style impact diagram (impact-uml.js + impact-svg.js, no vendored graph lib).
//
// TRANSFORM verdict (branch code-map-verdict, 2026-07, superseding the PO "keep the
// force-graph" line): a full force-graph of every file answered no question a person actually
// has. The useful CORE is a ranked LIST (repoInsights, served on /api/repo.insights); the
// useful DIAGRAM is a bounded, directional ego graph, not a whole-repo blob. Same data feeds
// the agent brief, so what a human sees here is what a launched agent gets. The repo <select>
// stays SHARED with the Review tab (cache + reset in app.js via getRepos).
import { langColor } from './lang-colors.js';
import { emptyState } from './empty-state.js';
import { importsOf, importedBy, blastRadius } from './impact.js';
import { impactLayout } from './impact-uml.js';
import { renderImpactSvg } from './impact-svg.js';

const base = (rel) => (rel && rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel) || '';

// deps: { esc, pauseMainGraph, resumeMainGraph, openFile, getRepos, prefRepo? }
export function initCodebase({ esc, pauseMainGraph, resumeMainGraph, openFile, getRepos, prefRepo }) {
  let repo = null;     // { path, insights, links, byRel } of the loaded repo, for impact without re-fetch
  let focusToken = 0;  // guards the async call-site fetch against a rapid re-focus/back click
  let imp = null;      // current impact view: { rel, callers, imports, memberFilter, expand } — re-rendered in place
  let renderedAt = 0;  // when the current map/impact was computed — a long-lived tab must not show week-old line numbers as if live

  function showEmpty(title, body, action) {
    const e = document.getElementById('cb-empty');
    e.innerHTML = emptyState({ title, body, action }); e.hidden = false;
    document.getElementById('cb-insights').innerHTML = '';
    document.getElementById('cb-meta').textContent = '';
    document.getElementById('cb-legend').innerHTML = '';
  }

  async function open() {
    pauseMainGraph();
    document.getElementById('code-map-body').hidden = false;
    // The repo <select> is SHARED with the review tab (C4): keep whatever repo the user
    // already picked there, so switching tabs never resets the selection.
    const sel = document.getElementById('cl-repo');
    const prev = sel.value;
    const repos = await getRepos();
    sel.innerHTML = repos.map((r) => `<option value="${esc(r.path)}">${esc(r.name)}</option>`).join('');
    sel.onchange = () => loadRepo(sel.value);
    if (!repos.length) { showEmpty('No folders to map yet.', 'Grant a folder and its structure ranks here.', { label: 'Manage folders', cmd: 'manage-folders' }); return; }
    const pref = (prev && repos.find((r) => r.path === prev))
      || (prefRepo && repos.find((r) => r.name === prefRepo)) || repos[0];
    sel.value = pref.path;
    loadRepo(pref.path);
  }

  function close() {
    document.getElementById('code-map-body').hidden = true;
    resumeMainGraph();
  }

  // ── overview: the ranked lists ─────────────────────────────────────────────
  // A file row: lang dot · path (opens the file) · [degree badge] · ⇄ (opens impact).
  // The impact drill-in affordance — a LABELED button (not a bare glyph), so "what does this
  // arrow do?" answers itself. Used on every file row across the overview + impact views.
  const impactBtn = (rel, title = 'show what imports this file and what it imports') =>
    `<button class="cb-imp-btn" data-impact="${esc(rel)}" title="${esc(title)}"><span class="cb-imp-ico" aria-hidden="true">⇄</span> impact</button>`;
  function row(entry, right = '') {
    const p = entry.path || '', rel = entry.file;
    return `<div class="cb-row">`
      + `<i class="cb-dot" style="background:${langColor(entry.lang || 'other')}"></i>`
      + `<button class="cb-open" data-open="${esc(p)}" title="open ${esc(rel)}"${p ? '' : ' disabled'}><span class="cb-fn">${esc(rel)}</span></button>`
      + right
      + impactBtn(rel)
      + `</div>`;
  }
  const chip = (f) => `<button class="cb-chip" data-open="${esc(f.path || '')}" title="${esc(f.file)}"${f.path ? '' : ' disabled'}>`
    + `<i class="cb-dot" style="background:${langColor(f.lang || 'other')}"></i>${esc(base(f.file))}</button>`;
  // A section header carries an optional COUNT pill so the three lists read at a glance.
  const section = (title, sub, inner, count = null) =>
    `<section class="cb-sec"><header class="cb-sec-h"><span class="cb-sec-t">${esc(title)}</span>`
    + (count != null ? `<span class="cb-sec-n">${count}</span>` : '')
    + `<span class="cb-sec-sub">${esc(sub)}</span></header>${inner}</section>`;

  function renderOverview() {
    const { hubs = [], unreferenced = [], cycles = [] } = repo.insights || {};
    const hubsHtml = `<div class="cb-list">${hubs.map((h) =>
      row(h, `<span class="cb-deg" title="${h.degree} connections">${h.degree}</span>`)).join('')}</div>`;
    const orphHtml = unreferenced.length
      ? `<div class="cb-list">${unreferenced.map((u) => row(u)).join('')}</div>`
      : `<p class="cb-none">None — every module is imported somewhere.</p>`;
    const cycHtml = cycles.length
      ? cycles.map((c) => `<div class="cb-cycle">`
          + c.map(chip).join('<span class="cb-arrow" aria-hidden="true">→</span>')
          + `<span class="cb-arrow" title="loops back" aria-hidden="true">↩</span></div>`).join('')
      : `<p class="cb-none">None — no import cycles.</p>`;
    document.getElementById('cb-insights').innerHTML =
      section('Hubs', 'read these first — most-connected files', hubsHtml, hubs.length)
      + section('Unreferenced code', 'nothing imports these — entry points or dead code', orphHtml, unreferenced.length)
      + section('Import cycles', 'files that import each other — refactor candidates', cycHtml, cycles.length);
  }

  // ── impact: one file's dependents/dependencies, and — the point — a UML-style diagram:
  // the focus is an anchored class box whose compartment is its USED API surface (the members
  // callers actually touch, from /api/repo/callsites), with method-level edges from each caller
  // function to the member it calls, and the focus's own imports flowing out the right side.
  // The complete lists below stay the exhaustive reference; the diagram is the insight.
  async function focusImpact(rel) {
    const node = repo.byRel.get(rel);
    if (!node) return;
    const myToken = ++focusToken;
    const imports = importsOf(repo.links, rel).sort();          // what it needs
    const importers = importedBy(repo.links, rel);               // what breaks if you change it
    const ripple = blastRadius(repo.links, rel).length;          // transitive dependents
    imp = null;

    const fileRow = (r) => {
      const n = repo.byRel.get(r) || {};
      return `<div class="cb-row">`
        + `<i class="cb-dot" style="background:${langColor(n.lang || 'other')}"></i>`
        + `<button class="cb-open" data-open="${esc(n.path || '')}" title="open ${esc(r)}"${n.path ? '' : ' disabled'}><span class="cb-fn">${esc(r)}</span></button>`
        + impactBtn(r, "show this file's impact") + `</div>`;
    };
    const listOr = (arr, empty) => arr.length ? `<div class="cb-list">${arr.slice().sort().map(fileRow).join('')}</div>` : `<p class="cb-none">${esc(empty)}</p>`;

    // Each dependent + the functions that call this file (data-open jumps to the file@line).
    const callerRow = (c) => {
      const n = repo.byRel.get(c.file) || {};
      const chips = c.sites.length
        ? c.sites.map((s) => {
          const label = s.fn || '(module scope)';
          const line = s.lines[0];
          return `<button class="cb-cs" data-open="${esc(n.path || '')}" data-line="${line}" title="${esc(label)} · line ${s.lines.join(', ')}">`
            + `${esc(label)}<span class="cb-cs-ln">${line}${s.lines.length > 1 ? '+' : ''}</span></button>`;
        }).join('')
        : `<span class="cb-cs-none">${c.symbols.length ? 'imported as a type — no direct calls found' : 'side-effect import'}</span>`;
      return `<div class="cb-imp-file"><div class="cb-row">`
        + `<i class="cb-dot" style="background:${langColor(n.lang || 'other')}"></i>`
        + `<button class="cb-open" data-open="${esc(n.path || '')}" title="open ${esc(c.file)}"${n.path ? '' : ' disabled'}><span class="cb-fn">${esc(c.file)}</span></button>`
        + impactBtn(c.file, "show this file's impact") + `</div>`
        + `<div class="cb-callsites">${chips}</div></div>`;
    };

    // A breadcrumb, not a lone ‹ Overview: "Map overview ▸ <file>" says where you are AND how to
    // get back in one affordance ("Map overview" is the data-back target).
    const head = `<div class="cb-focus-head">`
      + `<nav class="cb-crumb" aria-label="breadcrumb">`
      + `<button class="cb-crumb-back" data-back title="back to the ranked map">Map overview</button>`
      + `<span class="cb-crumb-sep" aria-hidden="true">▸</span>`
      + `<i class="cb-dot" style="background:${langColor(node.lang || 'other')}"></i>`
      + `<b class="cb-crumb-here" title="${esc(rel)}">${esc(rel)}</b></nav>`
      + `<button class="cb-open cb-focus-open" data-open="${esc(node.path || '')}"${node.path ? '' : ' disabled'}>Open file →</button>`
      + `</div>`;
    const ripLine = importers.length
      ? `<p class="cb-focus-note">Changing this can ripple to <b>${ripple}</b> file${ripple === 1 ? '' : 's'} (transitively).</p>`
      : `<p class="cb-focus-note">Nothing imports this — it's an entry point or unused.</p>`;
    const shell = (diagramHtml, calledByHtml) => head + ripLine + diagramHtml
      + section('Called by', 'the functions in each dependent that call this file — the real blast radius', calledByHtml)
      + section('Imports', 'what this file depends on', listOr(imports, 'This file imports nothing in-repo.'));

    // Named, bounded loading state: say WHAT is happening and HOW MUCH (skeleton rows), not a bare
    // "finding call sites…" that reads as a hang on a slow read.
    const skeleton = (nfiles) => `<p class="cb-loading">reading ${nfiles} dependent file${nfiles === 1 ? '' : 's'} for their call sites…</p>`
      + `<div class="cb-skeleton" aria-hidden="true">${Array.from({ length: Math.min(nfiles, 4) }, () => '<div class="cb-skel-row"></div>').join('')}</div>`;
    const el = document.getElementById('cb-insights');
    el.innerHTML = shell(`<div id="cb-diagram-box"><p class="cb-loading">building impact diagram…</p></div>`, importers.length ? skeleton(importers.length) : `<p class="cb-none">Nothing imports this file.</p>`);
    el.scrollTop = 0;
    if (!importers.length) {
      imp = { rel, callers: [], imports, memberFilter: null, expand: false };
      return void refreshDiagram();
    }

    // Fetch the call sites (server reads each dependent). Guard against a rapid re-focus.
    let callers = null;
    try { callers = (await fetch(`/api/repo/callsites?repo=${encodeURIComponent(repo.path)}&file=${encodeURIComponent(rel)}`).then((x) => x.json())).callers; }
    catch { /* fall back to plain file list below */ }
    if (myToken !== focusToken) return;                        // user moved on — drop this result
    const calledByHtml = callers && callers.length
      ? `<div class="cb-callers">${callers.map(callerRow).join('')}</div>`
      : listOr(importers, 'Nothing imports this file.');       // fallback: plain dependents list
    document.getElementById('cb-insights').innerHTML = shell(`<div id="cb-diagram-box"></div>`, calledByHtml);
    imp = { rel, callers: callers || [], imports, memberFilter: null, expand: false };
    renderedAt = Date.now();
    refreshDiagram();
  }

  // Re-render just the diagram (filter / expand clicks) — the fetched call sites are kept.
  function refreshDiagram() {
    const box = document.getElementById('cb-diagram-box');
    if (!box || !imp) return;
    const node = repo.byRel.get(imp.rel) || {};
    const withCalls = imp.callers.filter((c) => (c.sites || []).length);
    if (!withCalls.length && !imp.imports.length) {
      box.innerHTML = `<p class="cb-none">${imp.callers.length ? 'Imported, but no direct call sites detected (dynamic/aliased use, or a type-only import).' : 'Nothing imports this and it imports nothing — an isolated file.'}</p>`;
      return;
    }
    const lang = (r) => (repo.byRel.get(r) || {}).lang;
    const L = impactLayout({
      focus: { id: imp.rel, lang: node.lang },
      callers: withCalls.map((c) => ({ ...c, lang: lang(c.file) })),
      dependencies: imp.imports.map((r) => ({ id: r, lang: lang(r) })),
      memberFilter: imp.memberFilter, expand: imp.expand,
    });
    const bits = [];
    // Active filter → a VISIBLE clear chip (not a buried "click the member again" note).
    if (L.memberFilter) bits.push(`<button class="cb-filter-chip" data-clear-member title="clear the member filter">filtered: ${esc(L.memberFilter)} <span class="cb-filter-x" aria-hidden="true">✕</span></button>`);
    else if (L.members.length > 1) bits.push('click a member in the focus box to filter its callers');
    if (L.hiddenCallers) bits.push(`${L.hiddenCallers} caller${L.hiddenCallers === 1 ? '' : 's'} collapsed — full list below`);
    box.innerHTML = `<div class="cb-diagram">${renderImpactSvg(L, { esc })}</div>`
      + (bits.length ? `<p class="cb-diagram-note">${bits.join(' · ')}</p>` : '');
  }

  async function loadRepo(repoPath) {
    document.getElementById('cb-empty').hidden = true;
    document.getElementById('cb-meta').textContent = 'mapping…';
    let r;
    try { r = (await fetch('/api/repo?path=' + encodeURIComponent(repoPath)).then((x) => x.json())).repo || {}; }
    catch (err) { return showEmpty('Couldn’t map this repo.', String(err)); }
    if (r.blocked) return showEmpty('Outside the read sandbox.', 'This folder isn’t in the allowlist.', { label: 'Manage folders', cmd: 'manage-folders' });
    if (r.missing || r.notDir) return showEmpty('Repo not found.', 'The folder moved or was deleted — grant its new home.', { label: 'Manage folders', cmd: 'manage-folders' });
    if (!r.fileCount) return showEmpty('No files to map.', 'Nothing importable found in this folder.');
    repo = { path: repoPath, insights: r.insights || {}, links: r.links || [], byRel: new Map((r.nodes || []).map((n) => [n.rel, n])) };
    renderedAt = Date.now();
    // The "as of" stamp: line numbers are live-computed from disk, so an old rendering in a
    // long-lived tab must be legible AS old (observed 2026-07-07: a June map's "api 518"
    // read as a tracing bug once the file had grown 500 lines).
    document.getElementById('cb-meta').textContent =
      `${r.fileCount} files · ${r.edgeCount} imports${r.truncated ? ' · truncated' : ''} · mapped ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const langs = r.insights ? Object.entries(r.insights.languages).sort((a, b) => b[1] - a[1]) : [];
    document.getElementById('cb-legend').innerHTML = langs
      .map(([l, n]) => `<span class="lg"><i style="background:${langColor(l)}"></i>${esc(l)} ${n}</span>`).join('');
    renderOverview();
  }

  // One delegated click. Order matters: `data-open` wins first so a diagram node's METHOD row
  // (data-open, nested inside the node's data-rel) opens the file — at its call line — rather
  // than drilling; a focus MEMBER row (data-member) toggles the member filter; the collapse
  // ghost (data-expand) shows every caller; a node HEADER (only data-rel) drills into that
  // file's impact; data-back returns to the overview.
  const host = document.getElementById('cb-insights');
  if (host) host.addEventListener('click', (e) => {
    const back = e.target.closest('[data-back]');
    if (back) return void renderOverview();
    const clearM = e.target.closest('[data-clear-member]');
    if (clearM && imp) { imp.memberFilter = null; return void refreshDiagram(); }
    const openBtn = e.target.closest('[data-open]');
    if (openBtn && openBtn.dataset.open) return void openFile(openBtn.dataset.open, Number(openBtn.dataset.line) || null);
    const member = e.target.closest('.dag-member[data-member]');
    if (member && imp) {
      imp.memberFilter = imp.memberFilter === member.dataset.member ? null : member.dataset.member;
      return void refreshDiagram();
    }
    const expand = e.target.closest('[data-expand]');
    if (expand && imp) { imp.expand = true; return void refreshDiagram(); }
    const impact = e.target.closest('[data-impact], .dag-node[data-rel]');
    if (impact) focusImpact(impact.dataset.impact || impact.dataset.rel);
  });
  // Stale-tab self-heal: the map is a LIVE computation rendered once — a tab left open for
  // days keeps painting week-old line numbers with no tell (the "api 518" incident,
  // 2026-07-07: a June rendering read as an engine bug against a file that had since grown
  // 500 lines). When the user comes back to a map older than STALE_MS, recompute the exact
  // view they're on instead of asking them to notice.
  const STALE_MS = 10 * 60 * 1000;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !renderedAt) return;
    const body = document.getElementById('code-map-body');
    if (!body || body.hidden) return;
    if (Date.now() - renderedAt < STALE_MS) return;
    if (imp && imp.rel) focusImpact(imp.rel);
    else { const sel = document.getElementById('cl-repo'); if (sel && sel.value) loadRepo(sel.value); }
  });

  // Hover a method row → its edges light up; hover a member row → every edge into it lights up.
  // Pure class toggling on the already-rendered SVG (data-key / data-member carry the linkage).
  if (host) {
    const clear = () => host.querySelectorAll('.dag-edge.hl').forEach((p) => p.classList.remove('hl'));
    host.addEventListener('mouseover', (e) => {
      const t = e.target.closest('.dag-method[data-key], .dag-member[data-member]');
      if (!t) return;
      clear();
      const sel = t.dataset.key ? `.dag-edge[data-key="${CSS.escape(t.dataset.key)}"]` : `.dag-edge[data-member="${CSS.escape(t.dataset.member)}"]`;
      host.querySelectorAll(sel).forEach((p) => p.classList.add('hl'));
    });
    host.addEventListener('mouseout', (e) => {
      if (e.target.closest('.dag-method, .dag-member')) clear();
    });
  }

  return { open, close };
}
