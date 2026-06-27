// tour-ui.js — the guided auto-play tour, extracted from app.js (app.js modularization).
// Declarative steps live in ./tour.js; here we interpret each over the live app (every action
// try/caught so a missing demo node never breaks the walk). Stop button + #tour deep-link.
// Best over the demo graph (examples/seed-demo.cypher). Self-contained: reads window.__focus,
// sets window.__toggleTour, and drives the live DOM — takes no app.js refs.
import { TOUR } from './tour.js';

export function initTour() {
  let _tourTimer = null, _tourOn = false;
  function _tourAction(s) {
    try {
      if (s.escape) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if ('focus' in s) {
        if (s.focus === null) { const fc = document.getElementById('focus-clear'); if (fc) fc.click(); }
        else if (window.__focus) window.__focus(s.focus);
      }
      if (s.click) (Array.isArray(s.click) ? s.click : [s.click]).forEach((sel) => { const el = document.querySelector(sel); if (el) el.click(); });
      if (s.type != null) { const q = document.getElementById('q'); if (q) { q.value = s.type; q.dispatchEvent(new Event('input', { bubbles: true })); } }
      if (s.scrollTo) setTimeout(() => { const el = document.querySelector(s.scrollTo); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 400);
    } catch (e) {}
  }
  function _tourCap(html, i) {
    const c = document.getElementById('tour-cap'); if (!c) return;
    c.classList.remove('show');
    const dots = TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    setTimeout(() => { c.innerHTML = `<span class="tour-text">${html}</span><span class="tour-dots">${dots}</span>`; c.classList.add('show'); }, 160);
  }
  function _tourStep(i) {
    if (!_tourOn) return;
    if (i >= TOUR.length) { setTimeout(stopTour, 1200); return; }
    _tourAction(TOUR[i]);
    _tourCap(TOUR[i].caption, i);
    _tourTimer = setTimeout(() => _tourStep(i + 1), TOUR[i].wait);
  }
  function startTour() {
    if (_tourOn) return;
    _tourOn = true;
    const b = document.getElementById('tour-btn'); if (b) b.textContent = '■ Stop';
    _tourStep(0);
  }
  function stopTour() {
    _tourOn = false;
    clearTimeout(_tourTimer);
    const b = document.getElementById('tour-btn'); if (b) b.textContent = '▶ Tour';
    const c = document.getElementById('tour-cap'); if (c) c.classList.remove('show');
  }
  window.__toggleTour = () => (_tourOn ? stopTour() : startTour());
  { const b = document.getElementById('tour-btn'); if (b) b.onclick = window.__toggleTour; }
  if (location.hash === '#tour') setTimeout(startTour, 1400);   // deep-link auto-start (for the showcase)
}
