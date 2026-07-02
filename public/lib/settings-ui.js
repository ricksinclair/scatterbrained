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
        `<div class="set-row"><span class="set-k">Calm mode <span style="color:var(--ink-faint)">· less motion</span></span><button class="set-toggle${calm ? ' on' : ''}" id="set-calm-t">${calm ? 'On' : 'Off'}</button></div>` +
        `<div class="set-row"><span class="set-k">UI size</span><span class="set-seg" id="set-uiscale">${['S', 'M', 'L'].map((l) => `<button class="set-seg-b${curUiScale === l ? ' on' : ''}" data-uiscale="${l}">${l}</button>`).join('')}</span></div>` +
        `<div class="set-row"><span class="set-k">Loading animation</span><span class="set-seg" id="set-anim">${['off', 'light', 'full'].map((l) => `<button class="set-seg-b${curAnim === l ? ' on' : ''}" data-anim="${l}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</span></div>` +
      '</div>' +
      '<div class="set-section"><div class="set-section-t">System · read-only</div>' + sys + '</div>';
    // wire
    document.querySelectorAll('#set-body .set-theme').forEach((b) => { b.onclick = () => { applyTheme(b.dataset.theme, curMode); render(st); }; });
    document.getElementById('set-mode-t').onclick = () => { applyTheme(curTheme, curMode === 'light' ? 'dark' : 'light'); render(st); };
    document.getElementById('set-calm-t').onclick = () => { setCalm(!calm); render(st); };
    document.querySelectorAll('#set-uiscale .set-seg-b').forEach((b) => { b.onclick = () => { applyUiScale(b.dataset.uiscale); render(st); }; });
    document.querySelectorAll('#set-anim .set-seg-b').forEach((b) => { b.onclick = () => { applyAnim(b.dataset.anim); render(st); }; });
    const fl = document.getElementById('set-folders-link'); if (fl) fl.onclick = () => { close(); openPerms(); };
  }
  { const trigger = document.getElementById('rail-settings'); if (trigger) trigger.onclick = open; }
  document.getElementById('settings-x').onclick = close;
  SETTINGS.addEventListener('click', (e) => { if (e.target === SETTINGS) close(); });
  // Modal-owned Escape: consume it (stopPropagation) so the global unwind (app.js, C2)
  // never also steps a layer on the same keypress. Document-level → runs before window.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !SETTINGS.hidden) { e.stopPropagation(); close(); } });
  return { open, close };
}
