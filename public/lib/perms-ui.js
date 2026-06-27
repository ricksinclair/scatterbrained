// perms-ui.js — folder permissions pane: view/grant/revoke the read & map allowlist.
// Extracted from app.js (app.js modularization). The repo-list cache lives in app.js
// (shared with the codebase + review surfaces), so a successful grant/revoke invalidates it
// via onRootsChanged() rather than reaching across surfaces.
// deps: { esc, onRootsChanged }
// returns { open, close }.
export function initPerms({ esc, onRootsChanged }) {
  const PERMS = document.getElementById('perms');
  if (!PERMS) return { open() {}, close() {} };
  function permsMsg(text, ok) { const m = document.getElementById('perms-msg'); m.textContent = text || ''; m.classList.toggle('ok', !!ok); }
  async function loadPerms() {
    permsMsg('');
    let data; try { data = await fetch('/api/roots').then((r) => r.json()); } catch (e) { return permsMsg(String(e)); }
    const list = document.getElementById('perms-list');
    list.innerHTML = (data.roots || []).map((r) => `
      <div class="perms-row ${r.exists ? '' : 'gone'}">
        <span class="pr-dot" title="${r.exists ? 'available' : 'folder missing'}"></span>
        <span class="pr-main"><div class="pr-name">${esc(r.name)}</div><div class="pr-path">${esc(r.path)}</div>${(r.tags && r.tags.length) ? `<div class="pr-tags">${esc(r.tags.join(' · '))}</div>` : ''}</span>
        <button class="pr-revoke" data-path="${esc(r.path)}">revoke</button>
      </div>`).join('') || '<div class="dk-empty" style="padding:14px 0">no folders granted</div>';
    list.querySelectorAll('.pr-revoke').forEach((b) => { b.onclick = () => mutatePerms('remove', b.dataset.path); });
  }
  async function mutatePerms(action, p, tags) {
    permsMsg(action === 'add' ? 'granting…' : 'revoking…');
    let res; try { res = await fetch('/api/roots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, path: p, tags }) }).then((r) => r.json()); }
    catch (e) { return permsMsg(String(e)); }
    if (res.error) return permsMsg(res.error);
    permsMsg(action === 'add' ? 'granted ✓' : 'revoked ✓', true);
    document.getElementById('perms-path').value = ''; document.getElementById('perms-tags').value = '';
    onRootsChanged();                    // codebase repo list derives from roots — refresh next open
    loadPerms();
  }
  function open() { PERMS.hidden = false; loadPerms(); }
  function close() { PERMS.hidden = true; }

  document.getElementById('perms-x').onclick = close;
  document.getElementById('perms-grant').onclick = () => {
    const p = document.getElementById('perms-path').value.trim();
    const tags = document.getElementById('perms-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    if (p) mutatePerms('add', p, tags);
  };
  document.getElementById('perms-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('perms-grant').click(); });
  PERMS.addEventListener('click', (e) => { if (e.target === PERMS) close(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !PERMS.hidden) close(); });
  // set-folders moved into Settings (declutter); openPerms is still reached via the
  // Settings "manage" link. Guard in case the toolbar button is absent.
  const sf = document.getElementById('set-folders'); if (sf) sf.onclick = open;
  return { open, close };
}
