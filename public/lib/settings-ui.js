// settings-ui.js — the Settings pane: appearance prefs + READ-ONLY local system status.
// Extracted from app.js (app.js modularization). Theme state + controllers live in app.js; this
// surface reads the live values via getTheme() and drives them through the passed controllers.
// deps: { esc, THEMES, THEME_ORDER, applyTheme, applyAnim, applyUiScale, setCalm, getTheme, openPerms }
//   getTheme(): { curTheme, curMode, calm, curAnim, curUiScale } — re-read on each render so it reflects changes.
// returns { open, close }.
export function initSettings({ esc, THEMES, THEME_ORDER, applyTheme, applyAnim, applyUiScale, setCalm, getTheme, openPerms }) {
  const SETTINGS = document.getElementById('settings');
  function close() { SETTINGS.hidden = true; }
  async function open() {
    SETTINGS.hidden = false;
    render(null);                                           // paint prefs immediately
    try { render(await fetch('/api/status').then((r) => r.json())); } catch (e) { render({ error: true }); }
  }
  function fmtWhen(iso) {
    if (!iso) return 'never';
    const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 172800) return Math.round(s / 3600) + ' h ago';
    return d.toISOString().slice(0, 10);
  }
  function render(st) {
    const { curTheme, curMode, calm, curAnim, curUiScale } = getTheme();
    const themes = THEME_ORDER.map((name) => {
      const sw = THEMES[name][curMode].accent;
      return `<button class="set-theme${name === curTheme ? ' on' : ''}" data-theme="${esc(name)}"><span class="sw" style="background:${sw}"></span>${esc(THEMES[name].label)}</button>`;
    }).join('');
    const sys = !st ? '<div class="set-row"><span class="set-k">loading…</span></div>'
      : st.error ? '<div class="set-row"><span class="set-k">status unavailable</span></div>'
      : `<div class="set-row"><span class="set-k">Neo4j</span><span class="set-v"><span class="set-dot ${st.neo4j.ok ? 'ok' : 'bad'}"></span>${st.neo4j.ok ? 'connected' : 'unreachable'} · ${esc(st.neo4j.uri)}</span></div>` +
        `<div class="set-row"><span class="set-k">Graph</span><span class="set-v">${st.counts.nodes} nodes · ${st.counts.edges} edges · ${st.counts.indexed} indexed</span></div>` +
        `<div class="set-row"><span class="set-k">Last backup</span><span class="set-v">${esc(fmtWhen(st.backup.lastModified))}</span></div>` +
        `<div class="set-row"><span class="set-k">Allowed folders</span><span class="set-v">${st.folders} · <a class="set-link" id="set-folders-link">manage</a></span></div>` +
        `<div class="set-row"><span class="set-k">Neo4j browser</span><span class="set-v"><a class="set-link" href="${esc(st.neo4j.browser)}" target="_blank" rel="noopener">open ↗</a></span></div>`;
    document.getElementById('set-body').innerHTML =
      '<div class="set-section"><div class="set-section-t">Appearance</div>' +
        `<div class="set-row"><span class="set-k">Theme</span></div><div class="set-themes">${themes}</div>` +
        `<div class="set-row"><span class="set-k">Mode</span><button class="set-toggle" id="set-mode-t">${curMode === 'light' ? '☀ Light' : '☾ Dark'}</button></div>` +
        `<div class="set-row"><span class="set-k">Calm mode <span style="color:var(--ink-dim)">· less motion</span></span><button class="set-toggle${calm ? ' on' : ''}" id="set-calm-t">${calm ? 'On' : 'Off'}</button></div>` +
        `<div class="set-row"><span class="set-k">UI size</span><span class="set-seg" id="set-uiscale">${['S', 'M', 'L'].map((l) => `<button class="set-seg-b${curUiScale === l ? ' on' : ''}" data-uiscale="${l}">${l}</button>`).join('')}</span></div>` +
        `<div class="set-row"><span class="set-k">Loading animation</span><span class="set-seg" id="set-anim">${['off', 'light', 'full'].map((l) => `<button class="set-seg-b${curAnim === l ? ' on' : ''}" data-anim="${l}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</span></div>` +
      '</div>' +
      // VOICE (Phase 8): the one consolidated Assistant section — voice, rate, PTT key,
      // listen-while-speaking, privacy, and the Claude Code connect command.
      '<div class="set-section"><div class="set-section-t">Assistant</div>' +
        '<div class="set-row"><span class="set-k">Voice</span><span class="set-v"><select id="set-tts-voice" class="set-toggle" aria-label="assistant voice"><option>loading…</option></select></span></div>' +
        `<div class="set-row"><span class="set-k">Speech rate</span><span class="set-v"><input id="set-tts-rate" type="range" min="0.8" max="1.4" step="0.05" aria-label="speech rate" /> <span id="set-tts-rate-v" class="set-k"></span></span></div>` +
        `<div class="set-row"><span class="set-k">Push-to-talk <span style="color:var(--ink-dim)">· hold to speak, release to send</span></span><span class="set-seg" id="set-ptt">${[['space', 'Space'], ['backquote', '` key'], ['off', 'Off']].map(([v, l]) => `<button class="set-seg-b" data-ptt="${v}">${l}</button>`).join('')}</span></div>` +
        '<div class="set-row"><span class="set-k">Listen while speaking <span style="color:var(--ink-dim)">· headphones recommended — lets you interrupt by voice</span></span><button class="set-toggle" id="set-openmic-t"></button></div>' +
        '<div class="set-row"><span class="set-k">Recognition</span><span class="set-v" id="set-stt-status">checking…</span></div>' +
        '<div class="set-row" id="set-stt-model-row" style="display:none"><span class="set-k">Recognition model</span><span class="set-v"><select id="set-stt-model" class="set-toggle" aria-label="recognition model"></select></span></div>' +
        '<div class="set-row"><span class="set-k" style="white-space:normal;line-height:1.45" id="set-voice-privacy">With the on-device engine installed, nothing you say or hear leaves this machine — recognition is Whisper (MLX) and speech is Kokoro, both local. Without it, voice input falls back to the browser engine (Google’s servers in Chrome, Siri in Safari).</span></div>' +
        '<div class="set-row"><span class="set-k">Connect Claude Code</span><span class="set-v"><button class="set-toggle" id="set-mcp-copy">copy connect command</button></span></div>' +
        '<div class="set-row" id="set-mcp-hint" style="display:none"><span class="set-k" style="white-space:normal;line-height:1.45;font-family:var(--font-mono);font-size:var(--fs-xs)"></span></div>' +
      '</div>' +
      '<div class="set-section"><div class="set-section-t">System · read-only</div>' + sys + '</div>';
    // wire
    document.querySelectorAll('#set-body .set-theme').forEach((b) => { b.onclick = () => { applyTheme(b.dataset.theme, curMode); render(st); }; });
    document.getElementById('set-mode-t').onclick = () => { applyTheme(curTheme, curMode === 'light' ? 'dark' : 'light'); render(st); };
    document.getElementById('set-calm-t').onclick = () => { setCalm(!calm); render(st); };
    document.querySelectorAll('#set-uiscale .set-seg-b').forEach((b) => { b.onclick = () => { applyUiScale(b.dataset.uiscale); render(st); }; });
    document.querySelectorAll('#set-anim .set-seg-b').forEach((b) => { b.onclick = () => { applyAnim(b.dataset.anim); render(st); }; });
    const fl = document.getElementById('set-folders-link'); if (fl) fl.onclick = () => { close(); openPerms(); };
    // VOICE (Phase 8): rate / PTT key / openmic — plain persisted preferences that
    // voice-ui.js reads live (no reload needed; every speak re-reads them).
    const rate = document.getElementById('set-tts-rate');
    const rateV = document.getElementById('set-tts-rate-v');
    if (rate) {
      const cur = Math.min(Math.max(parseFloat(localStorage.getItem('scatterbrained:voice:rate')) || 1, 0.8), 1.4);
      rate.value = cur; rateV.textContent = cur.toFixed(2) + '×';
      rate.oninput = () => { rateV.textContent = parseFloat(rate.value).toFixed(2) + '×'; localStorage.setItem('scatterbrained:voice:rate', rate.value); };
    }
    const pttSeg = document.getElementById('set-ptt');
    if (pttSeg) {
      const paintPtt = () => {
        const cur = localStorage.getItem('scatterbrained:voice:ptt') || 'space';
        pttSeg.querySelectorAll('[data-ptt]').forEach((b) => b.classList.toggle('on', b.dataset.ptt === cur));
      };
      pttSeg.querySelectorAll('[data-ptt]').forEach((b) => { b.onclick = () => { localStorage.setItem('scatterbrained:voice:ptt', b.dataset.ptt); paintPtt(); }; });
      paintPtt();
    }
    const om = document.getElementById('set-openmic-t');
    if (om) {
      const paintOm = () => {
        const on = localStorage.getItem('scatterbrained:voice:openmic') === '1';
        om.textContent = on ? 'On' : 'Off'; om.classList.toggle('on', on);
      };
      om.onclick = () => { localStorage.setItem('scatterbrained:voice:openmic', localStorage.getItem('scatterbrained:voice:openmic') === '1' ? '0' : '1'); paintOm(); };
      paintOm();
    }
    // VOICE (Phase 9): recognition status + model picker — on-device whisper when
    // installed (the picker appears), else the browser engine is named honestly.
    const sttStatus = document.getElementById('set-stt-status');
    if (sttStatus) {
      fetch('/api/voice/stt/ping', { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((p) => {
        if (p.available) {
          sttStatus.innerHTML = '<span class="set-dot ok"></span>On-device · Whisper (MLX)';
          const row = document.getElementById('set-stt-model-row');
          const sel = document.getElementById('set-stt-model');
          const cur = localStorage.getItem('scatterbrained:voice:stt-model') || p.default;
          sel.innerHTML = p.models.map((m) => `<option value="${esc(m.id)}"${m.id === cur ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
          sel.onchange = () => localStorage.setItem('scatterbrained:voice:stt-model', sel.value);
          row.style.display = '';
        } else {
          const ua = navigator.userAgent;
          sttStatus.innerHTML = `<span class="set-dot bad"></span>Browser engine (${/safari/i.test(ua) && !/chrome/i.test(ua) ? 'Apple' : 'Google'} servers)`;
        }
      }).catch(() => { sttStatus.textContent = 'unavailable — reopen settings to retry'; });
    }
    // VOICE: the assistant voice — local Kokoro voices when that lane is installed
    // (British first, bm_george default), else the browser's en-* voices. Persisted pick.
    const vs = document.getElementById('set-tts-voice');
    if (vs) {
      const cur = localStorage.getItem('scatterbrained:voice:tts-voice') || '';
      fetch('/api/voice/tts/ping', { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).then((p) => {
        let opts;
        if (p.available) {
          opts = p.voices.map((v) => ({ id: v.id, label: v.label + ' · local' }));
          if (!cur) localStorage.setItem('scatterbrained:voice:tts-voice', p.default);
        } else {
          const web = (window.speechSynthesis ? window.speechSynthesis.getVoices() : []).filter((v) => /^en/i.test(v.lang));
          opts = web.map((v) => ({ id: v.name, label: `${v.name} (${v.lang})` }));
        }
        const sel = localStorage.getItem('scatterbrained:voice:tts-voice') || '';
        vs.innerHTML = opts.map((o) => `<option value="${esc(o.id)}"${o.id === sel ? ' selected' : ''}>${esc(o.label)}</option>`).join('') || '<option value="">system default</option>';
      }).catch(() => { vs.innerHTML = '<option value="">system default</option>'; });
      vs.onchange = () => localStorage.setItem('scatterbrained:voice:tts-voice', vs.value);
    }
    // VOICE: the MCP connect command — token stays in its 0600 file; the command reads it
    // via $(cat …) so the secret never sits in the DOM or the clipboard history as plaintext.
    const mcpBtn = document.getElementById('set-mcp-copy');
    if (mcpBtn) mcpBtn.onclick = async () => {
      try {
        const v = await fetch('/api/voice/status').then((r) => r.json());
        const cmd = `claude mcp add --transport http scatterbrained ${v.mcp.url} --header "Authorization: Bearer $(cat ${v.mcp.token_path})"`;
        await navigator.clipboard.writeText(cmd);
        mcpBtn.textContent = 'copied ✓';
        const hint = document.getElementById('set-mcp-hint');
        if (hint) { hint.style.display = ''; hint.querySelector('.set-k').textContent = cmd; }
        setTimeout(() => { mcpBtn.textContent = 'copy connect command'; }, 2500);
      } catch { mcpBtn.textContent = 'copy failed'; }
    };
  }
  { const trigger = document.getElementById('rail-settings'); if (trigger) trigger.onclick = open; }
  document.getElementById('settings-x').onclick = close;
  SETTINGS.addEventListener('click', (e) => { if (e.target === SETTINGS) close(); });
  // Modal-owned Escape: consume it (stopPropagation) so the global unwind (app.js, C2)
  // never also steps a layer on the same keypress. Document-level → runs before window.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !SETTINGS.hidden) { e.stopPropagation(); close(); } });
  return { open, close };
}
