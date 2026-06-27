// codebase-ui.js — the codebase-map dev lens: a repo's module/import graph in its own canvas.
// Extracted from app.js (app.js modularization, app#split). Self-contained surface controller;
// `initCodebase(deps)` wires it to the page with the few app.js refs it needs. ForceGraph is the
// global vendored lib. Repos are shared with the review surface, so the cache lives in app.js and
// is read through deps.getRepos (keeps the folder-permissions "refresh repos next open" reset working).
import { langColor } from './lang-colors.js';

// deps: { esc, pauseMainGraph, resumeMainGraph, openFile, getRepos, prefRepo? }
//   getRepos(): Promise<[{path,name}]> — shared, cached + reset by app.js.
//   prefRepo?: name of a repo to select first (omitted in the public build).
//   returns { open, close } so app.js can drive it (e.g. Esc-to-close the codebase view).
export function initCodebase({ esc, pauseMainGraph, resumeMainGraph, openFile, getRepos, prefRepo }) {
  let cbGraph = null, cbHover = null;

  function showEmpty(msg) {
    const e = document.getElementById('cb-empty'); e.textContent = msg; e.hidden = false;
    document.getElementById('cb-meta').textContent = '';
    document.getElementById('cb-legend').innerHTML = '';
  }

  async function open() {
    pauseMainGraph();
    document.getElementById('codebase').hidden = false;
    const sel = document.getElementById('cb-repo');
    const repos = await getRepos();
    sel.innerHTML = repos.map((r) => `<option value="${esc(r.path)}">${esc(r.name)}</option>`).join('');
    sel.onchange = () => loadRepo(sel.value);
    if (!repos.length) { showEmpty('no mappable repos in the allowlist'); return; }
    const pref = (prefRepo && repos.find((r) => r.name === prefRepo)) || repos[0];
    sel.value = pref.path;
    loadRepo(pref.path);
  }

  function close() {
    document.getElementById('codebase').hidden = true;
    if (cbGraph) cbGraph.pauseAnimation();
    resumeMainGraph();
  }

  async function loadRepo(repoPath) {
    document.getElementById('cb-empty').hidden = true;
    document.getElementById('cb-meta').textContent = 'mapping…';
    let repo;
    try { repo = (await fetch('/api/repo?path=' + encodeURIComponent(repoPath)).then((r) => r.json())).repo || {}; }
    catch (err) { return showEmpty(String(err)); }
    if (repo.blocked) return showEmpty('outside the read sandbox');
    if (repo.missing || repo.notDir) return showEmpty('repo not found');
    if (!repo.nodes || !repo.nodes.length) return showEmpty('no files to map');
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

  document.getElementById('set-code').onclick = open;
  document.getElementById('cb-x').onclick = close;
  // keep the codebase canvas sized to its container while it's open
  window.addEventListener('resize', () => {
    if (cbGraph && !document.getElementById('codebase').hidden) {
      const h = document.getElementById('cb-graph'); cbGraph.width(h.clientWidth).height(h.clientHeight);
    }
  });
  return { open, close };
}
