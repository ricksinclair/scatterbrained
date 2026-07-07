// docs-ui.js — the Docs lens (Stage 6b of the PlantUML/docs integration): a per-project
// doc SITE over the markdown the document lane already ingested. Sidebar = the standard
// taxonomy tree from /api/docs (docsite.js), reading pane = docmd.js (vendored marked +
// codehl + sanitizer), right column = scroll-spy TOC. PlantUML fences hydrate into
// live-themed SVGs via /api/diagram/render (6c). The non-Notion reading lane.
//
// initDocsLens(deps) → { open, close } — the time-lenses.js lens-module shape.
// deps: { esc, openPerms? } — openPerms opens the folder-permissions panel for
// blocked (outside-granted-roots) docs.
import { renderDoc } from './docmd.js';

const LS_PROJECT = 'scatterbrained.docs.project';

export function initDocsLens({ esc, openPerms } = {}) {
  const lens = document.getElementById('docslens');
  const nav = document.getElementById('docs-nav');
  const body = document.getElementById('docs-body');
  const tocEl = document.getElementById('docs-toc');
  const projSel = document.getElementById('docs-project');
  let tree = null, currentDoc = null, isOpen = false;

  const lsGet = () => { try { return localStorage.getItem(LS_PROJECT); } catch { return null; } };
  const lsSet = (v) => { try { localStorage.setItem(LS_PROJECT, v); } catch {} };

  async function open() {
    if (isOpen) return;
    isOpen = true;
    lens.hidden = false;
    if (!projSel.options.length) await loadProjects();
    if (projSel.value && !tree) await loadProject(projSel.value);
  }
  function close() {
    isOpen = false;
    lens.hidden = true;
  }

  async function loadProjects() {
    let projects = [];
    try { projects = (await fetch('/api/docs').then((r) => r.json())).projects || []; } catch {}
    projSel.innerHTML = projects.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} (${p.doc_count})</option>`).join('');
    const saved = lsGet();
    if (saved && projects.some((p) => p.name === saved)) projSel.value = saved;
  }

  async function loadProject(name) {
    lsSet(name);
    tree = null; currentDoc = null;
    nav.innerHTML = '<div class="docs-loading">loading…</div>';
    body.innerHTML = ''; tocEl.innerHTML = '';
    try { tree = (await fetch('/api/docs?project=' + encodeURIComponent(name)).then((r) => r.json())).tree; }
    catch { nav.innerHTML = '<div class="docs-empty">could not load the doc tree</div>'; return; }
    renderNav();
    // land on the first doc (Overview when it exists — taxonomy order guarantees it's first)
    const first = nav.querySelector('.docs-item:not(.blocked)');
    if (first) openDoc(first.dataset.path, first.dataset.title);
    else body.innerHTML = '<div class="docs-empty">no readable docs — grant access to this project\'s folder</div>';
  }

  function itemHtml(d) {
    return `<button class="docs-item${d.readable ? '' : ' blocked'}" data-path="${esc(d.file_path || '')}" data-title="${esc(d.title)}" title="${esc(d.title)}">` +
      `${esc(d.display_title)}${d.readable ? '' : ' <span class="docs-lock" title="outside the granted read roots">🔒</span>'}</button>`;
  }
  function renderNav() {
    let html = '';
    for (const aud of tree.audiences) {
      html += `<div class="docs-aud">${esc(aud.label)}</div>`;
      for (const sec of aud.sections) {
        html += `<div class="docs-sec">${esc(sec.label)}</div>` + sec.docs.map(itemHtml).join('');
      }
    }
    if (tree.notes.length) {
      html += `<div class="docs-aud">Working notes</div>`;
      for (const n of tree.notes) {
        html += `<div class="docs-sec docs-dir">${esc(n.dir)}</div>` + n.docs.map(itemHtml).join('');
      }
    }
    nav.innerHTML = html || '<div class="docs-empty">no docs ingested for this project yet</div>';
  }

  async function openDoc(filePath, title, frag) {
    nav.querySelectorAll('.docs-item').forEach((b) => b.classList.toggle('on', b.dataset.path === filePath));
    body.innerHTML = '<div class="docs-loading">loading…</div>'; tocEl.innerHTML = '';
    let res;
    try { res = (await fetch('/api/file?path=' + encodeURIComponent(filePath)).then((r) => r.json())).file || {}; }
    catch { body.innerHTML = '<div class="docs-empty">could not read the file</div>'; return; }
    if (res.blocked) {
      body.innerHTML = `<div class="docs-empty">this file is outside the granted read roots ` +
        (openPerms ? `<button class="dg-btn" id="docs-grant">grant access</button>` : '') + `</div>`;
      const g = document.getElementById('docs-grant');
      if (g && openPerms) g.onclick = () => openPerms();
      return;
    }
    if (res.missing || res.error || res.text == null) {
      body.innerHTML = `<div class="docs-empty">${esc(res.error || 'file not found on disk')}</div>`;
      return;
    }
    currentDoc = { filePath, title };
    // docPath for relative-link resolution = the Source title (root-relative path)
    const { html, toc } = renderDoc(res.text, { docPath: title });
    body.innerHTML = html;
    body.scrollTop = 0;
    renderToc(toc);
    hydrateDiagrams();
    if (frag) { const t = body.querySelector('#' + CSS.escape(frag)); if (t) t.scrollIntoView(); }
  }

  function renderToc(toc) {
    tocEl.innerHTML = toc.length < 2 ? '' :
      `<div class="docs-toc-t">On this page</div>` +
      toc.map((t) => `<a class="docs-toc-i lvl${t.level}" href="#" data-toc="${esc(t.id)}">${esc(t.text)}</a>`).join('');
  }

  // ```plantuml fences → live-themed SVG via the local render lane (6c). The placeholder
  // keeps the highlighted source as the honest fallback on failure/absence.
  async function hydrateDiagrams() {
    const spots = [...body.querySelectorAll('.doc-diagram[data-puml]')];
    if (!spots.length) return;
    for (const el of spots) {
      try {
        const r = await fetch('/api/diagram/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ puml: el.dataset.puml }) }).then((x) => x.json());
        if (r.svg) { el.innerHTML = `<div class="dg-svg">${r.svg}</div>`; el.classList.add('hydrated'); }
        else if (!r.unavailable) el.insertAdjacentHTML('afterbegin', `<div class="docs-dg-err">${esc(r.error || 'diagram failed to render')}</div>`);
        // unavailable (no plantuml installed): leave the highlighted source, no error strip
      } catch { /* keep the source fallback */ }
    }
  }

  // Delegated interactions: sidebar items, in-doc doc-links, TOC jumps.
  nav.addEventListener('click', (e) => {
    const it = e.target.closest('.docs-item'); if (!it) return;
    if (it.classList.contains('blocked')) {
      if (openPerms) openPerms();
      return;
    }
    openDoc(it.dataset.path, it.dataset.title);
  });
  body.addEventListener('click', (e) => {
    const dl = e.target.closest('[data-doc-link]');
    if (dl) {
      e.preventDefault();
      const target = findByTitleSuffix(dl.dataset.docLink);
      if (target) openDoc(target.file_path, target.title, dl.dataset.docFrag);
      else dl.classList.add('docs-link-dead'), dl.title = 'not in this project\'s ingested doc set';
    }
  });
  tocEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-toc]'); if (!a) return;
    e.preventDefault();
    const t = body.querySelector('#' + CSS.escape(a.dataset.toc));
    if (t) t.scrollIntoView({ behavior: 'smooth' });
  });
  // Scroll-spy: highlight the TOC entry whose heading is nearest above the viewport top.
  body.addEventListener('scroll', () => {
    const links = tocEl.querySelectorAll('[data-toc]'); if (!links.length) return;
    let active = links[0];
    for (const a of links) {
      const h = body.querySelector('#' + CSS.escape(a.dataset.toc));
      if (h && h.getBoundingClientRect().top - body.getBoundingClientRect().top < 90) active = a;
    }
    links.forEach((a) => a.classList.toggle('on', a === active));
  }, { passive: true });
  projSel.addEventListener('change', () => loadProject(projSel.value));

  function findByTitleSuffix(relPath) {
    if (!tree) return null;
    const all = [
      ...tree.audiences.flatMap((a) => a.sections.flatMap((s) => s.docs)),
      ...tree.notes.flatMap((n) => n.docs),
    ];
    const want = String(relPath || '').toLowerCase();
    return all.find((d) => String(d.title).toLowerCase().endsWith(want)) || null;
  }

  return { open, close };
}
