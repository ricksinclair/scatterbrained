// review-ui.js — code-review surface (#34): open a code-graph'd repo frozen at a git ref,
// comment on lines → Notes PART_OF a Review node, with a live review constellation.
// Extracted from app.js (app.js modularization). Repos are shared with the codebase + perms
// surfaces, so the cache lives in app.js and is read via deps.getRepos (keeps the
// folder-permissions "refresh repos next open" reset working). ForceGraph is the vendored global.
// deps: { esc, trunc, pauseMainGraph, resumeMainGraph, openNoteModal, getRepos, prefRepo? }
//   prefRepo: name of a repo to select first (omitted in the public build).
// returns { openReview } — the one cross-surface entry (app.js #i-expand opens a Review node here).
import { langColor } from './lang-colors.js';
import { highlightCode, jsonDepths } from './codehl.js';
import { buildFileTree, flattenTree } from './filetree.js';
import { rawLinesHtml } from './docnotes.js';

export function initReview({ esc, trunc, pauseMainGraph, resumeMainGraph, openNoteModal, getRepos, prefRepo }) {
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

  async function openReview(target) {
    pauseMainGraph();
    document.getElementById('review').hidden = false;
    const sel = document.getElementById('rv-repo');
    const repos = await getRepos();              // shared cache, owned by app.js (codebase + perms)
    sel.innerHTML = repos.map((r) => `<option value="${esc(r.path)}">${esc(r.name)}</option>`).join('');
    sel.onchange = () => startReview(sel.value);
    // Expanding a specific Review node: open it at its frozen repo@git_ref so its existing
    // comments load (resolve returns the persisted review), instead of the default HEAD browse.
    if (target && target.repo) {
      if (repos.some((r) => r.path === target.repo)) sel.value = target.repo;
      startReview(target.repo, target.gitRef || 'HEAD');
      return;
    }
    if (!repos.length) { document.getElementById('rv-meta').textContent = 'no repos in the allowlist'; return; }
    const pref = (prefRepo && repos.find((r) => r.name === prefRepo)) || repos[0];
    sel.value = pref.path;
    startReview(pref.path);
  }
  function closeReview() { document.getElementById('review').hidden = true; if (rvGraph) rvGraph.pauseAnimation(); resumeMainGraph(); }

  async function startReview(repoPath, gitRef = 'HEAD') {
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
    try { r = await fetch(`/api/review/resolve?repo=${encodeURIComponent(repoPath)}&gitRef=${encodeURIComponent(gitRef)}`).then((x) => x.json()); }
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

  document.getElementById('set-review').onclick = () => openReview();   // wrap: no click Event leaks in as target
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

  return { openReview };
}
