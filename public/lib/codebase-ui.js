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
//   prefRepo?: name of a repo to select first (omitted in the public build).
export function initCodebase({ esc, pauseMainGraph, resumeMainGraph, openFile, getRepos, prefRepo }) {
  let repo = null;     // { path, insights, links, byRel } of the loaded repo, for impact without re-fetch
  let focusToken = 0;  // guards the async call-site fetch against a rapid re-focus/back click
  let imp = null;      // current impact view: { rel, callers, imports, memberFilter, expand } — re-rendered in place

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
  function row(entry, right = '') {
    const p = entry.path || '', rel = entry.file;
    return `<div class="cb-row">`
      + `<i class="cb-dot" style="background:${langColor(entry.lang || 'other')}"></i>`
      + `<button class="cb-open" data-open="${esc(p)}" title="open ${esc(rel)}"${p ? '' : ' disabled'}><span class="cb-fn">${esc(rel)}</span></button>`
      + right
      + `<button class="cb-imp-btn" data-impact="${esc(rel)}" title="show what imports this and what it imports">⇄</button>`
      + `</div>`;
  }
  const chip = (f) => `<button class="cb-chip" data-open="${esc(f.path || '')}" title="${esc(f.file)}"${f.path ? '' : ' disabled'}>`
    + `<i class="cb-dot" style="background:${langColor(f.lang || 'other')}"></i>${esc(base(f.file))}</button>`;
  const section = (title, sub, inner) =>
    `<section class="cb-sec"><header class="cb-sec-h"><span class="cb-sec-t">${esc(title)}</span>`
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
      section('Hubs', 'read these first — most-connected files', hubsHtml)
      + section('Unreferenced code', 'nothing imports these — entry points or dead code', orphHtml)
      + section('Import cycles', 'files that import each other — refactor candidates', cycHtml);
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
        + `<button class="cb-imp-btn" data-impact="${esc(r)}" title="show this file's impact">⇄</button></div>`;
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
        + `<button class="cb-imp-btn" data-impact="${esc(c.file)}" title="show this file's impact">⇄</button></div>`
        + `<div class="cb-callsites">${chips}</div></div>`;
    };

    const head = `<div class="cb-focus-head">`
      + `<button class="cb-back" data-back title="back to overview">‹ Overview</button>`
      + `<i class="cb-dot" style="background:${langColor(node.lang || 'other')}"></i>`
      + `<span class="cb-focus-file" title="${esc(rel)}">${esc(rel)}</span>`
      + `<button class="cb-open cb-focus-open" data-open="${esc(node.path || '')}"${node.path ? '' : ' disabled'}>Open file →</button>`
      + `</div>`;
    const ripLine = importers.length
      ? `<p class="cb-focus-note">Changing this can ripple to <b>${ripple}</b> file${ripple === 1 ? '' : 's'} (transitively).</p>`
      : `<p class="cb-focus-note">Nothing imports this — it's an entry point or unused.</p>`;
    const shell = (diagramHtml, calledByHtml) => head + ripLine + diagramHtml
      + section('Called by', 'the functions in each dependent that call this file — the real blast radius', calledByHtml)
      + section('Imports', 'what this file depends on', listOr(imports, 'This file imports nothing in-repo.'));

    const el = document.getElementById('cb-insights');
    el.innerHTML = shell(`<div id="cb-diagram-box"><p class="cb-loading">building impact diagram…</p></div>`, importers.length ? `<p class="cb-loading">finding call sites…</p>` : `<p class="cb-none">Nothing imports this file.</p>`);
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
    if (L.memberFilter) bits.push(`filtered to <b>${esc(L.memberFilter)}</b> — click the member again to clear`);
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
    document.getElementById('cb-meta').textContent =
      `${r.fileCount} files · ${r.edgeCount} imports${r.truncated ? ' · truncated' : ''}`;
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
