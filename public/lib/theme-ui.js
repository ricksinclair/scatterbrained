// theme-ui.js — the theme engine, extracted from app.js (app.js split). Owns the
// runtime theme/mode/calm/anim state: writes the CSS vars + --hl-* palette on
// <html>, persists to localStorage, wires the toolbar buttons (set-theme /
// set-mode / set-calm), and restores persisted prefs (or system defaults) on init.
// The theme tables are pure data in themes.js.
//
// ctx (deps): {
//   poke()          — nudge the graph render loop after a repaint (safe pre-graph),
//   onCalmChange(c) — let the graph react to calm (particles, pause/resume),
//   notifyEmbeds()? — push the new theme to embedded panels (the Slipway iframe, D5);
//                     late-bound in app.js (agents-ui registers after the theme engine).
// }
// Returns { applyTheme, setCalm, applyAnim, colorOf, current } — current() returns
// the LIVE state object { theme, name, mode, calm, anim } (mutated in place, so
// callers may cache the reference and read fresh values every frame).
import { THEMES, THEME_ORDER, SYNTAX } from './themes.js';

export function initTheme(ctx) {
  const state = { theme: THEMES.observatory.dark, name: 'scatterbrained', mode: 'dark', calm: false, anim: 'full', uiscale: 'M' };

  const colorOf = (label) => state.theme.palette[label] || [120, 130, 190];

  // UI size (Settings): 'S' | 'M' | 'L' → --ui-scale, which the type + control
  // tokens in tokens.css multiply through. Persisted locally.
  const UI_SCALES = { S: 0.9, M: 1, L: 1.15 };
  function applyUiScale(level) {
    state.uiscale = UI_SCALES[level] ? level : 'M';
    document.documentElement.style.setProperty('--ui-scale', String(UI_SCALES[state.uiscale]));
    try { localStorage.setItem('scatterbrained.uiscale', state.uiscale); } catch (e) {}
    if (ctx.notifyEmbeds) ctx.notifyEmbeds();
  }

  // Loading-animation intensity (Settings): 'off' | 'light' | 'full'. Gates the boot
  // constellation's drama via <html data-anim>; persisted locally.
  function applyAnim(level) {
    state.anim = ['off', 'light', 'full'].includes(level) ? level : 'full';
    document.documentElement.setAttribute('data-anim', state.anim);
    try { localStorage.setItem('scatterbrained.anim', state.anim); } catch (e) {}
  }

  function applyTheme(name, mode) {
    state.name = THEMES[name] ? name : 'scatterbrained';
    state.mode = mode === 'light' ? 'light' : 'dark';
    state.theme = THEMES[state.name][state.mode];
    const r = document.documentElement.style, v = state.theme;
    r.setProperty('--bg0', v.bg[1]); r.setProperty('--bg1', v.bg[0]);
    r.setProperty('--ink', v.ink); r.setProperty('--ink-dim', v.inkDim); r.setProperty('--ink-faint', v.inkFaint);
    r.setProperty('--line', v.line); r.setProperty('--panel', v.panel); r.setProperty('--surface', v.surface); r.setProperty('--surface-2', v.surface2);
    r.setProperty('--accent', v.accent); r.setProperty('--accent-contrast', v.accentContrast); r.setProperty('--accent-soft', v.accentSoft); r.setProperty('--warn', v.warn); r.setProperty('--ok', v.ok);
    // Syntax-highlight palette (code review viewer) — editor-grade, mode-aware: One Dark
    // for dark, One Light for light. Driven here (not CSS) since mode is JS-applied.
    const hl = SYNTAX[state.mode] || SYNTAX.dark;
    for (const k in hl) r.setProperty('--hl-' + k, hl[k]);
    document.documentElement.setAttribute('data-mode', state.mode);
    try { localStorage.setItem('scatterbrained.theme', state.name); localStorage.setItem('scatterbrained.mode', state.mode); } catch (e) {}
    const mb = document.getElementById('set-mode'); if (mb) mb.innerHTML = state.mode === 'light' ? '<i class="ti ti-sun" aria-hidden="true"></i>' : '<i class="ti ti-moon" aria-hidden="true"></i>';
    const tb = document.getElementById('set-theme'); if (tb) tb.title = 'Theme: ' + THEMES[state.name].label + ' (click to cycle)';
    if (ctx.notifyEmbeds) ctx.notifyEmbeds();   // live theme bridge → embedded Slipway (D5)
    ctx.poke();
  }

  function setCalm(on) {
    state.calm = !!on; document.body.classList.toggle('calm', state.calm);
    const b = document.getElementById('set-calm'); if (b) b.classList.toggle('on', state.calm);
    try { localStorage.setItem('scatterbrained.calm', state.calm ? '1' : '0'); } catch (e) {}
    ctx.onCalmChange(state.calm);
  }

  // theme + calm moved into Settings (declutter); dark/light stays on the toolbar.
  { const b = document.getElementById('set-theme'); if (b) b.onclick = () => { const i = THEME_ORDER.indexOf(state.name); applyTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length], state.mode); }; }
  { const b = document.getElementById('set-mode'); if (b) b.onclick = () => applyTheme(state.name, state.mode === 'light' ? 'dark' : 'light'); }
  { const b = document.getElementById('set-calm'); if (b) b.onclick = () => setCalm(!state.calm); }

  // Restore persisted prefs (or system defaults). Initial calm sets state + classes
  // directly — NOT via setCalm — so the graph hook isn't poked before the graph exists.
  let st, sm, sc, sa, su;
  try { st = localStorage.getItem('scatterbrained.theme'); sm = localStorage.getItem('scatterbrained.mode'); sc = localStorage.getItem('scatterbrained.calm'); sa = localStorage.getItem('scatterbrained.anim'); su = localStorage.getItem('scatterbrained.uiscale'); } catch (e) {}
  const mq = (q) => window.matchMedia && window.matchMedia(q).matches;
  applyTheme(st || 'observatory', sm || (mq('(prefers-color-scheme: light)') ? 'light' : 'dark'));
  // reduced-motion → calm bridge: with no stored preference, the OS setting wins.
  state.calm = sc != null ? sc === '1' : mq('(prefers-reduced-motion: reduce)');
  document.body.classList.toggle('calm', state.calm);
  const cb = document.getElementById('set-calm'); if (cb) cb.classList.toggle('on', state.calm);   // moved into Settings; may be absent
  applyAnim(sa || (mq('(prefers-reduced-motion: reduce)') ? 'off' : 'full'));
  applyUiScale(su || 'M');

  return { applyTheme, setCalm, applyAnim, applyUiScale, colorOf, current: () => state };
}
