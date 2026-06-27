// stale-banner-ui.js — the "graph changed → reload?" banner, driven by the server's SSE stream.
// Extracted from app.js (app.js modularization). Subscribes to /api/events and shows #stale-banner
// on a 'graph-changed' event; reload pulls fresh data, dismiss hides it. Self-contained except
// refreshGraphData (passed in). deps: { refreshGraphData }.
export function initStaleBanner({ refreshGraphData }) {
  const banner = document.getElementById('stale-banner');
  const reloadBtn = document.getElementById('stale-reload');
  const dismissBtn = document.getElementById('stale-dismiss');
  if (!banner || !reloadBtn || !dismissBtn) return;

  reloadBtn.onclick = async () => {
    banner.hidden = true;
    await refreshGraphData();
  };
  dismissBtn.onclick = () => { banner.hidden = true; };

  function connect() {
    const es = new EventSource('/api/events');
    es.addEventListener('graph-changed', () => { banner.hidden = false; });
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  }
  connect();
}
