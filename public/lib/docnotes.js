// Pure helpers for anchored notes in the document/spreadsheet/PDF viewer. A note
// anchored to a file carries an `anchor_kind` + `locator` + `snippet` (the content at
// capture, kept as drift-detection context). Four anchor kinds coexist — the anchor is
// optional, so a bare node note (anchor_kind:'node') still works:
//   line    — locator: <1-based line>            (raw text/markdown/code, CSV-as-rows)
//   cell    — locator: "r<row>c<col>" (0-based)  (CSV / xlsx pretty table)
//   row     — locator: "row<row>" (0-based)      (a whole table row)
//   col     — locator: "col<col>" (0-based)      (a whole table column)
//   section — locator: <heading slug>            (rendered markdown headings)
//   pdf     — locator: "p<page>" (1-based)       (PDF pages)
// No DOM here — fully unit-tested; app.js sets innerHTML on the result.

// The closed Note.state vocabulary — the single source both the UI and the server read.
// Two lifecycles share the field: the review-inbox cycle (raw → cued → addressed/skipped,
// mutated via /api/note/state) and the acceptance-criterion lifecycle (unverified → pass/fail,
// changed ONLY via explicit verification events — POST /api/criterion/verify; see criteria.js).
const STATE_LABEL = {
  raw: 'new', cued: 'cued', addressed: 'done', skipped: 'skipped',
  unverified: 'unverified', pass: 'pass', fail: 'fail',
};
export { STATE_LABEL };
// The inbox cycle order (what __noteCycle and /api/note/state accept). Criterion states are
// deliberately NOT here: a criterion's state may never change silently via the generic cycle.
export const NOTE_CYCLE_STATES = ['raw', 'cued', 'addressed', 'skipped'];

// ── locator codec ────────────────────────────────────────────────────────────
export function makeCellLocator(r, c) { return `r${r}c${c}`; }
export function parseCellLocator(s) {
  const m = /^r(\d+)c(\d+)$/.exec(String(s == null ? '' : s));
  return m ? { r: Number(m[1]), c: Number(m[2]) } : null;
}
export function makeRowLocator(r) { return `row${r}`; }
export function parseRowLocator(s) { const m = /^row(\d+)$/.exec(String(s == null ? '' : s)); return m ? Number(m[1]) : null; }
export function makeColLocator(c) { return `col${c}`; }
export function parseColLocator(s) { const m = /^col(\d+)$/.exec(String(s == null ? '' : s)); return m ? Number(m[1]) : null; }
export function makePageLocator(p) { return `p${p}`; }
export function parsePageLocator(s) {
  const m = /^p(\d+)$/.exec(String(s == null ? '' : s));
  if (m) return Number(m[1]);
  const n = Number(s); return Number.isNaN(n) ? null : n;   // tolerate a bare number
}
// Stable, readable heading id for section anchors (matches GitHub-ish slugs).
export function slugify(s) {
  return String(s == null ? '' : s).toLowerCase().trim()
    .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ── anchor indexes (note[] -> Map keyed by anchor) ────────────────────────────
export function lineNotesIndex(notes = []) {
  const by = new Map();
  for (const n of notes || []) {
    if (n && n.anchor_kind === 'line' && n.locator != null) {
      const k = Number(n.locator);
      if (!Number.isNaN(k)) { if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
    }
  }
  return by;
}
export function cellNotesIndex(notes = []) {
  const by = new Map();                                       // key: "r,c"
  for (const n of notes || []) {
    if (n && n.anchor_kind === 'cell') {
      const p = parseCellLocator(n.locator);
      if (p) { const k = `${p.r},${p.c}`; if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
    }
  }
  return by;
}
export function rowNotesIndex(notes = []) {
  const by = new Map();                                       // key: 0-based row
  for (const n of notes || []) {
    if (n && n.anchor_kind === 'row') {
      const k = parseRowLocator(n.locator);
      if (k != null) { if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
    }
  }
  return by;
}
export function colNotesIndex(notes = []) {
  const by = new Map();                                       // key: 0-based col
  for (const n of notes || []) {
    if (n && n.anchor_kind === 'col') {
      const k = parseColLocator(n.locator);
      if (k != null) { if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
    }
  }
  return by;
}
export function sectionNotesIndex(notes = []) {
  const by = new Map();                                       // key: heading slug
  for (const n of notes || []) {
    if (n && n.anchor_kind === 'section' && n.locator != null) {
      const k = String(n.locator);
      if (!by.has(k)) by.set(k, []); by.get(k).push(n);
    }
  }
  return by;
}
export function pageNotesIndex(notes = []) {
  const by = new Map();                                       // key: 1-based page
  for (const n of notes || []) {
    if (n && n.anchor_kind === 'pdf' && n.locator != null) {
      const k = parsePageLocator(n.locator);
      if (k != null) { if (!by.has(k)) by.set(k, []); by.get(k).push(n); }
    }
  }
  return by;
}
// How many anchored notes of any kind this file carries (for the header pill).
export function anchoredCount(notes = []) {
  return (notes || []).filter((n) => n && n.anchor_kind && n.anchor_kind !== 'node').length;
}

// ── shared renderers ──────────────────────────────────────────────────────────
// Render an author as a short byline + a kind ('you' | 'agent') for styling.
export function authorLabel(author) {
  const a = String(author || 'you');
  if (a === 'you' || a === '') return { kind: 'you', text: 'You' };
  if (a.startsWith('agent:')) return { kind: 'agent', text: a.slice('agent:'.length) || 'agent' };
  return { kind: 'agent', text: a };
}

// A cluster of notes as .fr-anno rows (author byline + state pill + text). Reused by every view.
export function annoHtml(notes, esc) {
  let out = '';
  for (const n of notes || []) {
    const st = STATE_LABEL[n.state] ? n.state : 'raw';
    const au = authorLabel(n.author);
    out += `<div class="fr-anno fr-anno-${esc(st)}" data-id="${esc(n.id || '')}">` +
      `<span class="fr-anno-au fr-anno-au-${au.kind}">${esc(au.text)}</span>` +
      `<span class="fr-anno-st">${STATE_LABEL[st]}</span>${esc(n.text || '')}</div>`;
  }
  return out;
}

// Render the raw file body: one addressable .fr-line per line (+ gutter), with any
// anchored notes shown as .fr-anno rows beneath the line they belong to.
// `renderLine(lineText) -> html` is optional (defaults to plain escaped text); the
// code-review viewer passes a syntax highlighter, the file reader passes nothing.
export function rawLinesHtml(text, notes, esc, renderLine) {
  const byLine = lineNotesIndex(notes);
  const lines = String(text == null ? '' : text).split('\n');
  const render = typeof renderLine === 'function' ? renderLine : (s) => esc(s);
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const has = byLine.has(ln);
    out += `<div class="fr-line${has ? ' has-note' : ''}" data-line="${ln}">` +
      `<span class="fr-gut" title="add a note on this line">+</span>` +
      `<span class="fr-ln">${ln}</span>` +
      `<span class="fr-tx">${render(lines[i], i)}</span></div>`;
    if (has) out += annoHtml(byLine.get(ln), esc);
  }
  return out;
}
