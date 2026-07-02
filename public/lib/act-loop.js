// act-loop.js — the Act loop made visible (D4). Pure: derives the Brief → Session →
// Capture → Insight pipeline state from one /api/agent/sessions row (which already
// carries mapped/alive/captured/grown/sourceTitle — no new server data needed).
// Rendering lives in agents-ui.js; the dock's compact lane row uses laneSummary.

// loopSteps(row) → [{ id, state: 'done'|'active'|'pending', label, detail }]
// done = the loop moved past this station · active = the current one · pending = not yet.
export function loopSteps(row = {}) {
  const mapped = !!row.mapped, alive = !!row.alive, captured = !!row.captured;
  const brief = mapped
    ? { id: 'brief', state: 'done', label: 'Brief', detail: row.nodeName || '' }
    : { id: 'brief', state: 'pending', label: 'Brief', detail: 'outside the graph' };
  const session = alive
    ? { id: 'session', state: 'active', label: 'Session', detail: '● live' }
    : { id: 'session', state: 'done', label: 'Session', detail: row.model || row.launcher || '' };
  const capture = captured
    ? { id: 'capture', state: 'done', label: 'Capture', detail: row.grown ? 'new output since capture' : (row.sourceTitle || '') }
    : alive
      ? { id: 'capture', state: 'pending', label: 'Capture', detail: 'when the session ends' }
      : mapped
        ? { id: 'capture', state: 'active', label: 'Capture', detail: 'ready to capture' }
        : { id: 'capture', state: 'pending', label: 'Capture', detail: 'not graph-launched' };
  const insight = captured
    ? { id: 'insight', state: 'active', label: 'Insight', detail: 'summarize to grow one' }
    : { id: 'insight', state: 'pending', label: 'Insight', detail: '' };
  return [brief, session, capture, insight];
}

// The rail status chip: live ▸ grown ▸ captured ▸ ended (first match wins).
export function sessionChip(row = {}) {
  if (row.alive) return { cls: 'live', label: '● live' };
  if (row.captured && row.grown) return { cls: 'grown', label: 'grew ↻' };
  if (row.captured) return { cls: 'captured', label: '✓ captured' };
  return { cls: 'ended', label: 'ended' };
}

// The dock lane, shrunk to one line: "N agent sessions · M live" (opens the lens).
export function laneSummary(rows = []) {
  const n = rows.length, live = rows.filter((r) => r && r.alive).length;
  return `${n} agent session${n === 1 ? '' : 's'} · ${live} live`;
}

// ── rail archiving (source of truth = Slipway's session index; `archived` rides in on
// each /api/agent/sessions row). Archiving is a rail-VISIBILITY concern ONLY — a captured
// session's graph Source/INFORMS edges stay visible in the graph forever regardless. ──

export const RECENT_DAYS = 7;   // ended within this window counts as "Recent"

// sessionBucket(row, now) → 'live' | 'archived' | 'recent' | 'older'.
// Mutually exclusive, first match wins: archived (explicit) > live > recent (ended ≤ N days)
// > older (ended long ago, not yet archived). Defensive against absent timestamps.
export function sessionBucket(row = {}, now = Date.now()) {
  if (row.archived) return 'archived';
  if (row.alive) return 'live';
  const ms = endedMs(row);
  if (ms == null) return 'recent';                       // unknown end time → treat as recent
  return (now - ms) <= RECENT_DAYS * 86400000 ? 'recent' : 'older';
}

// The ended instant in epoch-ms, from Slipway's `ended` (epoch seconds) or the ISO archivedAt,
// else the launchedAt ISO. null when nothing usable is present.
function endedMs(row) {
  if (row.ended) return row.ended * 1000;
  for (const iso of [row.archivedAt, row.launchedAt]) {
    if (iso) { const t = Date.parse(iso); if (!Number.isNaN(t)) return t; }
  }
  return null;
}

// filterSessions(sessions, filter, now) → { visible, counts }.
//   filter 'live'|'recent'  → the default working set: everything not archived (live + recent
//                             + older-but-unarchived), so an old ended session is never hidden
//                             until it is explicitly archived.
//   filter 'archived'       → only archived rows (still rendered — never removed from the graph).
// counts = { live, recent, archived } for the chip badges. Pure; never mutates the input.
export function filterSessions(sessions = [], filter = 'live', now = Date.now()) {
  const counts = { live: 0, recent: 0, archived: 0 };
  for (const s of sessions) {
    const b = sessionBucket(s, now);
    if (b === 'archived') counts.archived++;
    else if (b === 'live') counts.live++;
    else counts.recent++;                                 // 'recent' + 'older' both badge under Recent
  }
  const visible = sessions.filter((s) => {
    const archived = sessionBucket(s, now) === 'archived';
    return filter === 'archived' ? archived : !archived;
  });
  return { visible, counts };
}
