// voice-ui.js — DOM wiring for the floating assistant panel (VOICE Phase 1: text chat;
// Phase 2: mic + TTS + barge-in + collapsed pill/subtitles; Phase 3 adds the MCP lane).
// Pattern: agents-ui.js — an init that receives deps and returns a tiny surface for
// app.js's dispatch(). Pure brains live in voice-thread/voice-presence/voice-providers;
// this file owns only the DOM and the interaction state machine.
//
// Barge-in (a hard requirement): while the assistant is SPEAKING, tapping the mic,
// pressing Escape or Space in the panel, typing, or sending all cancel TTS instantly;
// the bubble's highlight freezes at the last spoken char (the same number Phase 3
// reports to the MCP agent as spoken_chars).
import { addMessage, setGhost, markInterrupted, renderThread, spokenSplitHtml, addCard, toggleCard, cardById, lastUtterance } from './voice-thread.js';
import { renderGlyph, renderOrb, orbCaption, orbTitle, subtitleWindow, brainEmptyState } from './voice-presence.js';
import { esc } from './dom.js';
import { sttAvailable, createSTT, createRecorderSTT, createTTS, createServerTTS, pickVoice } from './voice-providers.js';
import { renderAgendaBody, renderTodayBody, renderSearchBody, renderNodeBody, renderVizBody } from './voice-panels.js';
import { deriveNodeView } from './node-view.js';
import { consentView, pickerOptions } from './model-consent.js';

export function initVoice({ getSelectedId = () => null, getUi = () => null, onNavigate = () => {}, onGrounding = () => {} } = {}) {
  const pop = document.getElementById('voice');
  const thread = document.getElementById('vc-thread');
  const input = document.getElementById('vc-input');
  const send = document.getElementById('vc-send');
  const glyphEl = document.getElementById('vc-glyph');
  const badge = document.getElementById('vc-model');
  const picker = document.getElementById('vc-picker');
  const empty = document.getElementById('vc-empty');
  const railBtn = document.getElementById('rail-assistant');
  const micBtn = document.getElementById('vc-mic');
  const muteBtn = document.getElementById('vc-mute');
  const orb = document.getElementById('voice-orb');
  const orbVisual = document.getElementById('vo-visual-wrap');
  const orbCap = document.getElementById('vo-caption');
  const sub = document.getElementById('voice-sub');

  // e2e/alt providers can pre-seed window.__voiceProviders = { stt, tts } — the seam.
  // Real runs prefer the local-TTS lane (Kokoro, British by default) when the server
  // reports it, falling back to Web Speech — same interface either way.
  const injected = window.__voiceProviders || {};
  let tts = injected.tts !== undefined ? injected.tts : createTTS();
  let serverVoices = null;           // /api/voice/tts/ping voices when the local lane is up
  const voicePref = () => localStorage.getItem('scatterbrained:voice:tts-voice') || null;
  if (injected.tts === undefined) {
    fetch('/api/voice/tts/ping').then((r) => r.json()).then((p) => {
      if (p.available) { serverVoices = p.voices; tts = createServerTTS({ voice: voicePref() || p.default }); }
    }).catch(() => { /* web speech stays */ });
    if (window.speechSynthesis) window.speechSynthesis.getVoices();   // warm the async voice list
  }
  let stt = null;                    // built lazily on first mic tap (permission prompt then)
  let sttLocal = false;              // the on-device whisper lane (Phase 9) — probed below
  let hasSTT = injected.stt !== undefined ? !!injected.stt : sttAvailable();
  if (injected.stt === undefined) {
    fetch('/api/voice/stt/ping').then((r) => r.json()).then((p) => {
      if (p.available) { sttLocal = true; hasSTT = true; paint(); }   // Firefox gains voice here
    }).catch(() => { /* web lane stays */ });
  }
  const ttsRate = () => Math.min(Math.max(parseFloat(localStorage.getItem('scatterbrained:voice:rate')) || 1, 0.8), 1.4);
  const openMic = () => localStorage.getItem('scatterbrained:voice:openmic') === '1';
  const pttKey = () => localStorage.getItem('scatterbrained:voice:ptt') || 'space';

  // ── one voice, many tabs: leader election (you, 2026-07-04 — a second open tab
  // doubled memory pressure). The Web Locks holder is the ONLY tab that speaks, listens,
  // or acks; others render read-only and take over automatically when the leader closes.
  let leader = !('locks' in navigator);   // ancient browser → behave as sole tab
  if (navigator.locks) {
    navigator.locks.request('scatterbrained-voice-leader', () => {
      leader = true; paint();
      return new Promise(() => {});       // hold the lock for this tab's lifetime
    });
  }

  let messages = [];
  let busy = false;
  let muted = localStorage.getItem('scatterbrained:voice:muted') === '1';
  let brain = { available: false, provider: null, model: null };
  let agent = { connected: false, model: null, stale: false };   // the MCP lane (SSE-fed)
  let localModel = null;             // explicit local pick (honored on Ollama only)
  let loadingModel = null;           // model id mid-load via the empty-state button
  // Everything Slipway COULD serve (with sizes), not just what's resident — /api/ai/ping
  // reports only the model in memory, so the picker could never offer a switch without this.
  let loadable = [];
  let speaking = null;               // { handle, text, msgId? } while TTS is running
  let wasInterrupted = false;        // barge-in happened → flag rides on the NEXT utterance
  let state = 'idle';
  const agentMode = () => agent.connected;

  const setState = (s) => {
    state = s;
    glyphEl.innerHTML = renderGlyph(s);
    paintOrb();
  };
  const paintOrb = () => {
    orb.hidden = !pop.hidden;                       // the orb IS the collapsed panel
    const noModel = !agent.connected && !brain.available;
    const view = {
      away: !leader, noModel, reason: brain.reason || null,
      model: agent.connected ? agent.model : brain.available ? brain.model : null,
    };
    orbVisual.innerHTML = renderOrb(state, view);
    orbCap.textContent = orbCaption(state, view);
    orb.title = orbTitle(view);                     // hover explains no-model (load via Slipway)
    if (pop.hidden === false || !speaking) sub.hidden = true;
  };
  const paint = () => {
    thread.innerHTML = renderThread(messages);
    thread.scrollTop = thread.scrollHeight;
    // Visible when there's nothing to talk to (even mid-thread — the remedy must never
    // disappear behind the conversation), or as the invitation before the first message.
    empty.hidden = !!messages.length && (brain.available || agent.connected);
    if (!empty.hidden) {
      // Reason-aware onboarding: 'Slipway idle, nothing loaded' and 'runtime down' need
      // different remedies, so say which one this is (pure copy from brainEmptyState) —
      // and for 'no-model', offer the remedy itself: one click loads the selected model.
      const es = brainEmptyState(brain);
      const short = (id) => String(id || '').split('/').pop();
      if (loadingModel) {
        empty.innerHTML = `<p><b>Loading ${esc(short(loadingModel))}…</b> — a local model load takes 15–60s. The orb wakes when it's ready.</p>`;
      } else if (es) {
        const btn = es.action && es.action.model
          ? `<button id="vc-load" class="vc-load" data-model="${esc(es.action.model)}">Load ${esc(short(es.action.model))}</button>`
          : '';
        empty.innerHTML = `<p><b>${esc(es.headline)}</b> — ${esc(es.hint)}</p>${btn}
           <a class="vc-alt" href="http://127.0.0.1:8765" target="_blank" rel="noopener">manage models in Slipway ↗</a>
           <p class="vc-alt">Or connect your own Claude session via Settings → copy connect command.</p>`;
      } else {
        empty.innerHTML = '<p>Talk to your graph — <b>hold Space</b> to speak (release to send), tap <b>talk</b> for hands-free, or type below.</p>';
      }
    }
    badge.textContent = agent.connected ? `agent · ${agent.model}${agent.stale ? ' · away' : ''}`
      : brain.available ? `${brain.provider} · ${brain.model}` : 'no model';
    badge.classList.toggle('vc-off', !agent.connected && !brain.available);
    badge.classList.toggle('vc-stale', !!agent.stale);
    micBtn.hidden = !hasSTT;
    const live = !!(stt && stt.active());
    micBtn.classList.toggle('vc-live', live);
    document.getElementById('vc-mic-l').textContent = live ? 'stop' : 'talk';
    micBtn.title = live ? 'Listening — click to stop' : 'Talk — click once to start listening, again to stop';
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.title = muted ? 'Voice replies off — click to unmute' : 'Voice replies on — click to mute';
    // The brain picker: the MCP agent (when connected) + EVERY loadable local model, resident
    // or not. Picking a non-resident one asks for consent, then loads it (see picker.onchange).
    const opts = pickerOptions({
      models: loadable,
      resident: brain.available ? (localModel || brain.model) : null,
      agent,
    });
    picker.innerHTML = opts.map((o) =>
      `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''}>${esc(o.label)}${o.resident === false ? ' — not loaded' : ''}</option>`).join('');
    picker.hidden = !opts.length;
    if (agent.connected) picker.value = 'agent';
    document.getElementById('vc-save').hidden = !messages.some((m) => m.kind === 'msg');
    // non-leader tabs are read-only for speech: no mic, no sends, honest placeholder
    input.disabled = !leader;
    send.disabled = !leader;
    micBtn.disabled = !leader;
    input.placeholder = leader ? 'ask about your projects…' : 'voice is live in another tab';
    paintChips();
    paintOrb();
  };

  // ── Model-load consent ───────────────────────────────────────────────────────
  // Loading weights is slow and memory-hungry, so it is ALWAYS an explicit full-screen
  // accept/decline — never a side effect of touching the picker. Resolves true on accept.
  const cDlg = document.getElementById('consent');
  const cConfirm = document.getElementById('mc-confirm');
  const cCancel = document.getElementById('mc-cancel');
  let closeConsent = null;           // set while open; also the "is open" flag

  function askConsent(model) {
    const row = loadable.find((m) => m.id === model) || { id: model };
    const v = consentView(row);
    document.getElementById('mc-title').textContent = v.title;
    document.getElementById('mc-model').textContent = v.id;
    document.getElementById('mc-body').textContent = v.body;
    const warn = document.getElementById('mc-warn');
    warn.textContent = v.warning || '';
    warn.hidden = !v.warning;
    cConfirm.textContent = v.confirmLabel;
    cCancel.textContent = v.cancelLabel;

    const restore = document.activeElement;
    cDlg.hidden = false;
    cCancel.focus();                 // decline is the safe default under the keyboard

    return new Promise((resolve) => {
      const done = (ok) => {
        cDlg.hidden = true;
        cConfirm.removeEventListener('click', onOk);
        cCancel.removeEventListener('click', onNo);
        cDlg.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey, true);
        closeConsent = null;
        if (restore && restore.focus) restore.focus();
        resolve(ok);
      };
      const onOk = () => done(true);
      const onNo = () => done(false);
      const onBackdrop = (e) => { if (e.target === cDlg) done(false); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); return; }   // never reaches barge-in
        if (e.key !== 'Tab') return;
        e.preventDefault();                                                     // trap: two buttons only
        (document.activeElement === cConfirm ? cCancel : cConfirm).focus();
      };
      closeConsent = onNo;
      cConfirm.addEventListener('click', onOk);
      cCancel.addEventListener('click', onNo);
      cDlg.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey, true);   // capture: beat the panel's Escape
    });
  }

  // The 'no-model' remedy: consent, then POST the validated load and poll the ping until the
  // brain answers — an MLX load takes ~15-60s, so patience with a deadline.
  empty.addEventListener('click', async (e) => {
    const b = e.target.closest('#vc-load');
    if (!b || loadingModel || closeConsent) return;
    if (await askConsent(b.dataset.model)) loadModel(b.dataset.model);
  });
  async function loadModel(model) {
    loadingModel = model; paint();
    try {
      const j = await (await fetch('/api/slipway/load', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })).json();
      if (j.error) throw new Error(j.error);
      for (let i = 0; i < 36; i++) {               // ~90s ceiling
        await new Promise((r) => setTimeout(r, 2500));
        await probe();
        if (brain.available) { loadingModel = null; return; }   // probe() painted the wake-up
      }
      throw new Error('model did not come up within 90s');
    } catch (err) {
      loadingModel = null;
      messages = addMessage(messages, { role: 'assistant', text: `Couldn't load ${model.split('/').pop()} — ${err.message}. Try it from Slipway directly.` });
      paint();
    }
  }

  async function probe() {
    try { brain = await (await fetch('/api/ai/ping')).json(); } catch { brain = { available: false }; }
    // What Slipway could serve, with sizes — the picker's switch targets. Cosmetic if it
    // fails: the panel still works against whatever is resident.
    try {
      const j = await (await fetch('/api/slipway/models')).json();
      loadable = Array.isArray(j.models) ? j.models : [];
    } catch { /* keep the last list */ }
    try {
      const s = await (await fetch('/api/voice/status')).json();
      agent = s.agent.connected ? { connected: true, model: s.agent.model, stale: !!s.agent.stale } : { connected: false };
    } catch { /* status is cosmetic; SSE keeps it live */ }
    paint();
  }

  // ── the MCP agent lane: SSE-fed say/listen/agent events ──────────────────────
  const ackSayDone = (msg_id, payload) => fetch('/api/voice/say-done', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_id, ...payload }),
  }).catch(() => {});
  const sse = new EventSource('/api/events');
  // A server restart kills in-flight probes and leaves the badge frozen on stale truth
  // ("no model" while a brain is up — observed 2026-07-04). EventSource auto-reconnects;
  // every (re)connect is the moment to re-ask. A slow poll while the panel is open
  // catches brains that come up out-of-band (e.g. Slipway starting MLX).
  sse.onopen = () => probe();
  setInterval(() => { if (!pop.hidden || !orb.hidden) probe(); }, 20000);
  sse.addEventListener('voice-agent', (e) => {
    const d = JSON.parse(e.data);
    agent = d.state === 'connected' ? { connected: true, model: d.model, stale: false }
      : d.state === 'stale' ? { ...agent, stale: true } : { connected: false };
    if (d.state === 'connected') messages = addMessage(messages, { role: 'assistant', text: `— ${d.model} connected —` });
    paint();
  });
  sse.addEventListener('voice-say', (e) => {
    const { msg_id, text, model, grounding } = JSON.parse(e.data);
    messages = addMessage(messages, { role: 'assistant', text, model, grounding });
    // Query grounding (#2a): light up the evidence subgraph while the answer plays.
    // Spoken answers clear via the speech-end linger; unspoken ones via the fallback timer.
    const willSpeak = leader && !!tts && !muted;
    showGrounding(grounding || null, willSpeak);
    busy = false; setState('idle'); paint();
    if (!leader) return;                            // read-only tab: render, never speak/ack
    if (!tts || muted) { ackSayDone(msg_id, { reason: !tts ? 'no_tts' : 'muted' }); return; }
    speakReply(text, msg_id);
  });

  // ── grounding lifecycle: show → (speech ends → linger) or (unspoken → fallback) → clear.
  // A new utterance clears instantly (submit); a new say replaces the set outright.
  const GROUNDING_UNSPOKEN_MS = 10000, GROUNDING_LINGER_MS = 4000;
  let groundingTimer = null;
  function showGrounding(list, willSpeak) {
    if (groundingTimer) { clearTimeout(groundingTimer); groundingTimer = null; }
    if (!list || !list.length) { onGrounding(null); return; }
    onGrounding(list);
    if (!willSpeak) groundingTimer = setTimeout(() => onGrounding(null), GROUNDING_UNSPOKEN_MS);
  }
  function lingerGrounding() {
    if (groundingTimer) clearTimeout(groundingTimer);
    groundingTimer = setTimeout(() => onGrounding(null), GROUNDING_LINGER_MS);
  }
  function clearGrounding() {
    if (groundingTimer) { clearTimeout(groundingTimer); groundingTimer = null; }
    onGrounding(null);
  }
  sse.addEventListener('voice-listen-state', (e) => {
    const { listening } = JSON.parse(e.data);
    if (agent.stale && listening) { agent.stale = false; paint(); }   // it's polling again — alive
    if (listening && !speaking && !busy) setState(stt && stt.active() ? 'listening' : 'idle');
  });
  sse.addEventListener('voice-navigate', (e) => {
    try { onNavigate(JSON.parse(e.data)); } catch { /* malformed event — ignore */ }
  });
  sse.addEventListener('voice-panel', (e) => {
    try { const { panel_id, spec } = JSON.parse(e.data); showPanel(panel_id, spec); } catch { /* ignore */ }
  });

  // ── dynamic panels: fetch the data, render via the registry, land in the thread ──
  async function showPanel(panelId, spec) {
    try {
      let title = spec.title || '', panelKind = spec.kind, html = '';
      if (spec.kind === 'agenda') {
        const d = await (await fetch('/api/digest' + (spec.project ? '?project=' + encodeURIComponent(spec.project) : ''))).json();
        title = title || (spec.project ? `What's due · ${spec.project}` : "What's due");
        html = renderAgendaBody(d);
      } else if (spec.kind === 'today') {
        const d = await (await fetch('/api/day' + (spec.since_now === false ? '?since_now=0' : ''))).json();
        title = title || 'Later today';
        html = renderTodayBody(d);
      } else if (spec.kind === 'search') {
        const s = await (await fetch('/api/search?q=' + encodeURIComponent(spec.q))).json();
        title = title || `Search · ${spec.q}`;
        html = renderSearchBody(s.results || []);
      } else if (spec.kind === 'node') {
        const { node } = await (await fetch('/api/node?id=' + encodeURIComponent(spec.node_id))).json();
        if (!node) return;
        const { signals, data } = deriveNodeView(node, {}, {});
        title = title || node.name;
        html = renderNodeBody(signals, data, spec.components || null);
      } else if (spec.kind === 'viz') {
        // the chart already arrived resolved + validated from the server — just draw it (no fetch)
        title = title || 'Chart';
        html = renderVizBody(spec.chart, spec.row_count);
      } else return;
      messages = addCard(messages, { panelId, panelKind, title, replyTo: lastUtterance(messages), html, nodeId: spec.node_id || null });
      if (pop.hidden) open(); else paint();
    } catch { /* a failed panel fetch should never break the conversation */ }
  }

  // Card interactions (collapse/expand/open) + agenda/search row clicks — one delegate.
  thread.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-panel-toggle]');
    if (toggle) { messages = toggleCard(messages, toggle.dataset.panelToggle); paint(); return; }
    const openBtn = e.target.closest('[data-panel-open]');
    if (openBtn) {
      const card = cardById(messages, openBtn.dataset.panelOpen);
      if (!card) return;
      if (card.panelKind === 'agenda' || card.panelKind === 'today') onNavigate({ lens: 'time' });
      else if (card.panelKind === 'search') { const q = document.getElementById('q'); if (q) q.focus(); }
      // ↗ always PROMOTES: a node card renders the same compact composition as the inspector,
      // so "open the full view" opens the report (the next altitude up), not the inspector.
      else if (card.panelKind === 'node' && card.nodeId) onNavigate({ node_id: card.nodeId, node_name: card.title, view: 'report' });
      return;
    }
    const row = e.target.closest('[data-node]');
    if (row && row.dataset.node) onNavigate({ node_id: row.dataset.node });
  });

  // Switching brains is user-side only: picking a local model supersedes the MCP agent.
  picker.onchange = async () => {
    const v = picker.value;
    if (!v.startsWith('local:')) return;
    const model = v.slice('local:'.length);
    // Switching to a model that isn't in memory is a LOAD — ask first, and put the picker back
    // if declined, so the dropdown never claims a brain that was never loaded.
    const resident = brain.available && (localModel || brain.model) === model;
    if (!resident && !loadingModel) {
      if (!(await askConsent(model))) { paint(); return; }
    }
    if (agent.connected) {
      try { await fetch('/api/voice/switch-local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* SSE will confirm */ }
      agent = { connected: false };
      messages = addMessage(messages, { role: 'assistant', text: '— switched to the local model —' });
    }
    localModel = model;
    paint();
    if (!resident) loadModel(model);
  };

  // ── TTS + the live karaoke highlight ─────────────────────────────────────────
  const lastAssistantBubble = () => {
    const els = thread.querySelectorAll('.vt-assistant .vt-bubble');
    return els.length ? els[els.length - 1] : null;
  };
  function speakReply(text, msgId = null) {
    if (!tts || muted || !leader) return;
    // Echo-loop guard (Phase 8): a live mic would transcribe our OWN speech through the
    // speakers. Default: pause STT while speaking, resume after. The openmic toggle
    // ("listen while speaking — headphones recommended") opts back in, which is exactly
    // what enables spoken barge-in: a final result mid-say flows submit → interrupt.
    let resumeAfterSay = false;
    if (stt && stt.active() && !openMic()) { stt.stop(); resumeAfterSay = true; }
    // British by default: the local lane resolves its own voice (server pref); Web
    // Speech resolves here — explicit pick > Daniel (en-GB) > any en-GB > engine default.
    const webVoice = tts.voices ? pickVoice(tts.voices(), voicePref()) : null;
    const handle = tts.speak(text, {
      voiceName: serverVoices ? (voicePref() || undefined) : (webVoice || undefined),
      rate: ttsRate(),
      onBoundary: (at) => {
        const el = lastAssistantBubble();
        if (el) el.innerHTML = spokenSplitHtml(text, at);
        if (!pop.hidden || !speaking) return;
        sub.textContent = subtitleWindow(text, at); sub.hidden = false;   // collapsed: subtitle strip
      },
      onDone: ({ interrupted, spokenChars }) => {
        speaking = null; sub.hidden = true;
        lingerGrounding();                          // speech over — evidence fades shortly after
        if (interrupted) { messages = markInterrupted(messages, spokenChars); wasInterrupted = true; }
        if (msgId) ackSayDone(msgId, interrupted ? { interrupted: true, spoken_chars: spokenChars } : {});
        if (resumeAfterSay && stt && !stt.active()) stt.start();   // the paused mic comes back
        setState(stt && stt.active() ? 'listening' : 'idle');
        paint();
      },
    });
    if (handle) { speaking = { handle, text, msgId }; setState('speaking'); }
    else if (msgId) { lingerGrounding(); ackSayDone(msgId, { reason: 'no_tts' }); }
  }
  // The barge-in: instant, from any interrupt gesture. onDone (normalized in the
  // provider) freezes the highlight and repaints.
  function interrupt() {
    if (speaking) speaking.handle.cancel();
  }

  // ── STT: click-to-toggle listening; finals auto-send ─────────────────────────
  function ensureSTT() {
    if (stt || !hasSTT) return;
    // Lane pick mirrors TTS: on-device whisper when installed, browser engine otherwise.
    const make = injected.stt || (sttLocal
      ? (opts) => createRecorderSTT({ ...opts, model: () => localStorage.getItem('scatterbrained:voice:stt-model') || 'large-v3-turbo' })
      : createSTT);
    stt = make({
      onInterim: (t) => { messages = setGhost(messages, t); paint(); },
      onFinal: (t) => { submit(t, 'speech'); },
      onState: (s) => {
        if (s === 'denied') { messages = addMessage(messages, { role: 'assistant', text: 'Microphone access was denied — you can keep typing, or re-allow the mic in your browser.' }); }
        if (s === 'transcribing') { setState('thinking'); paint(); return; }
        if (s !== 'listening' && state === 'listening') setState(speaking ? 'speaking' : 'idle');
        paint();
      },
    });
  }
  function toggleMic() {
    if (!leader) return;
    interrupt();                                   // mic tap while speaking = barge-in
    ensureSTT();
    if (!stt) return;
    if (stt.active()) { stt.stop(); setState(speaking ? 'speaking' : 'idle'); }
    else { stt.start(); setState('listening'); }
    paint();
  }

  // ── the chat turn (typed or spoken — one path, two brains) ───────────────────
  async function submit(text, source = 'text') {
    const q = String(text != null ? text : input.value).trim();
    if (!q || !leader || (busy && !agentMode())) return;
    interrupt();                                   // sending while it talks = barge-in
    clearGrounding();                              // a new question retires the old evidence
    if (text == null) input.value = '';
    messages = addMessage(messages, { role: 'you', text: q });
    paint();
    // The MCP lane: hand the utterance to the rendezvous; the reply arrives as a
    // voice-say SSE event. No busy-lock — the session queues while the agent thinks.
    if (agentMode()) {
      const interrupted = wasInterrupted; wasInterrupted = false;
      setState('thinking');
      try {
        const j = await (await fetch('/api/voice/utterance', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: q, source, interrupted, ui: getUi() }),
        })).json();
        if (j.routed === 'agent') return;
        agent = { connected: false };              // it left between SSE beats — fall through
      } catch { agent = { connected: false }; }
      paint();
    }
    if (!brain.available) {
      await probe();
      if (!brain.available) {
        // Never a silent no-op: the user just sent words at a brainless panel — say why.
        const es = brainEmptyState(brain);
        messages = addMessage(messages, { role: 'assistant', text: es ? `${es.headline} — ${es.hint}` : 'No model available.' });
        paint();
        return;
      }
    }
    busy = true; setState('thinking');
    try {
      const r = await fetch('/api/voice/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, node_id: getSelectedId(), model: localModel || undefined, history: messages.filter((m) => m.kind === 'msg').slice(-8).map((m) => ({ role: m.role, text: m.text })) }),
      });
      const j = await r.json();
      if (j.available === false) {
        // The brain vanished mid-conversation (model unloaded / Slipway stopped) — carry
        // the server's reason into local state and answer honestly instead of going mute.
        brain = { available: false, reason: j.reason, selected: j.selected };
        const es = brainEmptyState(brain);
        messages = addMessage(messages, { role: 'assistant', text: es ? `${es.headline} — ${es.hint}` : 'The model went away.' });
      }
      else if (j.error) messages = addMessage(messages, { role: 'assistant', text: 'Sorry — ' + j.error });
      else {
        messages = addMessage(messages, { role: 'assistant', text: j.text, model: j.model });
        busy = false; setState('idle'); paint();
        speakReply(j.text);
        return;
      }
    } catch {
      messages = addMessage(messages, { role: 'assistant', text: 'Sorry — I couldn\'t reach the model.' });
    }
    busy = false; setState(stt && stt.active() ? 'listening' : 'idle'); paint();
  }

  // Local-mode quick actions — the honest degradation: USER-driven panels (chips), no
  // fake NLU. Each chip opens the canned panel AND sends a canned utterance whose
  // /api/voice/chat prompt is grounded in the same data (digest / selected node).
  const chips = document.getElementById('vc-chips');
  const paintChips = () => {
    chips.hidden = agentMode() || (!brain.available && !messages.length);
    chips.querySelector('[data-chip="node"]').hidden = !getSelectedId();
  };
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chip]');
    if (!b) return;
    if (b.dataset.chip === 'due') { showPanel(crypto.randomUUID(), { kind: 'agenda' }); submit('what needs me this week?'); }
    else if (b.dataset.chip === 'node') { showPanel(crypto.randomUUID(), { kind: 'node', node_id: getSelectedId() }); submit('tell me about this node'); }
    else if (b.dataset.chip === 'search') { const q = document.getElementById('q'); close(); if (q) q.focus(); }
  });

  // Explicit save-to-graph (Phase 6): the transcript becomes a voice_session Source with
  // INFORMS edges to everything the conversation touched. Never automatic.
  const saveBtn = document.getElementById('vc-save');
  saveBtn.onclick = async () => {
    const turns = messages.filter((m) => m.kind === 'msg');
    if (!turns.length) return;
    const transcript = turns.map((m) =>
      `**${m.role === 'you' ? 'You' : 'Assistant' + (m.model ? ` (${m.model})` : '')}:** ${m.text}${m.interruptedAt != null ? ' _(interrupted)_' : ''}`).join('\n\n');
    saveBtn.disabled = true;
    try {
      const j = await (await fetch('/api/voice/capture', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, model: agent.connected ? agent.model : (brain.model || null) }),
      })).json();
      messages = addMessage(messages, {
        role: 'assistant',
        text: j.ok ? `— conversation saved to the graph (${j.informs} node${j.informs === 1 ? '' : 's'} linked) —` : `— save failed: ${j.error || 'unknown'} —`,
      });
    } catch {
      messages = addMessage(messages, { role: 'assistant', text: '— save failed: server unreachable —' });
    }
    saveBtn.disabled = false;
    paint();
  };

  // ── Push-to-talk (Phase 8): hold the key to listen, release to send — Wispr-Flow
  // style, and it works with the panel CLOSED (the orb carries the whole conversation).
  // Configurable in Settings: space | backquote | off.
  const PTT_CODES = { space: 'Space', backquote: 'Backquote' };
  let pttHeld = false;
  const pttMatch = (e) => PTT_CODES[pttKey()] === e.code;
  const inEditable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  window.addEventListener('keydown', (e) => {
    if (!pttMatch(e) || e.repeat || pttHeld || !leader || !hasSTT) return;
    if (inEditable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();                            // Space must not scroll the canvas
    pttHeld = true;
    interrupt();                                   // holding mid-speech = barge-in
    ensureSTT();
    if (stt && !stt.active()) stt.start({ vad: false });   // one utterance per hold — no mid-pause cuts
    setState('listening'); paint();
  });
  window.addEventListener('keyup', (e) => {
    if (!pttHeld || !pttMatch(e)) return;
    pttHeld = false;
    if (stt) stt.stop();                           // stop finalizes → onFinal → submit
    if (state === 'listening') setState(speaking ? 'speaking' : 'idle');
    paint();
  });

  send.onclick = () => submit();
  micBtn.onclick = toggleMic;
  muteBtn.onclick = () => {
    muted = !muted; localStorage.setItem('scatterbrained:voice:muted', muted ? '1' : '0');
    if (muted) interrupt();
    paint();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); return; }
    if (speaking && e.key !== 'Escape') interrupt();          // typing barges in
  });
  orb.onclick = () => open();

  const open = () => { pop.hidden = false; probe(); paint(); input.focus(); railBtn && railBtn.classList.add('active'); };
  const close = () => { pop.hidden = true; railBtn && railBtn.classList.remove('active'); paintOrb(); };
  const toggle = () => (pop.hidden ? open() : close());

  document.getElementById('vc-x').onclick = close;
  if (railBtn) railBtn.onclick = toggle;
  document.addEventListener('keydown', (e) => {
    if (pop.hidden) return;
    const inside = e.target === input || pop.contains(e.target);
    // While speaking, Esc/Space anywhere in the panel interrupt (Esc does NOT close mid-speech).
    if (speaking && (e.key === 'Escape' || (e.key === ' ' && e.target !== input)) && inside) {
      e.stopPropagation(); e.preventDefault(); interrupt(); return;
    }
    if (e.key === 'Escape' && inside) { e.stopPropagation(); close(); }
  });

  setState('idle');
  paint();
  return { open, close, toggle, isOpen: () => !pop.hidden };
}
