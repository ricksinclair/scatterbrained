// time-lenses.js — the ONE Time lens (D1): Agenda | Quarters behind the shared lens-head,
// in the single `#time` overlay (merges the old calendar + roadmap overlays).
//   Agenda (default, #time/agenda) — digest.js's tested buckets finally rendered: Overdue /
//     Today / This week / Upcoming rows + a CLICKABLE mini-month (heat) + a created-per-day
//     sparkline. Clicking a day filters the agenda to that day (with a clear chip); Esc
//     clears the day-filter before it closes the lens.
//   Quarters (#time/roadmap) — the quarters × goals roadmap grid, re-hosted unchanged.
// (The standalone Month grid was retired 2026-07-02 — the mini-month absorbed its one job.)
// A READ lens (the one write is the empty state's per-goal "set a date" → the existing
// /api/goal/target-date setter). Click an item → open it in the graph via selectNode.
// deps: { esc, rgba, colorOf, secCollapsed, secToggle, pauseMainGraph, resumeMainGraph,
//         selectNode, refreshGraphData, requestClose }
//   requestClose() — ask the nav state machine to close this lens (C2) so navState/hash
//   never desync; nav calls back into close().

import { monthGrid, bucketByDay, heatIntensity, monthLabel } from './calendar.js';
import { quarterAxis, placeItem, classifyStatus } from './roadmap.js';
import { dueLabel } from './registry.js';
import { buildAgenda, itemsOnDay, AGENDA_BUCKETS, KIND_CHIP } from './agenda.js';
import { emptyState } from './empty-state.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoToday = () => iso(new Date());
const isoShift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };

export function initTimeLens({ esc, rgba, colorOf, secCollapsed, secToggle, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData, requestClose }) {
  const overlay = document.getElementById('time');
  if (!overlay) return { open() {}, close() {} };
  const exit = () => (requestClose ? requestClose() : close());
  // open a node from any tab: leave the lens, inspect it, nudge the graph toward it
  const openNode = (id, name, label) => { exit(); selectNode({ id, name, label }); refreshGraphData(name); };

  const TABS = ['agenda', 'roadmap'];
  const bodyOf = (t) => document.getElementById('time-' + t + '-body');
  let curTab = null;

  // ── Agenda (default): the digest buckets, rendered ─────────────────────────
  const agEl = document.getElementById('ag-buckets');
  const agSide = document.getElementById('ag-side');
  const AG_BACK = 180, AG_FWD = 30;          // overdue lookback · digest horizon (days)
  let agItems = null;                        // last /api/calendar payload (drives all panels)
  let dayFilter = null;                      // ISO day the mini-month is filtering to (null = off)

  async function loadAgenda() {
    dayFilter = null;                          // fresh visit = "now"; drop any stale day filter
    agEl.innerHTML = '<div class="ag-hint">loading…</div>';
    let items;
    try {
      const r = await fetch(`/api/calendar?from=${isoShift(-AG_BACK)}&to=${isoShift(AG_FWD)}`);
      if (!r.ok) throw new Error('http ' + r.status);
      items = (await r.json()).items || [];
    } catch (e) {
      // A dead graph shouldn't render as a silently empty agenda — say so, offer retry.
      agEl.innerHTML = '<div class="ag-error">' + emptyState({
        title: 'Couldn’t load the agenda',
        body: 'The graph didn’t answer — is Neo4j up?',
        action: { label: 'Retry' },              // no cmd: wired locally, right below
      }) + '</div>';
      agEl.querySelector('.es-action').onclick = loadAgenda;
      agSide.hidden = true;
      return;
    }
    agItems = items;
    renderAgenda();
  }

  function agendaRowHtml(r) {
    return `<button class="ag-row" data-id="${esc(r.id)}" data-name="${esc(r.name)}" data-label="${esc(r.label)}" data-date="${esc(r.date)}">` +
      `<i class="rel-dot" style="background:${rgba(colorOf(r.label), 1)}"></i>` +
      `<span class="ag-n">${esc(r.name)}</span>` +
      `<span class="ag-chip cal-k-${esc(r.kind)}">${esc(r.chip)}</span>` +
      `<span class="ag-d${r.bucket === 'overdue' ? ' warn' : ''}">${esc(r.dateLabel)}</span></button>`;
  }

  function renderAgenda() {
    if (dayFilter) { renderAgendaDay(); return; }
    const a = buildAgenda(agItems, isoToday());
    if (a.empty) { renderAgendaEmpty(); return; }
    agEl.innerHTML = AGENDA_BUCKETS.filter((b) => a.buckets[b.key].length).map((b) =>
      `<section class="ag-bucket${b.warn ? ' warn' : ''}"><div class="ag-h">${esc(b.label)}` +
      `<span class="ag-count">${a.buckets[b.key].length}</span></div>` +
      a.buckets[b.key].map(agendaRowHtml).join('') + '</section>').join('');
    agEl.querySelectorAll('.ag-row').forEach((row) => {
      row.onclick = () => openNode(row.dataset.id, row.dataset.name, row.dataset.label);
    });
    renderAgendaSide();
  }

  // Day filter: clicking a mini-month cell narrows the agenda to that one day — every kind,
  // including 'created' activity (the buckets normally hide it). A clear ✕ chip sits above
  // the list; Esc clears it first (one step in the nav Esc stack before the lens closes).
  const dayChip = (label, n) =>
    `<button class="ag-daychip" data-agclear title="clear day filter">${esc(label)}` +
    `<span class="ag-daychip-n">${n}</span><span class="ag-daychip-x">✕</span></button>`;
  const DAY_CHIP = { ...KIND_CHIP, created: 'created' };   // 'created' earns a chip only in the day view
  function renderAgendaDay() {
    const rows = itemsOnDay(agItems, dayFilter);
    const head = `<div class="ag-dayhead">${dayChip(dayFilter, rows.length)}</div>`;
    if (!rows.length) {
      agEl.innerHTML = head + `<div class="ag-daylist"><div class="ag-hint">nothing on this day</div></div>`;
    } else {
      agEl.innerHTML = head + '<div class="ag-daylist">' + rows.map((r) =>
        `<button class="ag-row" data-id="${esc(r.id)}" data-name="${esc(r.name || '')}" data-label="${esc(r.label || '')}">` +
        `<i class="rel-dot" style="background:${rgba(colorOf(r.label), 1)}"></i>` +
        `<span class="ag-n">${esc(r.name || '')}</span>` +
        `<span class="ag-chip cal-k-${esc(r.kind)}">${esc(DAY_CHIP[r.kind] || r.kind)}</span></button>`).join('') + '</div>';
      agEl.querySelectorAll('.ag-row').forEach((row) => {
        row.onclick = () => openNode(row.dataset.id, row.dataset.name, row.dataset.label);
      });
    }
    agEl.querySelector('[data-agclear]').onclick = clearDayFilter;
    renderAgendaSide();
  }
  function clearDayFilter() {
    if (!dayFilter) return false;
    dayFilter = null;
    agSide.querySelectorAll('.agm-cell.sel').forEach((x) => x.classList.remove('sel'));
    renderAgenda();
    return true;                              // told the Esc stack it consumed the key
  }

  // Empty state: the graph's own insight — goals go unused because nothing prompts a date.
  // Offer the fix inline: each undated goal gets a date input → the existing target-date setter.
  async function renderAgendaEmpty() {
    agSide.hidden = true;
    let goals = [];
    try { goals = ((await fetch('/api/pulse').then((r) => r.json())).goals || []); } catch (e) { /* copy degrades below */ }
    const undated = goals.filter((g) => !g.target_date);
    const head = undated.length
      ? { title: 'Nothing scheduled.', body: `Your ${undated.length} goal${undated.length !== 1 ? 's have' : ' has'} no target date${undated.length !== 1 ? 's' : ''} — a date is what turns a goal into an agenda.` }
      : { title: 'Nothing scheduled.', body: 'Set a due, review, or goal date on any node and it shows up here.' };
    agEl.innerHTML = `<div class="ag-empty">${emptyState(head)}` +
      undated.map((g) =>
        `<div class="ag-goal"><span class="ag-goal-n">${esc(g.name || '(unnamed)')}</span>` +
        `<label class="ag-set">set a date <input type="date" class="gp-date" data-agdate="${esc(g.id || '')}" aria-label="target date for ${esc(g.name || 'goal')}"></label></div>`).join('') +
      '</div>';
    agEl.querySelectorAll('[data-agdate]').forEach((di) => {
      di.onchange = async () => {
        if (!di.value) return;
        try {
          const r = await fetch('/api/goal/target-date', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: di.dataset.agdate, date: di.value }) }).then((x) => x.json());
          if (r.error) { di.title = r.error; return; }
          loadAgenda();                       // the goal now has a date → it belongs on the agenda
        } catch (e) { /* leave the input for another try */ }
      };
    });
  }

  // Right column: mini-month (this month's created-activity heat; click a day → scroll the
  // agenda to it) + a created-per-day sparkline over the last 30 days (inline SVG, currentColor).
  function renderAgendaSide() {
    agSide.hidden = false;
    const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1, today = isoToday();
    const created = bucketByDay((agItems || []).filter((x) => x.kind === 'created'));
    const dated = new Set((agItems || []).filter((x) => x.kind !== 'created').map((x) => String(x.date).slice(0, 10)));
    const max = Math.max(0, ...Object.values(created).map((a) => a.length));
    const cells = monthGrid(y, m).flat().map((c) => {
      const heat = heatIntensity((created[c.date] || []).length, max);
      const cls = ['agm-cell', c.inMonth ? '' : 'out', `heat-${heat}`, c.date === today ? 'today' : '', dated.has(c.date) ? 'has' : ''].filter(Boolean).join(' ');
      return `<button class="${cls}" data-date="${c.date}" title="${c.date}">${c.day}</button>`;
    }).join('');
    // sparkline: created count per day, last 30 days → one polyline
    const days = []; for (let i = 29; i >= 0; i--) days.push(isoShift(-i));
    const counts = days.map((d) => (created[d] || []).length);
    const peak = Math.max(1, ...counts);
    const pts = counts.map((c, i) => `${(i * (100 / 29)).toFixed(1)},${(26 - (c / peak) * 22).toFixed(1)}`).join(' ');
    agSide.innerHTML = `<div class="agm"><div class="agm-h">${esc(monthLabel(y, m))}</div>` +
      `<div class="agm-dow"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>` +
      `<div class="agm-grid">${cells}</div></div>` +
      `<div class="ag-spark"><svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">` +
      `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>` +
      `<div class="ag-spark-cap">created per day · 30d</div></div>`;
    if (dayFilter) { const sel = agSide.querySelector(`.agm-cell[data-date="${dayFilter}"]`); if (sel) sel.classList.add('sel'); }
    agSide.querySelectorAll('.agm-cell').forEach((c) => {
      c.onclick = () => {
        // Toggle: click the filtered day again to clear it.
        if (dayFilter === c.dataset.date) { clearDayFilter(); return; }
        dayFilter = c.dataset.date;
        renderAgenda();                        // re-renders the list AND re-paints the side (marks .sel)
      };
    });
  }

  // ── Quarters: the roadmap grid, re-hosted unchanged ────────────────────────
  const rmGrid = document.getElementById('rm-grid');
  let rmLoaded = false, rmData = [];
  function goalCard(g, place) {
    const st = classifyStatus(g.status);
    const date = g.target_date || g.due_at;
    const tag = place.precision === 'exact' && date ? dueLabel(date, Date.now())
      : place.precision === 'tentative' ? '~ ' + (g.timeframe || 'someday') : '';
    return `<button class="rm-card st-${st}${place.precision === 'tentative' ? ' tentative' : ''}" ` +
      `data-id="${esc(g.id)}" data-name="${esc(g.name)}" title="${esc(g.name)}${g.status ? ' · ' + esc(g.status) : ''}">` +
      `<span class="rm-card-n">${esc(g.name)}</span>${tag ? `<span class="rm-card-d">${esc(tag)}</span>` : ''}</button>`;
  }
  function renderRoadmap() {
    const now = new Date(), nowISO = isoToday();
    const axis = quarterAxis(now.getFullYear(), now.getMonth() + 1, { fwd: 4 });
    const span = axis.length + 1;   // gutter + quarters (for the milestone sub-row)
    rmGrid.style.gridTemplateColumns = `184px 128px repeat(${axis.length}, minmax(116px, 1fr))`;
    let html = '<div class="rm-corner"></div><div class="rm-colh">Unscheduled</div>' +
      axis.map((c) => `<div class="rm-colh${c.isCurrent ? ' cur' : ''}">${esc(c.label)}</div>`).join('');
    for (const p of rmData) {
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
    rmGrid.innerHTML = rmData.length ? html : '<div class="ag-hint" style="padding:16px">No goals with a project yet.</div>';
  }
  async function loadRoadmap() {
    try { rmData = (await fetch('/api/roadmap').then((r) => r.json())).projects || []; } catch (e) { rmData = []; }
    renderRoadmap();
  }
  rmGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.rm-card[data-id]');
    if (card) return openNode(card.dataset.id, card.dataset.name, 'Goal');
    const pill = e.target.closest('.rm-pill[data-id]');
    if (pill) return openNode(pill.dataset.id, pill.dataset.name, 'Idea');
    const lane = e.target.closest('.rm-lane[data-pid]');
    if (lane) { secToggle('rmlane:' + lane.dataset.pid, true); renderRoadmap(); }
  });

  // ── Tab plumbing + the lens contract (nav owns WHO is open; this owns WHAT shows) ──
  function setTab(tab) {
    curTab = TABS.includes(tab) ? tab : 'agenda';
    overlay.querySelectorAll('.lh-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === curTab));
    TABS.forEach((t) => { const b = bodyOf(t); if (b) b.hidden = t !== curTab; });
    document.getElementById('tl-ctl-roadmap').hidden = curTab !== 'roadmap';
    if (curTab === 'agenda') loadAgenda();                                     // fresh each visit — it's "now"
    else if (curTab === 'roadmap' && !rmLoaded) { rmLoaded = true; loadRoadmap(); }
  }
  function open(tab) { pauseMainGraph(); overlay.hidden = false; setTab(tab); }
  function close() { overlay.hidden = true; resumeMainGraph(); }
  // escStep(): Esc first clears an active mini-month day filter (returns true = consumed),
  // so it unwinds one visual layer before the nav Esc stack closes the whole lens.
  const escStep = () => (curTab === 'agenda' ? clearDayFilter() : false);
  // close/Escape/tab-click wiring lives in app.js (nav + the shared lens-head)
  return { open, close, escStep };
}
