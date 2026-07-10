// voice-presence.js — the model's on-screen representation (VOICE; Rick 2026-07-04):
// deliberately NON-anthropomorphic. A small state glyph (css-animated ring/bars) plus,
// in Phase 2, subtitle windowing for the collapsed-pill strip. Pure: state in, html out.

// The closed state set. Transitions are the session's business; this is only the look.
export const PRESENCE_STATES = ['idle', 'listening', 'thinking', 'speaking'];

export const isPresenceState = (s) => PRESENCE_STATES.includes(s);

// One glyph, four dress codes: still ring / rippling ring / pulsing ring / waveform bars.
// All motion lives in styles.css keyed off vp-<state> (calm mode + data-anim="off" kill it).
export function renderGlyph(state = 'idle') {
  const s = isPresenceState(state) ? state : 'idle';
  const bars = s === 'speaking'
    ? '<span class="vp-bar"></span><span class="vp-bar"></span><span class="vp-bar"></span>'
    : '';
  return `<span class="vp-glyph vp-${s}" data-state="${s}" role="img" aria-label="assistant ${s}"><span class="vp-ring"></span>${bars}</span>`;
}

// The ORB — the assistant's primary on-screen presence (Rick, 2026-07-04, from the
// Jarvis-meets-Wispr-Flow direction): a circular visual bottom-right whose motion IS the
// state (breathing=idle, rippling=listening, orbiting arc=thinking, waveform=speaking).
// The chat window expands from and collapses back into it. Still deliberately
// non-anthropomorphic: geometry and motion, no face, no name.
export function renderOrb(state = 'idle', { away = false, noModel = false } = {}) {
  const s = isPresenceState(state) ? state : 'idle';
  const wave = s === 'speaking' ? '<span class="vo-wave"><i></i><i></i><i></i><i></i><i></i></span>' : '<span class="vo-core"></span>';
  // noModel mutes the orb (idle-only dress: an active state means a brain IS talking)
  const mute = noModel && s === 'idle' ? ' vo-nomodel' : '';
  return `<span class="vo-visual vo-${s}${away ? ' vo-away' : ''}${mute}" data-state="${s}" role="img" aria-label="assistant ${away ? 'active in another tab' : noModel && s === 'idle' ? 'no model loaded' : s}">
    <span class="vo-ring vo-r1"></span><span class="vo-ring vo-r2"></span><span class="vo-ring vo-r3"></span>${wave}
  </span>`;
}

// The orb's caption line: away beats everything; active states name themselves; idle
// shows who the brain is (model id), or says plainly that nothing is loaded.
export function orbCaption(state, { away = false, model = null, noModel = false } = {}) {
  if (away) return 'in another tab';
  if (state === 'listening' || state === 'thinking' || state === 'speaking') return state;
  if (noModel) return 'no model';
  return model || 'assistant';
}

// The orb's hover tooltip (title=). The no-model case teaches the mental model in one
// line: models load through Slipway, on purpose — the orb can't talk until one is up.
export function orbTitle({ away = false, model = null, noModel = false, reason = null } = {}) {
  if (away) return 'Voice is live in another tab';
  if (noModel) {
    return reason === 'no-slipway'
      ? 'Local runtime is down — Slipway (:8765) isn’t answering. It normally starts with the Studio.'
      : 'No model loaded — models are never loaded by default. Load one through Slipway to talk.';
  }
  return model ? `Talking to ${model} — click to open` : 'Assistant — click to open';
}

// The no-brain empty state — reason-aware, so the panel names the actual remedy.
// brain = /api/ai/ping's JSON: { available, reason?: 'no-slipway'|'no-model', selected? }.
// Models are NEVER loaded by default (Slipway idles at state 'stopped'), so 'no-model'
// is the normal morning state, not an error — the copy and the one-click load reflect that.
// Pure: brain in, view out — { reason, headline, hint, action: null | {kind:'load', model} }.
export function brainEmptyState(brain = {}) {
  if (brain.available) return null;
  if (brain.reason === 'no-model') {
    return {
      reason: 'no-model',
      headline: 'No model loaded',
      hint: 'Slipway is running but idle — models are never loaded until you ask.',
      action: brain.selected ? { kind: 'load', model: brain.selected } : { kind: 'load', model: null },
    };
  }
  return {
    reason: 'no-slipway',
    headline: 'Local runtime is down',
    hint: 'Slipway isn’t answering on :8765 — it normally starts with the Studio. Restart the Studio to bring it back up (SLIPWAY_AUTOSTART=0 disables that).',
    action: null,
  };
}

// Subtitle windowing (Phase 2 consumer): given the full text being spoken and the
// onboundary charIndex, return the sentence window around the playhead — what the
// collapsed-pill subtitle strip shows. Pure so vitest can pin the windowing rules.
export function subtitleWindow(text = '', charIndex = 0, { maxLen = 140 } = {}) {
  const t = String(text || '');
  if (!t) return '';
  const i = Math.max(0, Math.min(+charIndex || 0, t.length));
  // sentence bounds around the playhead (., !, ? or newline), falling back to the whole text
  const starts = [...t.slice(0, i).matchAll(/[.!?\n]\s+/g)];
  const start = starts.length ? starts[starts.length - 1].index + starts[starts.length - 1][0].length : 0;
  const endM = t.slice(i).match(/[.!?\n]/);
  const end = endM ? i + endM.index + 1 : t.length;
  let w = t.slice(start, end).trim();
  if (w.length > maxLen) {
    // keep the playhead visible: trim from the far side of wherever it sits
    const rel = i - start;
    w = rel > maxLen ? '…' + w.slice(rel - maxLen + 1, rel + 1) : w.slice(0, maxLen - 1) + '…';
  }
  return w;
}
