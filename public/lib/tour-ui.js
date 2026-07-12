// tour-ui.js — the tour runner (schema v2). Declarative steps live in ./tour.js; here we drive them
// over the live app with a spotlight overlay + a Back/Next popover, keeping the old real-UI actions
// (focus/click/type/scrollTo/escape — every action try/caught so a missing node never breaks the walk).
// The SHOWCASE auto-advances (steps carry `wait`); per-surface tours advance manually. Persistence
// (seen/snooze) + a first-run offer-toast live here; the placement math + store logic are pure in tour.js.
import { TOUR, TOURS, TOUR_LABELS, popoverPosition, markTourSeen, snoozeTours, shouldOfferTour } from './tour.js';

export function initTour() {
  const STORE_KEY = 'sb.tour';
  const loadStore = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
  const saveStore = (s) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ } };
  const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

  let steps = null, idx = 0, tourId = null, autoTimer = null, overlay = null;

  function _tourAction(s) {
    try {
      if (s.escape) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if ('focus' in s) {
        if (s.focus === null) { const fc = document.getElementById('focus-clear'); if (fc) fc.click(); }
        else if (window.__focus) window.__focus(s.focus);
      }
      if (s.click) (Array.isArray(s.click) ? s.click : [s.click]).forEach((sel) => { const el = document.querySelector(sel); if (el) el.click(); });
      if (s.type != null) { const q = document.getElementById('q'); if (q) { q.value = s.type; q.dispatchEvent(new Event('input', { bubbles: true })); } }
      if (s.scrollTo) setTimeout(() => { const el = document.querySelector(s.scrollTo); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 380);
    } catch (e) { /* a missing demo node never breaks the walk */ }
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="tour-spot" aria-hidden="true"></div>' +
      '<div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-pop-title">' +
        '<div class="tour-pop-h"><span class="tour-pop-title" id="tour-pop-title"></span>' +
        '<button class="tour-pop-x" title="end tour" aria-label="end tour">✕</button></div>' +
        '<div class="tour-pop-body"></div>' +
        '<div class="tour-pop-foot"><span class="tour-pop-prog"></span>' +
        '<span class="tour-pop-btns"><button class="tour-back">‹ Back</button>' +
        '<button class="tour-next">Next ›</button></span></div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.tour-pop-x').onclick = stop;
    overlay.querySelector('.tour-back').onclick = () => go(idx - 1);
    overlay.querySelector('.tour-next').onclick = () => go(idx + 1);
    // The shade swallows app clicks; clicking the shade itself does nothing (use the buttons/Esc).
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.classList.contains('tour-spot')) e.stopPropagation(); });
    // Tour owns the keyboard while open (capture phase, before the app's global Esc handler).
    document.addEventListener('keydown', (e) => {
      if (!overlay || overlay.hidden) return;
      if (e.key === 'Escape') { e.stopPropagation(); stop(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.stopPropagation(); go(idx + 1); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(idx - 1); }
    }, true);
    return overlay;
  }

  function positionPopover(targetSel) {
    const pop = overlay.querySelector('.tour-pop');
    const spot = overlay.querySelector('.tour-spot');
    const el = targetSel ? document.querySelector(targetSel) : null;
    const r = (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : null;
    const pad = 6;
    let targetRect = null;
    if (r && r.width && r.height) {
      spot.style.display = 'block';
      spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
      overlay.classList.remove('tour-overlay--dim');
      targetRect = { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    } else {
      spot.style.display = 'none';
      overlay.classList.add('tour-overlay--dim');   // no target → full shade, centered popover
    }
    const pos = popoverPosition(targetRect, { w: window.innerWidth, h: window.innerHeight }, { w: pop.offsetWidth || 320, h: pop.offsetHeight || 160 });
    pop.style.left = pos.left + 'px'; pop.style.top = pos.top + 'px';
    pop.dataset.placement = pos.placement;
  }

  function render() {
    const s = steps[idx];
    const auto = typeof s.wait === 'number';
    overlay.querySelector('.tour-pop-title').innerHTML = s.title;     // trusted authored copy
    overlay.querySelector('.tour-pop-body').innerHTML = s.caption;
    overlay.querySelector('.tour-pop-prog').textContent = `${idx + 1} / ${steps.length}`;
    const back = overlay.querySelector('.tour-back'), next = overlay.querySelector('.tour-next');
    back.disabled = idx === 0;
    next.textContent = idx === steps.length - 1 ? 'Done' : (auto ? 'Skip ›' : 'Next ›');
    _tourAction(s);
    clearTimeout(autoTimer);
    // let the action settle (panels open / animate) before measuring + spotlighting
    setTimeout(() => { if (steps) positionPopover(s.target); }, 400);
    if (auto) autoTimer = setTimeout(() => go(idx + 1), s.wait);
  }

  function go(i) {
    if (!steps) return;
    if (i >= steps.length) return void finish(true);
    if (i < 0) return;
    idx = i; render();
  }

  function start(id = 'showcase') {
    steps = TOURS[id] || TOUR; tourId = id; idx = 0;
    ensureOverlay(); overlay.hidden = false;
    dismissOffer();
    render();
  }

  function finish(completed) {
    clearTimeout(autoTimer); autoTimer = null;
    if (overlay) overlay.hidden = true;
    if (tourId) { const st = markTourSeen(loadStore(), tourId); saveStore(st); }   // seen → the offer won't re-fire
    steps = null; tourId = null;
  }
  function stop() { finish(false); }

  // ── first-run offer-toast (dismissible, snoozes on Later) ────────────────────
  let offerEl = null;
  function dismissOffer() { if (offerEl) { offerEl.remove(); offerEl = null; } }
  function maybeOffer() {
    if (document.querySelector('.tour-offer')) return;   // the what's-new toast has the slot this boot
    if (!shouldOfferTour(loadStore(), Date.now())) return;
    offerEl = document.createElement('div');
    offerEl.className = 'tour-offer';
    offerEl.innerHTML = '<span class="tour-offer-t">New here? Take the 60-second tour.</span>' +
      '<span class="tour-offer-btns"><button class="tour-offer-later">Later</button>' +
      '<button class="tour-offer-go">Start tour</button></span>';
    document.body.appendChild(offerEl);
    offerEl.querySelector('.tour-offer-go').onclick = () => start('showcase');
    offerEl.querySelector('.tour-offer-later').onclick = () => { saveStore(snoozeTours(loadStore(), Date.now() + SNOOZE_MS)); dismissOffer(); };
  }

  // ── entry points ─────────────────────────────────────────────────────────────
  window.__toggleTour = () => (overlay && !overlay.hidden ? stop() : start('showcase'));
  window.__startTour = (id) => start(id);
  window.__tourLabels = TOUR_LABELS;
  { const b = document.getElementById('tour-btn'); if (b) b.onclick = window.__toggleTour; }
  if (location.hash === '#tour') setTimeout(() => start('showcase'), 1400);   // deep-link → showcase
  setTimeout(maybeOffer, 2200);                                                // after the app settles
}
