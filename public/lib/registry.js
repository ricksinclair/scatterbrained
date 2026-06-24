// Component registry — the composable inspector (SPEC §10).
// `resolveLayout` decides WHICH components appear and in what order; this module
// decides HOW each renders. Every renderer is a pure `render(node, data, ctx) ->
// htmlString` so the shipped UI is exactly the unit-tested logic (no DOM here; the
// browser just sets innerHTML on the result). M-B starters: the components that run
// against the existing /api/node payload — content viewers (excerpt/pdf/…) that need
// the M-A BFF register later without touching this dispatch.
//
// `data` (from /api/node, all optional): { edges:[{type,dir,name,label,url,file_path}],
//   sources:[…], created_at, valid_until, superseded_by, invalidated_reason }
// `ctx`: { esc, trunc, caps } — helpers injected so renderers stay pure/testable.

import { resolveLayout } from './resolve.js';
import { coerceView } from './views.js';
import { neighborhoodLayout } from './graph.js';
import { parseVideoUrl, domainOf } from './links.js';

// Color per node label (mirrors app.js PAL) for inline subgraph dots — kept here so
// the pure renderer needs no DOM/theme. Falls back to a neutral gray.
const LABEL_HUE = {
  Project: '#7F77DD', Goal: '#1D9E75', Insight: '#378ADD', Rule: '#EF9F27',
  Source: '#888780', Organization: '#D85A30', Person: '#D4537E', Idea: '#5DCAA5', Skill: '#97C459',
};
const hueOf = (label) => LABEL_HUE[label] || '#888780';

// Key-facts metric row for the report header — the ≤4 chunks "above the fold"
// (WM ≈ 4; our cognitive-foundations research). Returns [{label, value}], pruned to
// what's actually present, capped at 4.
// Real, uncapped counts come from the node (server COUNTs); fall back to the capped
// edge list only when absent. The /api/node edge list is truncated (≤60), so deriving
// counts from it under-reports — hence prefer node.degree / node.source_count.
// Annotation/meta labels that get their own inspector sections (Notes, Protected facts,
// code Reviews) — they must not double-count as graph "relations" or leak into the
// referenced-by list as raw UUIDs. Mirrors RELSHAPE_EXEMPT_LABELS in scripts/lib/vocab.js.
export const ANNOTATION_LABELS = ['Note', 'ProtectedFact', 'Review'];
const isAnnotationEdge = (e) => ANNOTATION_LABELS.includes(e.label);

export function keyFacts(node = {}, data = {}) {
  const edges = data.edges || [];
  const facts = [];
  if (node.label === 'Goal') {
    const reqs = edges.filter((e) => e.type === 'REQUIRES' && e.dir === 'out');
    if (reqs.length) facts.push({ label: 'progress', value: Math.round(reqs.filter((r) => r.valid_until || /\b(done|complete|achieved|shipped|closed|live|published)\b/i.test(String(r.status || ''))).length / reqs.length * 100) + '%' });
  }
  if (node.confidence) facts.push({ label: 'confidence', value: String(node.confidence) });
  const sourceCount = node.source_count != null ? node.source_count
    : (data.sources || edges.filter((e) => e.label === 'Source' && e.dir === 'in')).length;
  if (sourceCount > 0) facts.push({ label: 'sources', value: sourceCount });
  // "connections" = all relationships minus provenance sources and annotation nodes
  // (Notes/ProtectedFacts/Reviews have their own sections), uncapped when degree present.
  const annot = edges.filter(isAnnotationEdge).length;
  const connections = node.degree != null ? Math.max(0, node.degree - sourceCount - annot)
    : (edges.length - edges.filter((e) => e.label === 'Source' && e.dir === 'in').length - annot);
  if (connections > 0) facts.push({ label: 'connections', value: connections });
  if (node.jurisdiction) facts.push({ label: 'jurisdiction', value: String(node.jurisdiction) });
  return facts.slice(0, 4);
}

// ── default pure helpers (overridable via ctx) ───────────────────────────────
const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _trunc = (s, n = 40) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Resurface logic (Tier-3b, research-backed): importance × staleness with a horizon
// that scales with importance — a more-connected node resurfaces sooner (spacing
// scales with the retention horizon, Cepeda 2008). Pure. `now`/`snoozedUntil` are ms.
export function resurfaceState(createdAt, degree = 0, { snoozedUntil = 0, now = 0, superseded = false } = {}) {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  const ageDays = isNaN(created) ? 0 : Math.max(0, Math.floor((now - created) / 86400000));
  const horizon = Math.max(3, 30 - Math.min(27, degree));   // important (high-degree) → shorter horizon
  const snoozed = snoozedUntil > now;
  // a superseded/invalidated node is dead — never nudge to "revisit" it (look at its
  // replacement instead, via the timeline link).
  const due = !superseded && !snoozed && ageDays >= horizon;
  return { ageDays, horizon, due, snoozed, snoozedUntil };
}

// confidence level → meter fill fraction (closed set, mirrors the graph's values).
const CONFIDENCE_FRAC = { low: 0.33, tentative: 0.33, medium: 0.66, high: 1.0 };

// A requirement / goal counts as "done" if its status reads complete, or it's been
// closed out bi-temporally (valid_until set). Tolerant of the several done-words in use.
const DONE_STATUS = /\b(done|complete|completed|achieved|shipped|closed|live|published)\b/i;
function isDone(n = {}) {
  if (n.valid_until) return true;
  return DONE_STATUS.test(String(n.status || ''));
}

// Minimal local-first markdown → HTML (headings, bold/italic/code, bullet lists,
// paragraphs). Deliberately tiny — no CDN, no vendor lib until Open #1 is decided.
function miniMarkdown(src, esc) {
  const lines = String(src || '').split(/\r?\n/);
  const out = [];
  let inList = false;
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const line of lines) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (h) { closeList(); const lvl = h[1].length; out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); }
    else if (li) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return out.join('');
}

// Edge meaning ranking — when a node has more relations than fit, show the
// *actionable* ones first (what it needs / blocks / delivers / depends on) and push
// generic incoming references (ABOUT/INFORMS) last. Persona finding (P3 researcher,
// P5 strategist): a goal's 6 incoming "ABOUT" insights were crowding out its
// REQUIRES/ACHIEVED_BY. Outgoing beats incoming at equal type. Pure + tested.
const EDGE_RANK = {
  BLOCKED_BY: 9, REQUIRES: 8, ACHIEVED_BY: 8, DEPENDS_ON: 7, CONSTRAINS: 6, CONTAINS: 6,
  ENABLES: 5, SUPPORTS: 5, USES: 4, USED_IN: 4, APPLIES_TO: 4, COLLABORATES_ON: 4,
  TEACHES: 3, DERIVED_FROM: 3, PART_OF: 3, INFORMS: 2, ABOUT: 1,
};
export function rankEdges(edges = []) {
  const score = (e) => (EDGE_RANK[e.type] != null ? EDGE_RANK[e.type] : 3) * 2 + (e.dir === 'out' ? 1 : 0);
  return [...edges].sort((a, b) => score(b) - score(a));
}

// Relative intention-time label for a Goal's target_date (#25 P1). Pure: takes an
// explicit `nowMs` so it's deterministic in tests; the component passes Date.now().
// 'YYYY-MM-DD' → "due today" / "in 5d" / "3d overdue"; blank/invalid → ''.
export function dueLabel(target, nowMs) {
  if (!target) return '';
  const t = Date.parse(String(target) + 'T00:00:00');
  if (Number.isNaN(t)) return '';
  const days = Math.round((t - nowMs) / 86400000);
  if (days === 0) return 'due today';
  return days < 0 ? `${-days}d overdue` : `due in ${days}d`;
}

// Provenance edges — earned at ingest, superseded not hand-pruned. The inspector hides
// the remove-× on them (the server refuses too); mirrors server.js PROVENANCE_TYPES.
const PROV_TYPES = new Set(['INFORMS', 'DERIVED_FROM']);

// "Action" edges (what a node needs/blocks/achieves) vs everything else (provenance/topic).
const ACTION_TYPES = new Set(['BLOCKED_BY', 'REQUIRES', 'ACHIEVED_BY', 'DEPENDS_ON', 'CONSTRAINS',
  'CONTAINS', 'ENABLES', 'SUPPORTS', 'USES', 'USED_IN', 'APPLIES_TO', 'PART_OF', 'COLLABORATES_ON']);
export const isActionType = (t) => ACTION_TYPES.has(t);

// One-line structural read of a node from its degree + edge mix (1-hop heuristic — honest
// about what 1 hop can know: role by degree, skew by in/out, breadth by label diversity).
export function relationShape(degree, edges = []) {
  const inC = edges.filter((e) => e.dir === 'in').length;
  const outC = edges.filter((e) => e.dir === 'out').length;
  const kinds = new Set(edges.map((e) => e.label)).size;
  const role = degree <= 2 ? 'leaf' : degree >= 20 ? 'hub' : kinds >= 4 ? 'connector' : 'node';
  const skew = !inC ? 'all outbound' : !outC ? 'all inbound'
    : inC > outC * 2 ? 'mostly inbound' : outC > inC * 2 ? 'mostly outbound' : 'balanced';
  return { role, degree, inC, outC, kinds, skew };
}

// Group edges by type → ranked groups with accurate (uncapped) totals from relTypes when
// available, the per-neighbor items from the (capped) edge list, sorted by EDGE_RANK.
export function relationGroups(edges = [], relTypes = null) {
  const totals = {};
  if (Array.isArray(relTypes)) relTypes.forEach((t) => { totals[t] = (totals[t] || 0) + 1; });
  const byType = new Map();
  for (const e of edges) {
    if (!byType.has(e.type)) byType.set(e.type, { type: e.type, out: 0, in: 0, items: [], stale: 0 });
    const g = byType.get(e.type);
    if (e.dir === 'out') g.out++; else g.in++;
    if (e.valid_until) g.stale++;
    g.items.push(e);
  }
  return [...byType.values()].map((g) => ({
    ...g,
    total: totals[g.type] != null ? totals[g.type] : g.out + g.in,
    rank: EDGE_RANK[g.type] != null ? EDGE_RANK[g.type] : 3,
    action: ACTION_TYPES.has(g.type),
  })).sort((a, b) => b.rank - a.rank || b.total - a.total);
}

// Inline 1-hop subgraph (relations in report view): a radial SVG of the node + its
// neighbors, grouped visually by edge. Up to 12 neighbors; the rest summarized.
function relationsSubgraph(node, edges, { esc, trunc }) {
  const shown = edges.slice(0, 12);
  const W = 360, H = 300, cx = W / 2, cy = H / 2;
  const placed = neighborhoodLayout(shown, { cx, cy, radius: 108 });
  const spokes = placed.map((e) =>
    `<line x1="${cx}" y1="${cy}" x2="${e.x.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="rgba(140,150,200,.28)" stroke-width="1"/>`).join('');
  const nbs = placed.map((e) => {
    const tx = e.x, ty = e.y;
    const anchor = tx < cx - 20 ? 'end' : tx > cx + 20 ? 'start' : 'middle';
    return `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="7" fill="${hueOf(e.label)}"/>` +
      `<text x="${tx.toFixed(1)}" y="${(ty - 11).toFixed(1)}" text-anchor="${anchor}" class="sg-rel">${esc(e.type)}</text>` +
      `<text x="${tx.toFixed(1)}" y="${(ty + 18).toFixed(1)}" text-anchor="${anchor}" class="sg-name">${esc(trunc(e.name, 16))}</text>`;
  }).join('');
  const more = edges.length > shown.length ? `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="sg-more">+${edges.length - shown.length} more relations</text>` : '';
  return `<div class="c-relations c-relations--graph"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Relationship neighborhood">` +
    spokes + nbs +
    `<circle cx="${cx}" cy="${cy}" r="13" fill="${hueOf(node.label)}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="var(--accent)" stroke-width="1.5"/>` +
    `<text x="${cx}" y="${(cy - 22).toFixed(1)}" text-anchor="middle" class="sg-center">${esc(trunc(node.name || '', 20))}</text>` +
    more + `</svg></div>`;
}

// ── component renderers (id → render) ────────────────────────────────────────
export const REGISTRY = {
  text: {
    id: 'text',
    render(node, _data, { esc }) {
      const body = node.full_text || node.desc || node.description;
      if (!body) return '';
      return `<div class="c-text">${esc(body)}</div>`;
    },
  },

  markdown: {
    id: 'markdown',
    render(node, _data, { esc }) {
      const body = node.full_text || node.desc || node.description;
      if (!body) return '';
      return `<div class="c-markdown">${miniMarkdown(body, esc)}</div>`;
    },
  },

  excerpt: {
    id: 'excerpt',
    // The "See" layer: a grounded excerpt of the node's primary file, served by
    // /api/source and passed in as data.source. Renders nothing if absent; shows a
    // quiet note for sandbox-blocked / binary / oversized files (viewers come later).
    render(_node, data, { esc, trunc }) {
      const s = data.source;
      if (!s) return '';
      const cap = (txt) => `<div class="ex-cap">${txt}</div>`;
      const file = esc(trunc(s.title || s.sourcePath || 'source', 34));
      if (s.blocked) return `<div class="c-excerpt">${cap('source outside the read sandbox')}</div>`;
      if (s.missing) return `<div class="c-excerpt">${cap('source file not found')}</div>`;
      if (s.tooLarge) return `<div class="c-excerpt">${cap(file + ' — too large to preview')}</div>`;
      if (s.unsupported) return `<div class="c-excerpt">${cap(file + ' · ' + esc(s.kind) + ' — open to view')}</div>`;
      if (!s.text) return '';
      const where = s.matchedLine ? `near line ${s.matchedLine}` : 'opening';
      const more = s.truncated ? ' · excerpt' : '';
      const open = s.sourcePath ? ` · <a class="ex-open" href="#" onclick="return __openFile(${esc(JSON.stringify(s.sourcePath)).replace(/"/g, '&quot;')}),false">open full file →</a>` : '';
      return `<div class="c-excerpt"><pre class="ex-body">${esc(s.text)}</pre>` +
        cap(`${file} · ${where}${more}${open}`) + `</div>`;
    },
  },

  provenance: {
    id: 'provenance',
    render(_node, data, { esc, trunc }) {
      const sources = (data.sources || (data.edges || []).filter((e) => e.label === 'Source' && e.dir === 'in'));
      const n = sources.length;
      if (!n) return '';
      // Show ALL sources (not a slice) so every file is reachable; the list scrolls
      // when long, and gets a substring filter when there are enough to warrant one.
      const items = sources.map((s) => {
        const label = esc(trunc(s.name, 40));
        const kind = s.source_kind ? `<span class="src-kind">${esc(s.source_kind)}</span>` : '';
        const f = esc(String((s.name || '') + ' ' + (s.source_kind || '')).toLowerCase());
        let link;
        // File-backed sources load in-app (sandboxed); web sources open externally.
        if (s.file_path) link = `<a class="src-file" href="#" title="${esc(s.name)}" onclick="return __openFile(${esc(JSON.stringify(s.file_path)).replace(/"/g, '&quot;')}),false">${label}</a>`;
        else if (s.url) link = `<a href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(s.name)}">${label}</a>`;
        else link = `<span class="src">${label}</span>`;
        return `<div class="prov-row" data-f="${f}">${link}${kind}</div>`;
      }).join('');
      const filter = n > 8 ? `<input class="prov-filter" type="text" placeholder="filter ${n} sources…" oninput="__provFilter(this)" aria-label="filter sources">` : '';
      const scroll = n > 6 ? ' prov-scroll' : '';
      return `<div class="c-provenance"><div class="ph">informed by ${n} source${n > 1 ? 's' : ''}</div>${filter}` +
        `<div class="prov-list${scroll}">${items}<div class="prov-empty" style="display:none">no matches</div></div></div>`;
    },
  },

  relations: {
    id: 'relations',
    render(node, data, { esc, trunc, view }) {
      const rest = rankEdges((data.edges || []).filter((e) => !(e.label === 'Source' && e.dir === 'in') && !isAnnotationEdge(e)));
      if (!rest.length) return '';
      // Shape verdict: a one-line structural read (hub/leaf/connector + in/out skew). The
      // count excludes provenance sources + annotation nodes (their own sections), matching
      // the list below — not the raw server degree.
      const allEdges = data.edges || rest;
      const skipped = allEdges.filter((e) => isAnnotationEdge(e) || (e.label === 'Source' && e.dir === 'in')).length;
      const relDegree = data.degree != null ? Math.max(rest.length, data.degree - skipped) : rest.length;
      const sh = relationShape(relDegree, rest);
      const shapeLine = `<div class="rel-shape"><b>${sh.role}</b> · ${sh.degree} connection${sh.degree === 1 ? '' : 's'}${sh.role !== 'leaf' ? ` · ${sh.skew}` : ''}</div>`;

      if (view === 'report') return `<div class="c-relations-report">${shapeLine}${relationsSubgraph(node, rest, { esc, trunc })}</div>`;

      // Inspector: grouped-by-type digest, split into actions vs references, clickable.
      const groups = relationGroups(rest, data.relTypes);
      const cap = 5;
      // Inspector edges are removable (#29) — except provenance (hidden here, refused server-side).
      // The × carries the relationship id; app.js delegates the removal + re-select.
      const editable = view !== 'report';
      const neighbor = (e) => {
        const link = `<a class="nav-node rel-n${e.valid_until ? ' stale' : ''}" data-id="${esc(e.id || '')}" data-name="${esc(e.name || '')}"` +
          `${e.valid_until ? ' title="superseded"' : ''}><i class="rel-dot" style="background:${hueOf(e.label)}"></i>${esc(trunc(e.name, 22))}</a>`;
        const rmable = editable && e.rel_id && !PROV_TYPES.has(e.type);
        if (!rmable) return link;
        const x = `<button class="rel-x" data-unrel="${esc(e.rel_id)}" data-name="${esc(e.name || '')}" data-type="${esc(e.type || '')}" title="remove this relationship" aria-label="remove relationship to ${esc(e.name || '')}">×</button>`;
        return `<span class="rel-n-wrap">${link}${x}</span>`;
      };
      const groupRow = (g) => {
        const arrow = g.out && !g.in ? '→' : g.in && !g.out ? '←' : '↔';
        const more = g.total > g.items.length ? ` <span class="rel-more">+${g.total - g.items.length}</span>` : '';
        const staleTag = g.stale ? ` <span class="rel-stale-tag">${g.stale} stale</span>` : '';
        return `<div class="rel-g"><div class="rel-g-h"><span class="et">${esc(g.type)}</span>` +
          `<span class="rel-g-arrow">${arrow}</span><span class="rel-g-n">${g.total}</span>${staleTag}</div>` +
          `<div class="rel-g-items">${g.items.slice(0, cap).map(neighbor).join('')}${more}</div></div>`;
      };
      const actions = groups.filter((g) => g.action);
      const refs = groups.filter((g) => !g.action);
      const section = (title, gs) => gs.length ? `<div class="rel-sec-h">${title}</div>${gs.map(groupRow).join('')}` : '';
      return `<div class="c-relations">${shapeLine}${section('acts on / blocks', actions)}${section('referenced by', refs)}</div>`;
    },
  },

  timeline: {
    id: 'timeline',
    render(_node, data, { esc, trunc }) {
      const bt = [];
      if (data.created_at) bt.push('created ' + String(data.created_at).slice(0, 10));
      bt.push(data.valid_until ? `<span class="sup">valid_until ${String(data.valid_until).slice(0, 10)}</span>` : 'valid (current)');
      if (data.superseded_by) {
        // navigable when the server resolved the reference to a live node; else plain text
        const label = esc(trunc(data.superseded_by_name || String(data.superseded_by), 30));
        bt.push(data.superseded_by_id
          ? `→ superseded by <a class="nav-node" data-id="${esc(data.superseded_by_id)}" data-name="${esc(data.superseded_by_name || '')}">${label}</a>`
          : `→ superseded by ${label}`);
      }
      if (data.invalidated_reason) bt.push('reason: ' + esc(trunc(data.invalidated_reason, 40)));
      return `<div class="c-timeline">${bt.join('<br>')}</div>`;
    },
  },

  // Video — embed a YouTube/Vimeo/mp4 link inline (privacy-friendly nocookie host,
  // sandboxed iframe). The "See" layer for video links.
  video: {
    id: 'video',
    render(node, data, { esc }) {
      const url = node.url || data.url;
      const v = parseVideoUrl(url);
      if (!v) return '';
      const body = v.direct
        ? `<video class="video-el" controls preload="metadata" src="${esc(v.embedUrl)}"></video>`
        : `<div class="video-frame"><iframe src="${esc(v.embedUrl)}" title="embedded video" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div>`;
      return `<div class="c-video">${body}<a class="video-src" href="${esc(url)}" target="_blank" rel="noopener">${esc(domainOf(url) || 'open')} ↗</a></div>`;
    },
  },

  // Link — a rich card for any other web URL (title + domain + open-external).
  // No favicon fetch (local-first / no external egress); a glyph instead.
  link: {
    id: 'link',
    render(node, data, { esc, trunc }) {
      const url = node.url || data.url;
      if (!url) return '';
      const dom = domainOf(url);
      const title = esc(trunc(node.name || data.name || dom || url, 90));
      return `<div class="c-link"><a class="link-card" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(url)}">` +
        `<span class="link-ico">↗</span>` +
        `<span class="link-body"><span class="link-title">${title}</span><span class="link-domain">${esc(dom)}</span></span></a></div>`;
    },
  },

  // Notes — a deferred-instruction inbox on any node: jot a note now; the next
  // sync evaluates it (raw → cued → addressed/skipped). Anchored notes carry an
  // optional locus inside a Source (line/page/cell). The add/state actions are
  // wired in app.js (__addNote / __noteCycle); this render is pure.
  notes: {
    id: 'notes',
    render(node, data, { esc, trunc }) {
      const notes = data.notes || [];
      const tid = esc(node.id || data.id || '');
      const STATE_LABEL = { raw: 'new', cued: 'cued', addressed: 'done', skipped: 'skipped' };
      const rows = notes.map((nt) => {
        const st = STATE_LABEL[nt.state] ? nt.state : 'raw';
        const when = nt.created_at ? String(nt.created_at).slice(0, 10) : '';
        const anchored = nt.anchor_kind && nt.anchor_kind !== 'node';
        const anchor = anchored ? `<span class="note-anchor">${esc(nt.anchor_kind)}${nt.locator ? ' ' + esc(String(nt.locator)) : ''}</span>` : '';
        return `<div class="note-row note-${esc(st)}">` +
          `<button class="note-state st-${esc(st)}" onclick="__noteCycle(this);return false" data-id="${esc(nt.id || '')}" data-state="${esc(st)}" title="cycle: new → cued → done → skipped">${STATE_LABEL[st]}</button>` +
          `<div class="note-body"><div class="note-text">${esc(trunc(nt.text || '', 280))}</div>` +
          `<div class="note-meta">${anchor}${when}</div></div></div>`;
      }).join('');
      const empty = notes.length ? '' : `<div class="note-empty">No notes yet — jot one and the next sync acts on it.</div>`;
      const form = `<form class="note-add" onsubmit="__addNote(this);return false">` +
        `<textarea name="text" rows="2" placeholder="add a note — e.g. “research X”, “reconcile with Y”…" aria-label="add a note"></textarea>` +
        `<input type="hidden" name="tid" value="${tid}" />` +
        `<div class="note-add-actions"><button type="button" class="note-expand-btn" onclick="__expandNote(this)" title="open large editor" aria-label="open large editor">⤢</button>` +
        `<button type="submit" class="note-add-btn">add note</button></div></form>`;
      return `<div class="c-notes"><div class="ph">notes${notes.length ? ` · ${notes.length}` : ''}</div>${rows}${empty}${form}</div>`;
    },
  },

  // Protected facts (#23) — pinned values a rewrite must HONOR. Each row is just the value
  // (self-evident — no type badge needed) + an optional human DETAILS label ("what is this /
  // why it matters"; stored in the node's `note` field), editable inline. A queued change (pending_*) gets an approve/reject banner, the
  // same approval the dock surfaces. `kind` is auto-derived on pin and stays internal (it powers
  // the guard's replacement matching) — not shown, not managed.
  // Interactions (__pinFact / __unpinFact / __resolveFact / __suggestFacts / __setFactNote) live in app.js.
  'protected-facts': {
    id: 'protected-facts',
    render(node, data, { esc, trunc }) {
      const facts = data.protectedFacts || [];
      const tid = esc(node.id || data.id || '');
      const rows = facts.map((f) => {
        const fid = esc(f.id || '');
        const pending = f.pending_status
          ? `<div class="pf-pending"><span class="pf-warn">⚠ rewrite ${esc(f.pending_status)} this fact` +
            `${f.pending_new ? ` → <b>${esc(trunc(f.pending_new, 40))}</b>` : ''}</span>` +
            `<span class="pf-acts"><button class="pf-approve" onclick="__resolveFact('${fid}','approve');return false">approve</button>` +
            `<button class="pf-reject" onclick="__resolveFact('${fid}','reject');return false">reject</button></span></div>`
          : '';
        // The note is editable in place: blur or Enter saves; empty clears.
        const note = `<input class="pf-note-input" type="text" value="${esc(f.note || '')}" data-fid="${fid}"` +
          ` placeholder="details — what is this? (optional)" aria-label="details for ${esc(trunc(f.value || '', 40))}"` +
          ` onchange="__setFactNote(this)" onkeydown="if(event.key==='Enter')this.blur()" autocomplete="off" />`;
        return `<div class="pf-row${f.pending_status ? ' pf-flagged' : ''}">` +
          `<div class="pf-main"><span class="pf-val">${esc(trunc(f.value || '', 80))}</span>` +
          `<button class="pf-unpin" data-fid="${fid}" title="remove this protected fact (retire — history kept)" onclick="__unpinFact(this);return false" aria-label="remove protected fact">×</button></div>` +
          `${pending}${note}</div>`;
      }).join('');
      const empty = facts.length ? '' : `<div class="pf-empty">No protected facts — pin a number, amount, date, or citation a rewrite must keep.</div>`;
      const add = `<div class="pf-add" data-tid="${tid}">` +
        `<button class="pf-suggest-btn" onclick="__suggestFacts(this);return false" title="scan the text for pinnable facts">suggest from text</button>` +
        `<div class="pf-suggestions"></div>` +
        `<form class="pf-form" onsubmit="__pinFact(this);return false">` +
        `<input name="value" type="text" placeholder="pin a fact — e.g. 17 U.S.C. §107" aria-label="protected fact value" autocomplete="off" />` +
        `<input name="note" type="text" placeholder="details (optional)" aria-label="details" autocomplete="off" />` +
        `<button type="submit" class="pf-pin-btn">pin</button></form></div>`;
      // Retired (unpinned) facts — soft-removed, recoverable. Shown muted with a restore button.
      const retired = data.retiredFacts || [];
      const retiredHtml = retired.length ? `<details class="pf-retired"><summary class="pf-retired-h">retired · ${retired.length}</summary>` +
        retired.map((f) => `<div class="pf-retired-row"><span class="pf-retired-val">${esc(trunc(f.value || '', 60))}</span>` +
          `${f.note ? `<span class="pf-retired-note">${esc(trunc(f.note, 50))}</span>` : ''}` +
          `<button class="pf-restore" data-fid="${esc(f.id || '')}" onclick="__restoreFact(this);return false" title="restore — guard this value again">restore</button></div>`).join('') +
        `</details>` : '';
      return `<div class="c-protected-facts"><div class="ph">protected facts${facts.length ? ` · ${facts.length}` : ''}</div>${rows}${empty}${add}${retiredHtml}</div>`;
    },
  },

  flashcard: {
    id: 'flashcard',
    // Active-recall study widget (M-H): show the cue, let the user attempt recall,
    // THEN reveal the answer + grade it (testing effect). Renders the current card
    // from data.cards + data.study {idx, revealed, total, reviewed}. Controls emit
    // data-card actions the app handles (reveal / grade / restart).
    render(_node, data, { esc }) {
      const cards = data.cards || [];
      const st = data.study || { idx: 0, revealed: false, reviewed: 0 };
      if (!cards.length) return '<div class="c-flashcard"><div class="fc-empty">no studyable content</div></div>';
      if (st.idx >= cards.length) {
        return `<div class="c-flashcard done"><div class="fc-done">✓ reviewed ${st.reviewed || cards.length} card${cards.length > 1 ? 's' : ''}</div>` +
          `<button class="fc-btn" data-card="restart">study again</button></div>`;
      }
      const c = cards[st.idx];
      const counter = `<div class="fc-counter">card ${st.idx + 1} / ${cards.length}</div>`;
      const front = `<div class="fc-face fc-front">${esc(c.front)}</div>`;
      if (!st.revealed) {
        return `<div class="c-flashcard">${counter}${front}<button class="fc-btn fc-reveal" data-card="reveal">reveal answer</button></div>`;
      }
      const back = `<div class="fc-face fc-back">${esc(c.back)}</div>`;
      const grades = ['again', 'hard', 'good', 'easy'].map((g) =>
        `<button class="fc-btn fc-grade fc-${g}" data-card="grade:${g}">${g}</button>`).join('');
      return `<div class="c-flashcard">${counter}${front}<hr class="fc-hr">${back}<div class="fc-grades">${grades}</div></div>`;
    },
  },

  resurface: {
    id: 'resurface',
    // Self-suppressing: renders only when the node is due (or currently snoozed, so the
    // user can unsnooze). Importance × staleness; snooze state is browser-local (passed
    // in via data.resurface), never written to the canonical graph.
    render(_node, data, { esc }) {
      const r = data.resurface;
      if (!r) return '';
      if (r.snoozed) {
        const until = new Date(r.snoozedUntil).toISOString().slice(0, 10);
        return `<div class="c-resurface snoozed"><span class="rs-l">snoozed until ${esc(until)}</span>` +
          `<button class="rs-btn" data-resurface="unsnooze">revisit now</button></div>`;
      }
      if (!r.due) return '';
      return `<div class="c-resurface due"><span class="rs-dot"></span>` +
        `<span class="rs-l">revisit? · aging ${r.ageDays}d</span>` +
        `<button class="rs-btn" data-resurface="snooze">snooze 1w</button>` +
        `<button class="rs-btn" data-resurface="pin">pin</button></div>`;
    },
  },

  chart: {
    id: 'chart',
    // Chart from data.chart = { kind?: 'bar'|'histogram', title, bars:[{label,value}] }.
    // kind defaults to 'bar' (horizontal bars — e.g. a node's relation-type distribution).
    // 'histogram' renders the same {label,value} bars as vertical columns (e.g. a CSV
    // numeric column's bins). Self-suppresses if no bars.
    render(_node, data, { esc }) {
      const ch = data.chart;
      if (!ch || !ch.bars || !ch.bars.length) return '';
      const title = ch.title ? `<div class="ch-title">${esc(ch.title)}</div>` : '';
      const max = Math.max(...ch.bars.map((b) => b.value), 1);
      if ((ch.kind || 'bar') === 'histogram') {
        const cols = ch.bars.slice(0, 24).map((b) => {
          const h = Math.max(1, Math.round((b.value / max) * 100));
          return `<span class="hg-col" title="${esc(b.label)}: ${esc(String(b.value))}">` +
            `<span class="hg-bar" style="height:${h}%"></span><span class="hg-lab">${esc(b.label)}</span></span>`;
        }).join('');
        return `<div class="c-chart c-histogram">${title}<div class="hg-cols">${cols}</div></div>`;
      }
      const rows = ch.bars.slice(0, 8).map((b) => {
        const pct = Math.round((b.value / max) * 100);
        return `<div class="ch-row"><span class="ch-label">${esc(b.label)}</span>` +
          `<span class="ch-track"><span class="ch-bar" style="width:${pct}%"></span></span>` +
          `<span class="ch-val">${esc(String(b.value))}</span></div>`;
      }).join('');
      return `<div class="c-chart">${title}${rows}</div>`;
    },
  },

  confidence: {
    id: 'confidence',
    render(node, _data, { esc }) {
      const lvl = String(node.confidence || '').toLowerCase();
      const frac = CONFIDENCE_FRAC[lvl];
      if (frac == null) return '';
      const tone = frac >= 0.9 ? 'ok' : frac <= 0.34 ? 'warn' : 'mid';
      const cite = node.citation ? `<div class="conf-cite">${esc(node.citation)}</div>` : '';
      return `<div class="c-confidence"><div class="conf-row"><span class="conf-label">confidence</span>` +
        `<span class="conf-val conf-${tone}">${esc(lvl)}</span></div>` +
        `<div class="conf-bar"><div class="conf-fill conf-${tone}" style="width:${Math.round(frac * 100)}%"></div></div>${cite}</div>`;
    },
  },

  'goal-progress': {
    id: 'goal-progress',
    render(node, data, { esc, trunc }) {
      const reqs = (data.edges || []).filter((e) => e.type === 'REQUIRES' && e.dir === 'out');
      const project = (data.edges || []).find((e) => e.type === 'ACHIEVED_BY');
      let pct, sub;
      if (reqs.length) {
        const met = reqs.filter(isDone).length;
        pct = Math.round((met / reqs.length) * 100);
        sub = `${met}/${reqs.length} requirements met`;
      } else {
        pct = isDone(node) ? 100 : 0;
        sub = esc(node.status || 'active');
      }
      const proj = project ? `<div class="gp-proj">delivered by ${esc(trunc(project.name, 28))}</div>` : '';
      // target_date (#25 P1): an editable intention-date with a relative due label. The
      // input commits via a delegated change handler → POST /api/goal/target-date.
      const td = node.target_date || '';
      const dl = dueLabel(td, Date.now());
      const dueRow = `<div class="gp-due"><span class="gp-label">target date</span>` +
        `<input type="date" class="gp-date" data-goaldate="${esc(node.id || '')}" value="${esc(td)}" aria-label="goal target date">` +
        (dl ? `<span class="gp-duelabel${td && Date.parse(td + 'T00:00:00') < Date.now() ? ' overdue' : ''}">${esc(dl)}</span>` : '') + `</div>`;
      return `<div class="c-goal-progress"><div class="gp-row"><span class="gp-label">progress</span>` +
        `<span class="gp-pct">${pct}%</span></div>` +
        `<div class="gp-bar"><div class="gp-fill" style="width:${pct}%"></div></div>` +
        `<div class="gp-sub">${sub}</div>${proj}${dueRow}</div>`;
    },
  },

  'ai-summary': {
    id: 'ai-summary',
    // Capability-gated (resolver only emits it when caps.llm). State lives in
    // data.ai (loading/text/error); the app fetches /api/ai/summary on demand.
    render(_node, data, { esc }) {
      const s = (data.ai || {}).summary;
      if (s && s.loading) return '<div class="c-ai"><div class="ai-loading">summarizing with local model…</div></div>';
      if (s && s.text) return `<div class="c-ai"><div class="ai-badge">local model · ${esc(s.model || 'ollama')}</div><div class="ai-text">${esc(s.text)}</div><button class="ai-btn" data-ai="summary">regenerate</button></div>`;
      if (s && s.error) return `<div class="c-ai"><div class="ai-err">${esc(s.error)}</div><button class="ai-btn" data-ai="summary">retry</button></div>`;
      return `<div class="c-ai"><button class="ai-btn" data-ai="summary">✦ summarize with local model</button></div>`;
    },
  },

  'ai-qa': {
    id: 'ai-qa',
    render(_node, data, { esc }) {
      const qa = (data.ai || {}).qa;
      const log = qa && qa.answer
        ? `<div class="ai-qa-a"><span class="ai-qa-q">${esc(qa.question)}</span>${qa.loading ? '<span class="ai-loading">thinking…</span>' : esc(qa.answer)}</div>`
        : (qa && qa.loading ? '<div class="ai-loading">thinking…</div>' : '');
      return `<div class="c-ai c-ai-qa">${log}<form class="ai-qa-form" data-ai="ask"><input class="ai-qa-in" placeholder="ask about this node…" /></form></div>`;
    },
  },

  // The property inspector: every real graph property of the node, in full. Prefers the
  // server's complete `props` bag (n{.*}); falls back to the node's own scalar/array keys
  // (skipping force-graph internals + app-derived signals) when props isn't present. No
  // caps, no truncation — arrays render as chips, booleans/dates formatted.
  keyvalue: {
    id: 'keyvalue',
    render(node, _data, { esc }) {
      const HIDE = new Set(['embedding', 'embedding_hash']);
      const DERIVED = new Set(['id', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'index', 'adj', '__threeObj',
        '__indexColor', 'props', 'r', 'rank', 'color', 'val', 'bornTime', 'neighbors', 'links',
        'degree', 'edgeCount', 'edges', 'rel_types', 'all_sources', 'notes', 'protected_facts',
        'retired_facts', 'source_count', 'sourceCount', 'embeddable', 'hasText', 'isTabular',
        'stale', 'superseded', 'sourceKind', 'filePath', 'label', 'labels', 'desc', 'chart']);
      const isRealVal = (v) => v == null ||
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ||
        (Array.isArray(v) && v.every((x) => x == null || typeof x !== 'object'));
      const bag = (node.props && typeof node.props === 'object')
        ? node.props
        : Object.fromEntries(Object.keys(node).filter((k) => !DERIVED.has(k) && isRealVal(node[k])).map((k) => [k, node[k]]));
      const has = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
      const keys = Object.keys(bag).filter((k) => !HIDE.has(k) && has(bag[k]));
      if (!keys.length) return '';
      const PRIO = ['name', 'title', 'summary', 'description', 'full_text', 'status', 'role', 'timeframe', 'tags'];
      keys.sort((a, b) => {
        const pa = PRIO.indexOf(a), pb = PRIO.indexOf(b);
        if (pa !== -1 || pb !== -1) return (pa === -1 ? 999 : pa) - (pb === -1 ? 999 : pb);
        return a.localeCompare(b);
      });
      const fmt = (v) => {
        if (Array.isArray(v)) return `<span class="kv-chips">${v.map((x) => `<span class="kv-chip">${esc(String(x))}</span>`).join('')}</span>`;
        if (typeof v === 'boolean') return `<span class="kv-bool kv-bool-${v}">${v}</span>`;
        return `<span class="kv-text">${esc(String(v))}</span>`;
      };
      const rows = keys.map((k) => `<div class="kv"><span class="kk">${esc(k)}</span><span class="kvv">${fmt(bag[k])}</span></div>`).join('');
      return `<div class="c-keyvalue">${rows}</div>`;
    },
  },
};

// ── dispatch: resolver order → registered renderers, skipping unbuilt ids ─────
// Returns [{ id, html }] for every resolved component that (a) has a renderer and
// (b) produced non-empty output for `view`. Resolver may name components not yet
// built (chart, map, ai-summary…) — those are silently skipped, never errors.
// `view` (from the VIEWS vocab) is threaded into each renderer's ctx so a component
// renders compact (inspector) or large (report) from the same data.
export function composeView(node = {}, data = {}, caps = {}, view = 'inspector', ctx = {}) {
  const helpers = { esc: ctx.esc || _esc, trunc: ctx.trunc || _trunc, caps, view: coerceView(view) };
  const ids = resolveLayout(node, caps);
  const out = [];
  for (const id of ids) {
    const comp = REGISTRY[id];
    if (!comp) continue;                       // resolved but not yet implemented
    const html = comp.render(node, data, helpers);
    if (html) out.push({ id, html });
  }
  return out;
}

// Back-compat thin wrapper — the inspector (slim peek) view.
export function composeInspector(node = {}, data = {}, caps = {}, ctx = {}) {
  return composeView(node, data, caps, 'inspector', ctx);
}

export { miniMarkdown };
