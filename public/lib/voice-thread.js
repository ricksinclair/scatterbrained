// voice-thread.js — pure conversation-thread state + rendering for the assistant panel
// (VOICE Phase 1). Same discipline as registry.js: pure functions in, html strings out;
// voice-ui.js owns the DOM. Message shapes (one array, append-only):
//   { kind:'msg',  role:'you'|'assistant', text, at, model?, interruptedAt? }
//   { kind:'ghost', text }                       — live interim STT transcript (at most one, last)
//   { kind:'card', panelId, panelKind, title, replyTo, html, collapsed }  — a dynamic panel
import { esc } from './dom.js';
import { renderCard } from './voice-panels.js';

export function addMessage(messages, { role, text, model = null, at = Date.now(), grounding = null }) {
  const t = String(text || '').trim();
  if (!t) return messages;
  const g = Array.isArray(grounding) && grounding.length ? grounding.filter((n) => n && n.id) : null;
  return [...dropGhost(messages), { kind: 'msg', role, text: t, model, at, ...(g && g.length ? { grounding: g } : {}) }];
}

// The interim STT line: replace-or-append so there is never more than one ghost,
// always last. Empty text clears it.
export function setGhost(messages, text) {
  const base = dropGhost(messages);
  const t = String(text || '').trim();
  return t ? [...base, { kind: 'ghost', text: t }] : base;
}
export const dropGhost = (messages) => messages.filter((m) => m.kind !== 'ghost');

// Mark the LAST assistant message as interrupted at a character boundary (Phase 2
// wires this to the barge-in; the renderer freezes the highlight there).
export function markInterrupted(messages, at) {
  const i = messages.map((m) => m.kind === 'msg' && m.role === 'assistant').lastIndexOf(true);
  if (i < 0) return messages;
  const next = messages.slice();
  next[i] = { ...next[i], interruptedAt: Math.max(0, Math.min(+at || 0, next[i].text.length)) };
  return next;
}

// The karaoke split — one mechanism, three consumers: live TTS highlight (voice-ui),
// the frozen interrupted bubble (below), and the collapsed-pill subtitle strip.
export const spokenSplitHtml = (text, at) =>
  `<span class="vt-spoken">${esc(text.slice(0, at))}</span><span class="vt-unspoken">${esc(text.slice(at))}</span>`;

// Query grounding (#2a): the evidence chips under an assistant bubble — the nodes the
// answer was grounded in. data-node rides the thread's existing click-to-navigate delegate.
export const groundingHtml = (grounding) => {
  if (!Array.isArray(grounding) || !grounding.length) return '';
  const chips = grounding.map((n) => `<button class="vt-gchip" data-node="${esc(n.id)}" title="${esc(n.label || '')}">${esc(n.name || n.id)}</button>`).join('');
  return `<div class="vt-ground"><span class="vt-ground-l">grounded in</span>${chips}</div>`;
};

const bubble = (m) => {
  const cut = m.interruptedAt != null;
  const body = cut ? spokenSplitHtml(m.text, m.interruptedAt) : esc(m.text);
  return `<div class="vt-row vt-${m.role}"><div class="vt-bubble${cut ? ' vt-cut' : ''}" ${m.at ? `data-at="${m.at}"` : ''}>${body}${cut ? '<span class="vt-cutmark">interrupted</span>' : ''}</div>${groundingHtml(m.grounding)}</div>`;
};

// Add (or replace) a dynamic panel card. One live card per assistant turn: a repeat
// show_panel while the last message is still a card replaces it; same panelId updates
// in place; otherwise it appends under the latest turn.
export function addCard(messages, { panelId, panelKind, title, replyTo = null, html, nodeId = null }) {
  const card = { kind: 'card', panelId, panelKind, title, replyTo, html, nodeId, collapsed: false };
  const i = messages.findIndex((m) => m.kind === 'card' && m.panelId === panelId);
  if (i >= 0) { const next = messages.slice(); next[i] = card; return next; }
  const base = dropGhost(messages);
  if (base.length && base[base.length - 1].kind === 'card') return [...base.slice(0, -1), card];
  return [...base, card];
}

// × collapses to a chip (the card stays in the thread — it is part of the record);
// clicking the chip re-expands.
export function toggleCard(messages, panelId) {
  return messages.map((m) => (m.kind === 'card' && m.panelId === panelId ? { ...m, collapsed: !m.collapsed } : m));
}

export const cardById = (messages, panelId) => messages.find((m) => m.kind === 'card' && m.panelId === panelId) || null;

// The last USER utterance before the newest message — the card header's "re:" linkage.
export function lastUtterance(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].kind === 'msg' && messages[i].role === 'you') return messages[i].text;
  }
  return null;
}

// render(messages) → inner html for the thread scroller.
export function renderThread(messages = []) {
  if (!messages.length) return '';
  return messages.map((m) => {
    if (m.kind === 'ghost') return `<div class="vt-row vt-you"><div class="vt-bubble vt-ghost">${esc(m.text)}<span class="vt-ellipsis">…</span></div></div>`;
    if (m.kind === 'card') return renderCard({ panelId: m.panelId, kind: m.panelKind, title: m.title, replyTo: m.replyTo, html: m.html, collapsed: m.collapsed });
    return bubble(m);
  }).join('');
}
