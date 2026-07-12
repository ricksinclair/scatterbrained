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
import { buildAgenda, itemsOnDay, AGENDA_BUCKETS, KIND_CHIP, dayView } from './agenda.js';
import { emptyState } from './empty-state.js';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoToday = () => iso(new Date());
const isoShift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };
const addDaysTo = (isoStr, n) => { const d = new Date(isoStr + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const dayHeadLabel = (isoStr) => new Date(isoStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function initTimeLens({ esc, rgba, colorOf, secCollapsed, secToggle, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData, requestClose,
  playheadDate, playheadLive, resetPlayhead, jumpPlayhead }) {
  const overlay = document.getElementById('time');
  if (!overlay) return { open() {}, close() {} };
  // The shared playhead (DESIGN-temporal §3.3): the Agenda + Day scope read AS OF the playhead's
  // date, so scrubbing the constellation to a past date shows that date's agenda/day. Falls back to
  // "now" when app.js didn't wire the playhead (defensive — keeps the lens working standalone).
  const playhead = () => (playheadDate ? playheadDate() : isoToday());
  const isPlayheadLive = () => (playheadLive ? playheadLive() : true);
  const exit = () => (requestClose ? requestClose() : close());
  // A "named stop" (DESIGN-temporal §2): jump the shared playhead to a date and drop to the
  // constellation as-of then — quarter starts, agenda days and history versions all rewind this way.
  const rewindTo = (iso) => { if (jumpPlayhead) jumpPlayhead(iso); exit(); };
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
  let agScope = 'soon';                      // 'soon' = digest buckets · 'day' = the hour rail
  let dayDate = null;                        // ISO day the Day scope shows (null → today at entry)

  async function loadAgenda() {
    dayFilter = null;                          // fresh visit = "now"; drop any stale day filter
    dayDate = null;                            // Day scope re-centers on today (reads the playhead)
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
      (r.recur ? `<span class="ag-recur" title="repeats ${esc(r.recur)}">↻ ${esc(r.recur)}</span>` : '') +
      `<span class="ag-d${r.bucket === 'overdue' ? ' warn' : ''}">${esc(r.dateLabel)}</span></button>`;
  }

  // Scope control (Soon | Day) — the zoom level of Agenda. Soon = digest buckets (now/soon);
  // Day = the hour rail for one day. A scope change, not a new tab (DESIGN-daily-view §3).
  const scopeControl = () =>
    '<div class="ag-scope" role="tablist" aria-label="agenda scope">' +
    ['soon', 'day'].map((s) =>
      `<button class="ag-scope-b${agScope === s ? ' on' : ''}" data-scope="${s}" role="tab" aria-selected="${agScope === s}">${s === 'soon' ? 'Soon' : 'Day'}</button>`).join('') +
    '</div>';
  function wireScope() {
    agEl.querySelectorAll('[data-scope]').forEach((b) => {
      b.onclick = () => { if (agScope === b.dataset.scope) return; agScope = b.dataset.scope; renderAgenda(); };
    });
  }
  function wireRows() {
    agEl.querySelectorAll('.ag-row').forEach((row) => {
      row.onclick = () => openNode(row.dataset.id, row.dataset.name, row.dataset.label);
    });
  }

  function renderAgenda() {
    if (agScope === 'day') { renderAgendaDayScope(); return; }
    if (dayFilter) { renderAgendaDay(); return; }
    const a = buildAgenda(agItems, playhead());   // AS OF the playhead (§3.3), not always today
    if (a.empty) { renderAgendaEmpty(); return; }
    agEl.innerHTML = scopeControl() + AGENDA_BUCKETS.filter((b) => a.buckets[b.key].length).map((b) =>
      `<section class="ag-bucket${b.warn ? ' warn' : ''}"><div class="ag-h">${esc(b.label)}` +
      `<span class="ag-count">${a.buckets[b.key].length}</span></div>` +
      a.buckets[b.key].map(agendaRowHtml).join('') + '</section>').join('');
    wireRows();
    wireScope();
    renderAgendaSide();
  }

  // Day scope: the hour rail for one day (default today; the mini-month + ‹/› retarget it).
  // Timed items sit under their hour, untimed ones in a "sometime today" tray. Reads dayView,
  // which expands recurrences onto their occurrence day. `dayDate` is playhead-ready — when
  // lib/timestate.js lands, this reads the shared playhead date instead of today.
  const dayRowHtml = (r) =>
    `<button class="ag-row" data-id="${esc(r.id)}" data-name="${esc(r.name || '')}" data-label="${esc(r.label || '')}">` +
    `<i class="rel-dot" style="background:${rgba(colorOf(r.label), 1)}"></i>` +
    (r.time ? `<span class="ag-rowtime">${esc(r.time)}</span>` : '') +
    `<span class="ag-n">${esc(r.name || '')}</span>` +
    `<span class="ag-chip cal-k-${esc(r.kind)}">${esc(r.chip)}</span></button>`;
  function renderAgendaDayScope() {
    const date = dayDate || playhead();          // default day = the playhead's date (scrub-aware)
    const d = dayView(agItems || [], date, isoToday());   // nowISO=real today → "today" tag only on the real today
    // The reset returns to the DEFAULT day (the playhead's own date), shown only when you've stepped
    // off it with ‹/› or the mini-month. Its label is the playhead date ("today" when live) — not a
    // bare "today", which would lie while the playhead is parked in the past.
    const head = '<div class="ag-dayscope-head">' +
      `<button class="ag-daynav" data-daystep="-1" aria-label="previous day">‹</button>` +
      `<span class="ag-dayscope-date">${esc(dayHeadLabel(date))}${d.isToday ? ' <span class="ag-dayscope-tag">today</span>' : ''}</span>` +
      `<button class="ag-daynav" data-daystep="1" aria-label="next day">›</button>` +
      (dayDate ? `<button class="ag-daytoday" data-daytoday>⟲ ${esc(isPlayheadLive() ? 'today' : dayHeadLabel(playhead()))}</button>` : '') +
      `<button class="ag-dayrewind" data-agrewind="${esc(date)}" title="rewind the graph to this day">⟲ rewind graph</button>` + '</div>';
    let body;
    if (d.empty) {
      body = `<div class="ag-rail"><div class="ag-hint">nothing scheduled for this day</div></div>`;
    } else {
      body = '<div class="ag-rail">' +
        d.slots.map((s) =>
          `<section class="ag-slot"><div class="ag-slot-h">${esc(s.label)}</div>` +
          s.rows.map(dayRowHtml).join('') + '</section>').join('') +
        (d.untimed.length
          ? `<section class="ag-slot ag-slot-untimed"><div class="ag-slot-h">sometime today</div>` +
            d.untimed.map(dayRowHtml).join('') + '</section>'
          : '') + '</div>';
    }
    agEl.innerHTML = scopeControl() + head + body;
    wireRows();
    wireScope();
    agEl.querySelectorAll('[data-daystep]').forEach((b) => {
      b.onclick = () => { dayDate = addDaysTo(date, Number(b.dataset.daystep)); renderAgenda(); };
    });
    const todayBtn = agEl.querySelector('[data-daytoday]');
    if (todayBtn) todayBtn.onclick = () => { dayDate = null; renderAgenda(); };
    const rw = agEl.querySelector('[data-agrewind]');
    if (rw) rw.onclick = () => rewindTo(rw.dataset.agrewind);
    renderAgendaSide();
  }

  // Day filter: clicking a mini-month cell narrows the agenda to that one day — every kind,
  // including 'created' activity (the buckets normally hide it). A clear ✕ chip sits above
  // the list; Esc clears it first (one step in the nav Esc stack before the lens closes).
  // The filter chip (clear ✕) sits beside a distinct ⟲ rewind (§3.4): filtering stays in the list,
  // rewinding moves the playhead — two clearly separate actions, never one overloaded click.
  const dayChip = (label, n) =>
    `<span class="ag-daychip-wrap"><button class="ag-daychip" data-agclear title="clear day filter">${esc(label)}` +
    `<span class="ag-daychip-n">${n}</span><span class="ag-daychip-x">✕</span></button>` +
    `<button class="ag-dayrewind" data-agrewind="${esc(label)}" title="rewind the graph to ${esc(label)}">⟲</button></span>`;
  const DAY_CHIP = { ...KIND_CHIP, created: 'created' };   // 'created' earns a chip only in the day view
  function renderAgendaDay() {
    const rows = itemsOnDay(agItems, dayFilter);
    const head = `<div class="ag-dayhead">${dayChip(dayFilter, rows.length)}</div>`;
    if (!rows.length) {
      agEl.innerHTML = scopeControl() + head + `<div class="ag-daylist"><div class="ag-hint">nothing on this day</div></div>`;
    } else {
      agEl.innerHTML = scopeControl() + head + '<div class="ag-daylist">' + rows.map((r) =>
        `<button class="ag-row" data-id="${esc(r.id)}" data-name="${esc(r.name || '')}" data-label="${esc(r.label || '')}">` +
        `<i class="rel-dot" style="background:${rgba(colorOf(r.label), 1)}"></i>` +
        `<span class="ag-n">${esc(r.name || '')}</span>` +
        `<span class="ag-chip cal-k-${esc(r.kind)}">${esc(DAY_CHIP[r.kind] || r.kind)}</span></button>`).join('') + '</div>';
      wireRows();
    }
    wireScope();
    agEl.querySelector('[data-agclear]').onclick = clearDayFilter;
    const rw = agEl.querySelector('[data-agrewind]');
    if (rw) rw.onclick = () => rewindTo(rw.dataset.agrewind);
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
    agEl.innerHTML = scopeControl() + `<div class="ag-empty">${emptyState(head)}` +
      undated.map((g) =>
        `<div class="ag-goal"><span class="ag-goal-n">${esc(g.name || '(unnamed)')}</span>` +
        `<label class="ag-set">set a date <input type="date" class="gp-date" data-agdate="${esc(g.id || '')}" aria-label="target date for ${esc(g.name || 'goal')}"></label></div>`).join('') +
      '</div>';
    wireScope();
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
    // Mark the active day: in Day scope that's the rail's date, in Soon scope the day filter.
    const activeDay = agScope === 'day' ? (dayDate || playhead()) : dayFilter;
    if (activeDay) { const sel = agSide.querySelector(`.agm-cell[data-date="${activeDay}"]`); if (sel) sel.classList.add('sel'); }
    agSide.querySelectorAll('.agm-cell').forEach((c) => {
      c.onclick = () => {
        if (agScope === 'day') {                 // Day scope: the mini-month picks which day the rail shows
          dayDate = c.dataset.date === playhead() ? null : c.dataset.date;   // the playhead's day = re-center
          renderAgenda();
          return;
        }
        // Soon scope — toggle: click the filtered day again to clear it.
        if (dayFilter === c.dataset.date) { clearDayFilter(); return; }
        dayFilter = c.dataset.date;
        renderAgenda();                        // re-renders the list AND re-paints the side (marks .sel)
      };
    });
  }

  // ── Quarters: the roadmap grid, re-hosted unchanged ────────────────────────
  const rmGrid = document.getElementById('rm-grid');
  let rmLoaded = false, rmData = [];
  function goalCard(g, place, nowMs) {
    const st = classifyStatus(g.status);
    const date = g.target_date || g.due_at;
    const tag = place.precision === 'exact' && date ? dueLabel(date, nowMs)
      : place.precision === 'tentative' ? '~ ' + (g.timeframe || 'someday') : '';
    return `<button class="rm-card st-${st}${place.precision === 'tentative' ? ' tentative' : ''}" ` +
      `data-id="${esc(g.id)}" data-name="${esc(g.name)}" title="${esc(g.name)}${g.status ? ' · ' + esc(g.status) : ''}">` +
      `<span class="rm-card-n">${esc(g.name)}</span>${tag ? `<span class="rm-card-d">${esc(tag)}</span>` : ''}</button>`;
  }
  function renderRoadmap() {
    // AS OF the playhead (§3.3): the axis centers the playhead's quarter and exact-date labels are
    // relative to it, so scrubbing to a past date shows that date's roadmap, not always today's.
    const nowISO = playhead();
    const [ry, rm] = nowISO.split('-').map(Number);
    const nowMs = Date.parse(nowISO + 'T00:00:00');
    const axis = quarterAxis(ry, rm, { fwd: 4 });
    const span = axis.length + 1;   // gutter + quarters (for the milestone sub-row)
    rmGrid.style.gridTemplateColumns = `184px 128px repeat(${axis.length}, minmax(116px, 1fr))`;
    // Each quarter header carries a ⟲ rewind (§3.2): jump the playhead to the quarter start.
    let html = '<div class="rm-corner"></div><div class="rm-colh">Unscheduled</div>' +
      axis.map((c) => `<div class="rm-colh${c.isCurrent ? ' cur' : ''}">${esc(c.label)}` +
        `<button class="rm-rewind" data-qrewind="${esc(c.startISO)}" title="rewind the graph to ${esc(c.label)}">⟲</button></div>`).join('');
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
        (place.colKey && cells[place.colKey] ? cells[place.colKey] : cells.gutter).push(goalCard(g, place, nowMs));
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
    const rewind = e.target.closest('[data-qrewind]');   // §3.2: quarter header ⟲ → rewind + drop to graph
    if (rewind) { e.stopPropagation(); return rewindTo(rewind.dataset.qrewind); }
    const card = e.target.closest('.rm-card[data-id]');
    if (card) return openNode(card.dataset.id, card.dataset.name, 'Goal');
    const pill = e.target.closest('.rm-pill[data-id]');
    if (pill) return openNode(pill.dataset.id, pill.dataset.name, 'Idea');
    const lane = e.target.closest('.rm-lane[data-pid]');
    if (lane) { secToggle('rmlane:' + lane.dataset.pid, true); renderRoadmap(); }
  });

  // Lens-head "as of {date}" pill (DESIGN-temporal §2): when the playhead is parked in the past,
  // the lens honestly labels that it's showing an earlier date, with a ⟲ now reset that snaps the
  // constellation back to live AND re-reads the lens. Hidden when live (today's behavior, unchanged).
  const asOfEl = document.getElementById('tl-asof');
  function renderAsOfPill() {
    if (!asOfEl) return;
    if (isPlayheadLive()) { asOfEl.hidden = true; asOfEl.innerHTML = ''; return; }
    asOfEl.hidden = false;
    asOfEl.innerHTML = `as of ${esc(dayHeadLabel(playhead()))} <button class="lh-asof-now" data-asof-now title="return to now">⟲ now</button>`;
    asOfEl.querySelector('[data-asof-now]').onclick = () => {
      if (resetPlayhead) resetPlayhead();       // snap the constellation + timebar back to live
      dayDate = null; dayFilter = null;         // the lens re-centers on the new (live) playhead
      renderAsOfPill();
      if (curTab === 'agenda') loadAgenda(); else if (curTab === 'roadmap') renderRoadmap();
    };
  }

  // ── Tab plumbing + the lens contract (nav owns WHO is open; this owns WHAT shows) ──
  function setTab(tab) {
    curTab = TABS.includes(tab) ? tab : 'agenda';
    overlay.querySelectorAll('.lh-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === curTab));
    TABS.forEach((t) => { const b = bodyOf(t); if (b) b.hidden = t !== curTab; });
    document.getElementById('tl-ctl-roadmap').hidden = curTab !== 'roadmap';
    renderAsOfPill();                                                          // reflect the playhead each visit
    if (curTab === 'agenda') loadAgenda();                                     // fresh each visit — reads the playhead
    else if (curTab === 'roadmap') { if (!rmLoaded) { rmLoaded = true; loadRoadmap(); } else renderRoadmap(); }  // re-place vs the current playhead
  }
  function open(tab) { pauseMainGraph(); overlay.hidden = false; setTab(tab); }
  function close() { overlay.hidden = true; resumeMainGraph(); }
  // escStep(): Esc unwinds one Agenda layer before the nav Esc stack closes the lens —
  // first the Day scope back to Soon, then an active mini-month day filter. Returns
  // true when it consumed the key.
  function escStep() {
    if (curTab !== 'agenda') return false;
    if (agScope === 'day') { agScope = 'soon'; dayDate = null; renderAgenda(); return true; }
    return clearDayFilter();
  }
  // close/Escape/tab-click wiring lives in app.js (nav + the shared lens-head)
  return { open, close, escStep };
}
