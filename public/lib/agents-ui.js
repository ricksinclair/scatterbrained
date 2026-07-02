// agents-ui.js — the Agents lens: the Act plane of the graph. Left: a Studio-native
// session rail (from /api/agent/sessions) with the Capture/Summarize verbs (moved here
// from the dock). Top: the loop header — Brief → Session → Capture → Insight rendered
// per selected session (lib/act-loop.js, pure). Right/below: the embedded Slipway panel
// (the local + hosted model / agent runtime) in a sandboxed iframe. Federated
// integration — Slipway is a separate localhost app (Python), reached over an iframe;
// see the 'Slipway as the Act plane of Scatterbrained' graph Idea for the contract.
// The pure `agentsIframeAttrs()` / `slipwayUrlWithHash()` / `unavailableHtml()` are
// unit-tested; the rail/loop wiring is exercised by e2e (agents-lens.spec.js).
//
// Portability: Slipway is a macOS/Apple-Silicon-first, POSIX-only runtime (MLX needs Apple Silicon;
// the terminals need a Unix pty). Scatterbrained itself is advertised for macOS/Windows/Linux, so on
// most machines Slipway is NOT running. We therefore FEATURE-DETECT it before rendering: reachable →
// embed; otherwise → a friendly "not detected" state instead of a blank ERR_CONNECTION_REFUSED frame.
// The session rail renders EITHER WAY — the mapping + on-disk transcripts are exactly the
// post-mortem capture window, so Capture works with Slipway down.
// The iframe keeps allow-same-origin so Slipway's terminal-WebSocket Origin check passes.

import { emptyState } from './empty-state.js';
import { esc, trunc } from './dom.js';
import { loopSteps, sessionChip, filterSessions } from './act-loop.js';

export const SLIPWAY_URL = 'http://localhost:8765';
export const SLIPWAY_PROBE = SLIPWAY_URL + '/api/status';

// Pure, testable: a Slipway URL carrying a deep-link fragment (Slipway handles #terminals and
// #term:<sid> on load + hashchange). The nonce defeats same-hash no-ops — re-surfacing the same
// session must still fire a fragment navigation in a live frame; Slipway ignores it.
export function slipwayUrlWithHash(base = SLIPWAY_URL, hash = '', nonce = '') {
  if (!hash) return base;
  return `${base}#${hash}${nonce ? ':' + nonce : ''}`;
}

// Pure, testable: the attributes for the Slipway embed. Kept minimal. `theme` (D5)
// carries first-paint params — ?embed=1 flips Slipway into embed mode (terminals as the
// page, no header), mode/accent/uiscale paint it Studio-native before the postMessage
// bridge delivers the full token set.
export function agentsIframeAttrs(baseUrl = SLIPWAY_URL, theme = null) {
  const src = theme
    ? `${baseUrl}/?` + new URLSearchParams({
      embed: '1', mode: theme.mode || 'dark', accent: theme.accent || '', uiscale: String(theme.uiscale || 1),
    })
    : baseUrl;
  return {
    src,
    title: 'Agents · Slipway',
    // allow-same-origin  → Slipway keeps its real origin so its WS Origin check passes.
    // (deliberately no allow-top-navigation → the embed can't hijack the parent Studio.)
    sandbox: 'allow-same-origin allow-scripts allow-forms allow-popups',
  };
}

// Pure, testable: the fallback shown when Slipway isn't reachable on this machine.
// D2: rendered through the shared empty-state (constellation motif + Fraunces line);
// keeps the copyable start command + retry, and the action opens the docs.
export function unavailableHtml() {
  return `<div class="agents-unavail">` + emptyState({
    title: 'Local agent runtime not detected',
    body: 'The Agents surface runs Slipway — an optional local model & agent runtime ' +
      '(Apple-Silicon macOS for MLX; Ollama also works on Linux). It isn’t part of the core Scatterbrained install.',
    action: { label: 'Slipway docs ↗', href: 'https://ulrictodman.com/scatterbrained/' },
  }) + `<p>Start it on this machine (serving <code>localhost:8765</code>), then
       <button class="au-retry" id="agents-retry" type="button">retry</button>.</p>
  </div>`;
}

// Reachability probe. no-cors: an opaque resolve means Slipway answered; a reject means it's not
// listening. Requires the panel origin in the Studio CSP connect-src (added in server.js).
async function defaultProbe() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    await fetch(SLIPWAY_PROBE, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

// The token names forwarded to the embed — mirrors the whitelist in Slipway's panel.js
// (only CSS custom properties; the receiving side filters again).
const THEME_VARS = ['--bg0', '--bg1', '--ink', '--ink-dim', '--ink-faint', '--line', '--panel', '--surface',
  '--surface-2', '--accent', '--accent-contrast', '--accent-soft', '--warn', '--ok', '--ui-scale'];

// deps: { pauseMainGraph, resumeMainGraph, probe?,        — probe overridable for tests
//         showInGraph(title),                             — close the lens + focus a graph node
//         onSessionsChanged(),                            — let the dock lane re-count
//         embedTheme() }                                  — {mode, accent, uiscale} for the embed's first paint
// Launch/close/Escape wiring lives in app.js (nav state machine + shared lens-head).
export function initAgents({ pauseMainGraph, resumeMainGraph, probe, showInGraph, onSessionsChanged, embedTheme } = {}) {
  const overlay = document.getElementById('agents');
  if (!overlay) return { open() {}, close() {} };
  const railEl = document.getElementById('agents-rail');
  const loopEl = document.getElementById('agents-loop');
  const embedEl = document.getElementById('agents-embed');
  const reach = probe || defaultProbe;
  let frame = null;
  let frameBase = null;     // the exact pre-hash URL the live frame was created with
  let pendingHash = null;   // deep-link to apply when the frame is (re)created
  let sessions = [];
  let selectedSid = null;
  let slipwayUp = null;     // last probe result (null = not probed yet)
  let railFilter = 'live';  // 'live' (default: Live+Recent, non-archived) | 'archived'

  // ── the embed (right pane): iframe when Slipway answers, empty-state otherwise ──
  async function renderEmbed() {
    if (!embedEl) return;
    embedEl.innerHTML = '<div class="agents-unavail"><div class="au-title">checking…</div></div>';
    const ok = await reach();
    slipwayUp = ok;
    if (overlay.hidden) return;                 // user closed while the probe was in flight
    if (ok) {
      if (!frame) {
        const a = agentsIframeAttrs(SLIPWAY_URL, embedTheme ? embedTheme() : null);
        frame = document.createElement('iframe');
        frame.className = 'agents-frame';
        frame.title = a.title;
        frame.setAttribute('sandbox', a.sandbox);
        frame.addEventListener('load', notifyTheme);   // full token set once the panel is listening
        frameBase = a.src;
        frame.src = pendingHash ? slipwayUrlWithHash(frameBase, pendingHash, Date.now()) : frameBase;
        pendingHash = null;
      }
      embedEl.innerHTML = '';
      embedEl.appendChild(frame);               // frame (and its terminals) persist across toggles
    } else {
      frame = null; frameBase = null;
      embedEl.innerHTML = unavailableHtml();
      const retry = document.getElementById('agents-retry');
      if (retry) retry.onclick = () => { renderEmbed(); refreshSessions(); };
    }
    renderRail();                               // rail visibility depends on the probe result
  }

  // ── the session rail (left column) + loop header ────────────────────────────
  async function refreshSessions() {
    try {
      const a = await fetch('/api/agent/sessions').then((r) => r.json());
      sessions = (a && a.sessions) || [];
    } catch { sessions = []; }
    if (!sessions.find((s) => s.sid === selectedSid)) selectedSid = sessions.length ? sessions[0].sid : null;
    renderRail();
  }

  function renderRail() {
    if (!railEl || !loopEl) return;
    if (!sessions.length) {
      // Slipway up but nothing launched yet → teach the loop's entry point. Slipway
      // absent AND no history → the embed's unavailable state already says everything.
      railEl.hidden = slipwayUp === false;
      railEl.innerHTML = emptyState({
        title: 'No agent sessions yet.',
        body: 'Open any Project and press “Open agent here” — the graph writes the brief.',
      });
      loopEl.hidden = true;
      return;
    }
    railEl.hidden = false;
    // Bucket + filter (pure). Default 'live' shows the non-archived working set (Live+Recent);
    // 'archived' shows the archived rows — never hidden from the graph, only from the default rail.
    const { visible, counts } = filterSessions(sessions, railFilter);
    const chipRow =
      `<div class="sess-filter" role="tablist" aria-label="Session filter">` +
      `<button class="chip sess-fchip${railFilter !== 'archived' ? ' on' : ''}" data-filter="live" role="tab" aria-selected="${railFilter !== 'archived'}">` +
        `Live · Recent<span class="sess-fcount">${counts.live + counts.recent}</span></button>` +
      `<button class="chip sess-fchip${railFilter === 'archived' ? ' on' : ''}" data-filter="archived" role="tab" aria-selected="${railFilter === 'archived'}">` +
        `Archived<span class="sess-fcount">${counts.archived}</span></button>` +
      (counts.recent > 0
        ? `<button class="sess-verb sess-arch-all" type="button" title="Archive every ended session">Archive all ended</button>`
        : '') +
      `</div>`;
    const list = visible.length
      ? visible.map((s) => {
        const chip = sessionChip(s);
        const name = s.mapped ? (s.nodeName || '(node)') : (s.label || '(session)');
        const when = s.launchedAt ? esc(String(s.launchedAt).slice(0, 16).replace('T', ' ')) : '';
        const what = [s.model || s.launcher, s.mapped ? null : 'outside the graph'].filter(Boolean).map(esc).join(' · ');
        // Archive/Unarchive is a rail action on any non-live session (Slipway never touches live ones).
        const archVerb = s.alive ? ''
          : (s.archived
            ? `<button class="sess-verb sess-unarch" data-sid="${esc(s.sid)}">Unarchive</button>`
            : `<button class="sess-verb sess-arch" data-sid="${esc(s.sid)}">Archive</button>`);
        const capVerbs = !s.alive && s.mapped
          ? (s.captured
            ? `<button class="sess-verb sess-sum" data-sid="${esc(s.sid)}">Summarize</button>` +
              (s.grown ? `<button class="sess-verb sess-cap" data-sid="${esc(s.sid)}">Re-capture ↻</button>` : '')
            : `<button class="sess-verb sess-cap" data-sid="${esc(s.sid)}">Capture</button>`)
          : '';
        const verbs = capVerbs + archVerb;
        return `<div class="sess-row${s.sid === selectedSid ? ' on' : ''}${s.archived ? ' archived' : ''}" role="button" tabindex="0" data-sid="${esc(s.sid)}">` +
          `<div class="sess-name">${esc(trunc(name, 34))}<span class="sess-chip ${chip.cls}">${chip.label}</span></div>` +
          `<div class="sess-meta">${[what, when].filter(Boolean).join(' · ')}</div>` +
          (verbs ? `<div class="sess-verbs">${verbs}</div>` : '') +
          `</div>`;
      }).join('')
      : `<div class="sess-empty">${railFilter === 'archived' ? 'No archived sessions.' : 'No active or recent sessions.'}</div>`;
    railEl.innerHTML = chipRow + list;
    railEl.querySelectorAll('.sess-fchip').forEach((b) => b.addEventListener('click', () => { railFilter = b.dataset.filter; renderRail(); }));
    railEl.querySelector('.sess-arch-all')?.addEventListener('click', () => archiveAllEnded());
    railEl.querySelectorAll('.sess-row').forEach((row) => {
      row.addEventListener('click', () => selectSession(row.dataset.sid));
      row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) { e.preventDefault(); row.click(); } });
    });
    railEl.querySelectorAll('.sess-cap').forEach((b) => b.addEventListener('click', verbAction(b, '/api/agent/capture', 'capturing…')));
    railEl.querySelectorAll('.sess-sum').forEach((b) => b.addEventListener('click', verbAction(b, '/api/agent/summarize', 'summarizing…')));
    railEl.querySelectorAll('.sess-arch').forEach((b) => b.addEventListener('click', archiveAction(b, true)));
    railEl.querySelectorAll('.sess-unarch').forEach((b) => b.addEventListener('click', archiveAction(b, false)));
    renderLoop();
  }

  function selectSession(sid) {
    selectedSid = sid;
    railEl.querySelectorAll('.sess-row').forEach((r) => r.classList.toggle('on', r.dataset.sid === sid));
    renderLoop();
    // Deep-link the live frame at the session (attach if live, replay if ended).
    if (frame && frame.isConnected && frameBase) frame.src = slipwayUrlWithHash(frameBase, 'term:' + sid, Date.now());
  }

  function renderLoop() {
    if (!loopEl) return;
    const s = sessions.find((x) => x.sid === selectedSid);
    loopEl.hidden = !s;
    if (!s) return;
    loopEl.innerHTML = loopSteps(s).map((st) =>
      `<span class="loop-step ${st.state}" data-step="${st.id}"><span class="loop-dot"></span>` +
      `<span class="loop-l">${esc(st.label)}</span>` +
      (st.detail ? `<span class="loop-d">${esc(trunc(st.detail, 30))}</span>` : '') +
      `</span>`).join('<span class="loop-link" aria-hidden="true"></span>');
  }

  // Capture is quick; Summarize runs a local model (can take a minute-plus on a big MLX
  // model) — the button narrates and stays disabled in flight. Same POSTs the dock used.
  const verbAction = (btn, path, busy) => async (e) => {
    e.stopPropagation();
    const isCapture = path.endsWith('/capture');
    btn.disabled = true; btn.textContent = busy;
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid: btn.dataset.sid }) }).then((x) => x.json());
      if (r.error || r.available === false) { btn.textContent = trunc(r.error || 'no local model', 26); btn.disabled = false; return; }
      if (isCapture) showReceipt(r.sourceTitle);          // the hero moment: session → graph, with a receipt
      else showReceipt(null, 'Summarized → Insight grown from this session');
      refreshSessions();
      if (onSessionsChanged) onSessionsChanged();         // the dock lane re-counts
    } catch { btn.textContent = 'failed'; btn.disabled = false; }
  };

  // Archive/Unarchive one session. Routes through the Studio→Slipway passthrough
  // (/api/agent/archive), same server-side posture as capture. Rail-visibility only —
  // the graph Source/INFORMS edges of a captured session are never touched.
  const archiveAction = (btn, archived) => async (e) => {
    e.stopPropagation();
    btn.disabled = true; btn.textContent = archived ? 'archiving…' : 'unarchiving…';
    const ok = await postArchive({ id: btn.dataset.sid, archived });
    if (!ok) { btn.textContent = 'failed'; btn.disabled = false; return; }
    refreshSessions();
    if (onSessionsChanged) onSessionsChanged();
  };

  async function postArchive(body) {
    try {
      const r = await fetch('/api/agent/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((x) => x.json());
      return !r.error;
    } catch { return false; }
  }

  async function archiveAllEnded() {
    if (await postArchive({ all: true })) { refreshSessions(); if (onSessionsChanged) onSessionsChanged(); }
  }

  // Palette entry point: archive/unarchive the currently selected session (⌘K command).
  async function archiveSelected() {
    const s = sessions.find((x) => x.sid === selectedSid);
    if (!s || s.alive) return;                 // no selection / live session → nothing to do
    if (await postArchive({ id: s.sid, archived: !s.archived })) {
      refreshSessions(); if (onSessionsChanged) onSessionsChanged();
    }
  }

  // ── the capture receipt: "Session captured → Source «title»"  [Show in graph] ──
  let receiptEl = null, receiptTimer = null;
  function showReceipt(sourceTitle, plainText) {
    if (!receiptEl) {
      receiptEl = document.createElement('div');
      receiptEl.className = 'receipt';
      overlay.appendChild(receiptEl);
    }
    clearTimeout(receiptTimer);
    receiptEl.innerHTML = (plainText
      ? `<span class="receipt-t">${esc(plainText)}</span>`
      : `<span class="receipt-t">Session captured → Source <b>«${esc(trunc(sourceTitle || '', 40))}»</b></span>` +
        (showInGraph ? `<button class="receipt-act" type="button">Show in graph</button>` : '')) +
      `<button class="receipt-x" type="button" aria-label="dismiss">×</button>`;
    const act = receiptEl.querySelector('.receipt-act');
    if (act) act.onclick = () => { hideReceipt(); showInGraph(sourceTitle); };
    receiptEl.querySelector('.receipt-x').onclick = hideReceipt;
    requestAnimationFrame(() => receiptEl && receiptEl.classList.add('show'));
    receiptTimer = setTimeout(hideReceipt, 12000);
  }
  function hideReceipt() {
    clearTimeout(receiptTimer);
    if (receiptEl) receiptEl.classList.remove('show');
  }

  // The live theme bridge (D5): push the current token values into the embed so a theme /
  // mode / UI-size switch restyles the Slipway panel without a reload. Fired by theme-ui's
  // notifyEmbeds hook and on frame load. postMessage is targeted at the Slipway origin;
  // the panel whitelists the var names before applying (CSS custom properties only).
  function notifyTheme() {
    if (!frame || !frame.contentWindow) return;
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const k of THEME_VARS) { const v = cs.getPropertyValue(k).trim(); if (v) vars[k] = v; }
    const t = embedTheme ? embedTheme() : { mode: 'dark', uiscale: 1 };
    frame.contentWindow.postMessage({ type: 'scatterbrained:theme', mode: t.mode, uiScale: t.uiscale, vars }, SLIPWAY_URL);
  }

  // opts.hash: a Slipway deep-link fragment (e.g. 'term:<sid>') to surface a session.
  function open(opts = {}) {
    if (pauseMainGraph) pauseMainGraph();
    overlay.hidden = false;
    if (opts.hash) {
      const m = /^term:([0-9a-f]+)/.exec(opts.hash);
      if (m) selectedSid = m[1];                // keep the rail + loop in step with the deep-link
    }
    refreshSessions();
    // Fast path: the frame is already live in the DOM — keep it (and its terminals). A
    // hash-only src change is a same-document fragment navigation: Slipway's hashchange
    // handler fires, nothing reloads. Skips the reachability probe (localhost trade-off:
    // if Slipway died since, the user sees a dead frame until the next fresh open).
    if (frame && frame.isConnected) {
      if (opts.hash) frame.src = slipwayUrlWithHash(frameBase, opts.hash, Date.now());
      return;
    }
    pendingHash = opts.hash || null;
    renderEmbed();
  }
  function close() {
    overlay.hidden = true;
    hideReceipt();
    if (resumeMainGraph) resumeMainGraph();
  }

  // launch/close/Escape wiring live in app.js (nav state machine + the shared lens-head).
  // archiveSelected / archiveAllEnded are exposed for the ⌘K palette commands (alpha-freeze:
  // every new verb ships with a palette command).
  return { open, close, notifyTheme, archiveSelected, archiveAllEnded };
}
