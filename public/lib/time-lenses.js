// time-lenses.js — the two read-only temporal views, extracted from app.js (app.js split):
//   initCalendar(deps) — the Activity heatmap (month grid over record time + intention dots).
//   initRoadmap(deps)  — the quarters x goals roadmap (project swimlanes, goal cards, milestones).
// Both are READ lenses (no writes): click an item -> open it in the graph. They import their own
// pure helpers and take the few app.js runtime refs via deps.
import { monthGrid, gridRange, bucketByDay, heatIntensity, stepMonth, monthLabel } from './calendar.js';
import { quarterAxis, placeItem, classifyStatus } from './roadmap.js';
import { dueLabel } from './registry.js';

// deps: { esc, rgba, colorOf, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData }
export function initCalendar({ esc, rgba, colorOf, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData }) {
  const overlay = document.getElementById('calendar');
  if (!overlay) return;
  const gridEl = document.getElementById('cal-grid'), titleEl = document.getElementById('cal-title'), dayEl = document.getElementById('cal-day');
  const KIND_RANK = { due: 0, review: 1, target: 2, expiry: 3, created: 4 };
  const KIND_LABEL = { due: 'due', review: 'review', target: 'goal date', expiry: 'expires', created: 'created' };
  let cur = null, bucket = {}, maxHeat = 0, selectedDay = null;
  const pad = (n) => String(n).padStart(2, '0');
  const thisMonth = () => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() + 1 }; };
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  async function load() {
    const { from, to } = gridRange(cur.year, cur.month);
    let items = [];
    try { items = (await fetch(`/api/calendar?from=${from}&to=${to}`).then((r) => r.json())).items || []; } catch (e) { /* ignore */ }
    bucket = bucketByDay(items);
    maxHeat = Math.max(0, ...Object.values(bucket).map((a) => a.filter((x) => x.kind === 'created').length));
    render();
  }
  function render() {
    titleEl.textContent = monthLabel(cur.year, cur.month);
    const today = isoToday();
    gridEl.innerHTML = monthGrid(cur.year, cur.month).flat().map((cell) => {
      const items = bucket[cell.date] || [];
      const heat = heatIntensity(items.filter((x) => x.kind === 'created').length, maxHeat);
      const dots = ['due', 'review', 'target', 'expiry']
        .filter((k) => items.some((x) => x.kind === k))
        .map((k) => `<i class="cal-dot cal-dot-${k}"></i>`).join('');
      const cls = ['cal-cell', cell.inMonth ? '' : 'out', `heat-${heat}`, cell.date === today ? 'today' : '', cell.date === selectedDay ? 'sel' : '']
        .filter(Boolean).join(' ');
      return `<button class="${cls}" data-date="${cell.date}"><span class="cal-d">${cell.day}</span><span class="cal-dots">${dots}</span></button>`;
    }).join('');
  }
  function showDay(date) {
    selectedDay = date; render();
    const items = (bucket[date] || []).slice().sort((a, b) => (KIND_RANK[a.kind] - KIND_RANK[b.kind]) || String(a.name || '').localeCompare(b.name || ''));
    if (!items.length) { dayEl.innerHTML = `<div class="cal-day-h">${esc(date)}</div><div class="cal-day-hint">nothing on this day</div>`; return; }
    dayEl.innerHTML = `<div class="cal-day-h">${esc(date)} · ${items.length}</div>` +
      items.map((it) => `<button class="cal-item" data-id="${esc(it.id)}" data-name="${esc(it.name || '')}" data-label="${esc(it.label || '')}">` +
        `<i class="rel-dot" style="background:${rgba(colorOf(it.label), 1)}"></i>` +
        `<span class="cal-item-n">${esc(it.name || '')}</span><span class="cal-item-k cal-k-${it.kind}">${KIND_LABEL[it.kind]}</span></button>`).join('');
  }
  function open() { pauseMainGraph(); overlay.hidden = false; cur = cur || thisMonth(); load(); }
  function close() { overlay.hidden = true; resumeMainGraph(); }

  gridEl.addEventListener('click', (e) => { const c = e.target.closest('[data-date]'); if (c) showDay(c.dataset.date); });
  dayEl.addEventListener('click', (e) => {
    const it = e.target.closest('.cal-item'); if (!it) return;
    close();
    // Open by id directly (selectNode fetches /api/node) — robust even for a low-degree
    // node outside the loaded graph subset, then nudge the graph toward it.
    selectNode({ id: it.dataset.id, name: it.dataset.name, label: it.dataset.label });
    refreshGraphData(it.dataset.name);
  });
  document.getElementById('cal-prev').onclick = () => { selectedDay = null; cur = stepMonth(cur.year, cur.month, -1); load(); };
  document.getElementById('cal-next').onclick = () => { selectedDay = null; cur = stepMonth(cur.year, cur.month, 1); load(); };
  document.getElementById('cal-today').onclick = () => { cur = thisMonth(); selectedDay = isoToday(); load().then(() => showDay(selectedDay)); };
  document.getElementById('cal-x').onclick = close;
  document.getElementById('set-calendar').onclick = () => (overlay.hidden ? open() : close());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
}

// deps: { esc, secCollapsed, secToggle, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData }
export function initRoadmap({ esc, secCollapsed, secToggle, pauseMainGraph, resumeMainGraph, selectNode, refreshGraphData }) {
  const overlay = document.getElementById('roadmap');
  if (!overlay) return;
  const grid = document.getElementById('rm-grid');
  const pad = (n) => String(n).padStart(2, '0');
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  let loaded = false;

  function goalCard(g, place) {
    const st = classifyStatus(g.status);
    const date = g.target_date || g.due_at;
    const tag = place.precision === 'exact' && date ? dueLabel(date, Date.now())
      : place.precision === 'tentative' ? '~ ' + (g.timeframe || 'someday') : '';
    return `<button class="rm-card st-${st}${place.precision === 'tentative' ? ' tentative' : ''}" ` +
      `data-id="${esc(g.id)}" data-name="${esc(g.name)}" title="${esc(g.name)}${g.status ? ' · ' + esc(g.status) : ''}">` +
      `<span class="rm-card-n">${esc(g.name)}</span>${tag ? `<span class="rm-card-d">${esc(tag)}</span>` : ''}</button>`;
  }

  let data = [];
  function render() {
    const now = new Date(), nowISO = isoToday();
    const axis = quarterAxis(now.getFullYear(), now.getMonth() + 1, { fwd: 4 });
    const span = axis.length + 1;   // gutter + quarters (for the milestone sub-row)
    grid.style.gridTemplateColumns = `184px 128px repeat(${axis.length}, minmax(116px, 1fr))`;
    let html = '<div class="rm-corner"></div><div class="rm-colh">Unscheduled</div>' +
      axis.map((c) => `<div class="rm-colh${c.isCurrent ? ' cur' : ''}">${esc(c.label)}</div>`).join('');
    for (const p of data) {
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
    grid.innerHTML = data.length ? html : '<div class="cal-day-hint" style="padding:16px">No goals with a project yet.</div>';
  }
  async function load() {
    try { data = (await fetch('/api/roadmap').then((r) => r.json())).projects || []; } catch (e) { data = []; }
    render();
  }
  function open() { pauseMainGraph(); overlay.hidden = false; if (!loaded) { loaded = true; load(); } }
  function close() { overlay.hidden = true; resumeMainGraph(); }

  grid.addEventListener('click', (e) => {
    const open2 = (id, name, label) => { close(); selectNode({ id, name, label }); refreshGraphData(name); };
    const card = e.target.closest('.rm-card[data-id]');
    if (card) return open2(card.dataset.id, card.dataset.name, 'Goal');
    const pill = e.target.closest('.rm-pill[data-id]');
    if (pill) return open2(pill.dataset.id, pill.dataset.name, 'Idea');
    const lane = e.target.closest('.rm-lane[data-pid]');
    if (lane) { secToggle('rmlane:' + lane.dataset.pid, true); render(); }
  });
  document.getElementById('rm-x').onclick = close;
  document.getElementById('set-roadmap').onclick = () => (overlay.hidden ? open() : close());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
}
