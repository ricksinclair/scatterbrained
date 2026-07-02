// file-reader-ui.js — in-app file viewer: load a source/code/markdown/CSV/PDF file frozen by the
// server (sandboxed), with note affordances, a markdown lock+save+git editor, and git version
// history. Extracted from app.js (app.js modularization). The inspector note/protected-fact
// handlers (window.__*) stay in app.js — they touch the selection state, not the file view.
// deps: { esc, trunc }  (trunc is used once, in the CSV chart-render ctx).
// returns { openFile, openNoteModal, postNote, isOpen, close }.
import { miniMarkdown, REGISTRY } from './registry.js';
import { parseCsv, sortRows, filterRows, isNumericColumn } from './csv.js';
import { rawLinesHtml, cellNotesIndex, rowNotesIndex, colNotesIndex, sectionNotesIndex, pageNotesIndex, annoHtml, slugify, makeCellLocator, makeRowLocator, makeColLocator, makePageLocator, anchoredCount } from './docnotes.js';
import { recommendChart, histogramSpec, columnValues, profileColumns } from './dataviz.js';

export function initFileReader({ esc, trunc }) {
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
  // Escape is owned by app.js's single unwind handler (nav, C2); it calls esc() below,
  // which keeps the contextual step: Escape cancels an in-progress edit before closing.

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

  return {
    openFile, openNoteModal, postNote, isOpen: () => !FR.hidden, close: closeFile,
    esc: () => { if (frEdit.active) cancelEdit(); else closeFile(); },   // one Esc step (edit → view → closed)
  };
}
