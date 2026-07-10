// voice-session.js — the voice loop's state machine (VOICE Phase 3). One active agent
// session; the listen loop is a RENDEZVOUS between two HTTP clients that both talk to
// server.js: the browser (POST /api/voice/utterance, /api/voice/say-done) and the MCP
// agent (voice_listen long-poll, voice_say). The pending-promise state lives here —
// which is exactly why the MCP endpoint must be in-process with the Studio server.
//
// States (docs/plan): idle → connected → listening ⇄ thinking ⇄ speaking, with
// speaking --barge-in--> interrupted (the parked say resolves {interrupted, spoken_chars},
// the barge-in utterance becomes the next listen result). Timers are injectable so
// vitest fake-timers can drive every path.

import crypto from 'node:crypto';

const QUEUE_CAP = 20;
export const STALE_MS = 60000;
export const LISTEN_DEFAULT_S = 25;
// 270s ≈ the idle sweet spot for a subscription-billed MCP agent: just inside the
// Anthropic prompt-cache TTL (~5min), so every idle re-poll is a cache-warm read —
// ~13 cheap calls/hour instead of 144 at the 25s default. The protocol tells the agent
// to escalate toward this after consecutive timeouts. (you, 2026-07-04: keep the
// Claude sub session waiting without blowing through limits.)
export const LISTEN_MAX_S = 270;
export const LISTEN_IDLE_S = 240;

// The dead-tab guard for a parked voice_say: generous enough for real TTS — including
// the slowest settings rate (0.8×, ~85ms/char spoken) — bounded so a closed browser
// can't hang the agent's tool call.
export const sayAckBudgetMs = (text) => Math.min(10000 + String(text || '').length * 90, 90000);

export function createVoiceSession({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onEvent = () => {} } = {}) {
  let agent = null;          // { sessionId, model, personaName, connectedAt, lastSeenAt }
  let queue = [];            // [{ text, source, interrupted, at, ui }]
  let pendingListen = null;  // { sessionId, resolve, timer }
  let pendingSay = null;     // { sessionId, msgId, text, resolve, timer }
  const touched = new Map(); // nodeId → { name, label } (provenance, Phase 6)
  // Turn-scoped evidence (query grounding): the nodes the AGENT consulted since the
  // user's utterance was DELIVERED to it. Rides the say event so the UI can light up
  // the subgraph an answer came from. Distinct from `touched` (whole-session provenance)
  // and deliberately excludes the utterance's ui context — what the USER was looking at
  // is not evidence the assistant consulted.
  const GROUNDING_CAP = 12;
  let turnTouched = new Map();
  const grounding = () => [...turnTouched.entries()].slice(0, GROUNDING_CAP).map(([id, m]) => ({ id, ...m }));

  const seen = () => { if (agent) agent.lastSeenAt = now(); };
  const settleListen = (result) => {
    if (!pendingListen) return;
    const p = pendingListen; pendingListen = null;
    clearTimer(p.timer);
    p.resolve(result);
    onEvent('listen-state', { listening: false });
  };
  const settleSay = (result) => {
    if (!pendingSay) return;
    const p = pendingSay; pendingSay = null;
    clearTimer(p.timer);
    p.resolve(result);
  };

  return {
    // ── agent lifecycle ─────────────────────────────────────────────────────────
    connect({ model, persona_name } = {}) {
      const superseded = !!agent;
      settleListen({ kind: 'superseded' });
      settleSay({ ok: true, interrupted: true, spoken_chars: 0 });
      agent = {
        sessionId: crypto.randomUUID(),
        model: String(model || 'unknown').slice(0, 120),
        personaName: persona_name ? String(persona_name).slice(0, 60) : null,
        connectedAt: now(), lastSeenAt: now(),
      };
      turnTouched = new Map();   // a fresh brain inherits no prior turn's evidence
      onEvent('agent', { state: 'connected', model: agent.model });
      return { sessionId: agent.sessionId, superseded };
    },
    disconnect(sessionId) {
      if (!agent || agent.sessionId !== sessionId) return { ok: false };
      settleListen({ kind: 'superseded' });
      settleSay({ ok: true, interrupted: true, spoken_chars: 0 });
      agent = null; queue = [];
      onEvent('agent', { state: 'idle' });
      return { ok: true };
    },
    // The user switched brains — same teardown as a goodbye, different narrator.
    switchLocal() { return this.disconnect(agent && agent.sessionId); },
    isActive: (sessionId) => !!agent && agent.sessionId === sessionId,

    status() {
      if (!agent) return { connected: false };
      const stale = !pendingListen && now() - agent.lastSeenAt > STALE_MS;
      return { connected: true, model: agent.model, personaName: agent.personaName, stale, listening: !!pendingListen, speaking: !!pendingSay };
    },

    // ── the rendezvous ──────────────────────────────────────────────────────────
    // Browser side: an utterance arrives. Resolves a parked listen, else queues.
    // Returns where it went so the caller can route ('agent') or fall back ('none').
    utterance({ text, source = 'text', interrupted = false, ui = null } = {}) {
      if (!agent) return { routed: 'none' };
      const u = { kind: 'utterance', text: String(text || '').slice(0, 4000), source, interrupted: !!interrupted, at: now(), ui: ui || undefined };
      if (ui && ui.selected_node_id) touched.set(ui.selected_node_id, { name: ui.selected_node_name || null, label: ui.selected_node_label || null });
      if (pendingListen) { turnTouched = new Map(); settleListen(u); }   // delivery starts the turn — evidence resets
      else { queue.push(u); if (queue.length > QUEUE_CAP) queue.shift(); }
      return { routed: 'agent' };
    },
    // Agent side: park until an utterance, a timeout, or supersession.
    listen(sessionId, { timeoutS = LISTEN_DEFAULT_S } = {}) {
      if (!agent || agent.sessionId !== sessionId) return Promise.resolve({ kind: 'superseded' });
      seen();
      if (queue.length) { turnTouched = new Map(); return Promise.resolve(queue.shift()); }   // queued delivery also starts the turn
      return new Promise((resolve) => {
        settleListen({ kind: 'superseded' });          // an agent re-poll replaces its old park
        const t = Math.max(1, Math.min(Number(timeoutS) || LISTEN_DEFAULT_S, LISTEN_MAX_S));
        pendingListen = { sessionId, resolve, timer: setTimer(() => settleListen({ kind: 'timeout' }), t * 1000) };
        onEvent('listen-state', { listening: true });
      });
    },
    // Agent side: speak. Parks until the browser acks (say-done) or the budget lapses.
    say(sessionId, { text } = {}) {
      if (!agent || agent.sessionId !== sessionId) return Promise.resolve({ error: 'not connected' });
      const t = String(text || '').trim().slice(0, 4000);
      if (!t) return Promise.resolve({ error: 'text required' });
      if (pendingSay) return Promise.resolve({ error: 'already_speaking' });
      seen();
      const msgId = crypto.randomUUID();
      const evidence = grounding();   // snapshot per say; the turn keeps accumulating until the next delivery
      return new Promise((resolve) => {
        pendingSay = { sessionId, msgId, text: t, resolve, timer: setTimer(() => settleSay({ ok: true, spoken: false, reason: 'no_ack' }), sayAckBudgetMs(t)) };
        onEvent('say', { msg_id: msgId, text: t, model: agent.model, ...(evidence.length ? { grounding: evidence } : {}) });
      });
    },
    // Browser side: the TTS outcome for a spoken message.
    sayDone({ msg_id, interrupted = false, spoken_chars = 0, reason = null } = {}) {
      if (!pendingSay || pendingSay.msgId !== msg_id) return { ok: false };
      if (interrupted) settleSay({ ok: true, interrupted: true, spoken_chars: Math.max(0, Math.min(+spoken_chars || 0, pendingSay.text.length)) });
      else if (reason) settleSay({ ok: true, spoken: false, reason: String(reason).slice(0, 40) });
      else settleSay({ ok: true, spoken: true });
      return { ok: true };
    },

    // ── provenance breadcrumbs (consumed by Phase 6 capture + turn grounding) ───
    touch(nodeId, meta = {}) {
      if (nodeId) {
        const m = { name: meta.name || null, label: meta.label || null };
        touched.set(String(nodeId), m);
        turnTouched.set(String(nodeId), m);
      }
      seen();
    },
    touchedNodes: () => [...touched.entries()].map(([id, m]) => ({ id, ...m })),
  };
}
