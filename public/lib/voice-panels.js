// voice-panels.js — pure renderers for the assistant's dynamic panels (VOICE Phase 5).
// Cards render INLINE in the conversation thread under the assistant turn that produced
// them; bodies come from the same registry renderers the inspector uses (composeView,
// view:'panel') filtered to the closed voice-panel set — the model composes ids, never
// HTML. Agenda/search are panel KINDS (list surfaces), not per-node registry components,
// so their small bodies live here.
import { esc, trunc } from './dom.js';
import { composeView, REGISTRY } from './registry.js';
import { SETS } from './sets.js';

export const PANEL_ALLOWED = [...SETS['voice-panel']];

const BUCKETS = [['overdue', 'Overdue'], ['today', 'Today'], ['this_week', 'This week'], ['upcoming', 'Upcoming']];

export function renderAgendaBody(digest = {}) {
  const due = digest.due || {};
  const secs = BUCKETS.map(([key, label]) => {
    const items = due[key] || [];
    if (!items.length) return '';
    const rows = items.slice(0, 12).map((r) =>
      `<div class="vpn-row" data-node="${esc(r.id || '')}"><span class="vpn-name">${esc(r.name)}</span><span class="vpn-chip">${esc(r.label)}</span><span class="vpn-date${key === 'overdue' ? ' vpn-late' : ''}">${esc(r.kind === 'review' ? 'review' : 'due')} ${esc(r.date)}</span></div>`).join('');
    const more = items.length > 12 ? `<div class="vpn-more">+${items.length - 12} more</div>` : '';
    return `<div class="vpn-sec"><div class="vpn-sec-t${key === 'overdue' ? ' vpn-late' : ''}">${label}</div>${rows}${more}</div>`;
  }).join('');
  return secs || '<div class="vpn-empty">Nothing due or up for review in the next 30 days.</div>';
}

// The day-view hour rail as a voice-panel body: timed items under their hour, an untimed tray,
// from the same voiceToday payload get_briefing scope:'today' returns ({date, slots:[{label,items}],
// untimed}). The spoken answer and the on-screen Day view render the same rows.
export function renderTodayBody(day = {}) {
  const row = (it) =>
    `<div class="vpn-row" data-node="${esc(it.id || '')}">` +
    (it.time ? `<span class="vpn-time">${esc(it.time)}</span>` : '') +
    `<span class="vpn-name">${esc(it.name)}</span><span class="vpn-chip">${esc(it.kind || it.label || '')}</span></div>`;
  const slots = (day.slots || []).map((s) =>
    `<div class="vpn-sec"><div class="vpn-sec-t">${esc(s.label)}</div>${(s.items || []).map(row).join('')}</div>`).join('');
  const tray = (day.untimed || []).length
    ? `<div class="vpn-sec"><div class="vpn-sec-t">sometime today</div>${day.untimed.map(row).join('')}</div>` : '';
  return (slots + tray) || '<div class="vpn-empty">Nothing left on today’s schedule.</div>';
}

export function renderSearchBody(results = []) {
  if (!results.length) return '<div class="vpn-empty">No matches.</div>';
  return results.slice(0, 12).map((r) =>
    `<div class="vpn-row" data-node="${esc(r.id)}"><span class="vpn-name">${esc(r.name)}</span><span class="vpn-chip">${esc(r.label)}</span>${r.superseded ? '<span class="vpn-date vpn-late">superseded</span>' : ''}</div>`).join('');
}

// Viz body: the chart arrives already resolved + validated from the server (spec run/derived there).
// The registry `chart` component does the drawing — same renderer the inspector/report/export use.
export function renderVizBody(chart, rowCount) {
  if (!chart) return '<div class="vpn-empty">Nothing to chart.</div>';
  const body = REGISTRY.chart.render({}, { chart }, { esc, trunc, caps: {}, view: 'panel' });
  if (!body) return '<div class="vpn-empty">Nothing to chart.</div>';
  const foot = rowCount != null ? `<div class="vpn-viz-foot">${rowCount} row${rowCount === 1 ? '' : 's'}</div>` : '';
  return `<div class="vpn-viz">${body}${foot}</div>`;
}

// Node bodies: the registry does the work. An EXPLICIT components list renders those
// exact components (client-side re-check against the closed set — defense in depth on
// top of the server validator), bypassing the resolver: the agent asked for them, and a
// renderer with nothing to say returns '' anyway. No list → the resolver's own order,
// filtered to the set.
export function renderNodeBody(signals, data, components = null) {
  let parts;
  if (components && components.length) {
    const helpers = { esc, trunc, caps: {}, view: 'panel' };
    parts = components.filter((c) => PANEL_ALLOWED.includes(c) && REGISTRY[c])
      .map((id) => ({ id, html: REGISTRY[id].render(signals, data, helpers) }))
      .filter((p) => p.html);
  } else {
    parts = composeView(signals, data, {}, 'panel').filter((p) => PANEL_ALLOWED.includes(p.id));
  }
  return parts.map((p) => `<div class="vpn-comp">${p.html}</div>`).join('') || '<div class="vpn-empty">Nothing to show for this node.</div>';
}

const KIND_ICON = { agenda: '◷', today: '☀', node: '◉', search: '⌕', viz: '◔' };

// The card wrapper (open state) and its collapsed chip. `replyTo` ties the card to the
// utterance that produced it; positional placement under the assistant turn does the rest.
export function renderCard({ panelId, kind, title, replyTo, html, collapsed }) {
  if (collapsed) {
    return `<div class="vt-row vt-assistant"><button class="vpn-chip-card" data-panel-toggle="${esc(panelId)}">${KIND_ICON[kind] || '▣'} ${esc(title)} <span class="vpn-chip-hint">show</span></button></div>`;
  }
  return `<div class="vt-row vt-assistant"><div class="vpn-card" data-panel="${esc(panelId)}">
    <div class="vpn-head">
      <span class="vpn-icon">${KIND_ICON[kind] || '▣'}</span>
      <span class="vpn-title">${esc(title)}</span>
      ${replyTo ? `<span class="vpn-reply">re: “${esc(replyTo)}”</span>` : ''}
      <span class="vpn-grow"></span>
      <button class="vpn-act" data-panel-open="${esc(panelId)}" title="open the full view">↗</button>
      <button class="vpn-act" data-panel-toggle="${esc(panelId)}" title="collapse">×</button>
    </div>
    <div class="vpn-body">${html}</div>
  </div></div>`;
}
