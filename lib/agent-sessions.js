// agent-sessions.js — the Studio-side record of "Open agent here" launches (Act plane, Phase 3).
// Pure map operations (no fs — the server owns IO, same discipline as lib/filelock.js): which
// Slipway session came from which graph node, and whether it was captured into the graph.
// The map is persisted at ~/.scatterbrained/agent-sessions.json, keyed by Slipway sid.

export const MAX_SESSIONS = 200;   // mirrors Slipway's own index cap

// Record a launch. Stores nodeName+nodeLabel alongside nodeId because Neo4j elementIds are
// NOT durable across export/import — capture falls back to a name lookup.
export function addSession(map, { sid, nodeId, nodeName, nodeLabel, cwd, briefPath, label, launchedAt }) {
  const next = { ...map };
  next[sid] = { sid, nodeId, nodeName, nodeLabel, cwd, briefPath, label, launchedAt, captured: false };
  return pruneSessions(next);
}

export function markCaptured(map, sid, { capturedAt, sourceTitle, transcriptBytes, contentHash } = {}) {
  if (!map[sid]) return map;
  const next = { ...map };
  next[sid] = { ...next[sid], captured: true, capturedAt, sourceTitle, transcriptBytes, contentHash };
  return next;
}

// Keep the newest MAX by launchedAt. Pruning loses only the dock row — the graph Source and
// the on-disk transcript survive; captured entries are not spared (same cap as Slipway).
export function pruneSessions(map, max = MAX_SESSIONS) {
  const all = Object.values(map);
  if (all.length <= max) return map;
  const keep = all
    .sort((a, b) => String(b.launchedAt || '').localeCompare(String(a.launchedAt || '')))
    .slice(0, max);
  return Object.fromEntries(keep.map((s) => [s.sid, s]));
}

// Join the mapping with Slipway's /api/term/history rows (null when Slipway is unreachable)
// and server-gathered transcript stats ({[sid]: {bytes, mtimeMs}}). Newest-first. Rows:
//   mapped   → full context (node, capture state, Capture eligibility)
//   unmapped → Slipway-native sessions (listed, marked outside-the-graph, not capturable)
// Slipway's terminals die with its process, so history==null ⇒ nothing is alive.
export function sessionsView(map, historyRows, stats = {}) {
  const bySid = new Map((historyRows || []).map((h) => [h.id, h]));
  const rows = [];
  for (const s of Object.values(map)) {
    const h = bySid.get(s.sid);
    const st = stats[s.sid] || {};
    rows.push({
      sid: s.sid, mapped: true,
      nodeId: s.nodeId, nodeName: s.nodeName, nodeLabel: s.nodeLabel,
      cwd: s.cwd, label: s.label || (h && h.label) || '', launchedAt: s.launchedAt,
      model: (h && h.model) || '', launcher: (h && h.launcher) || '',
      alive: !!(h && h.alive), ended: (h && h.ended) || null,
      transcriptBytes: st.bytes != null ? st.bytes : ((h && h.transcript_bytes) || 0),
      transcriptMtime: st.mtimeMs || null,
      captured: !!s.captured, capturedAt: s.capturedAt || null,
      sourceTitle: s.sourceTitle || null,
      // Rail-visibility archive flag, owned by Slipway's index (never a graph concern).
      archived: !!(h && h.archived), archivedAt: (h && h.archived_at) || null,
      // "new output since capture" hint for the Re-capture affordance
      grown: !!(s.captured && st.bytes != null && s.transcriptBytes != null && st.bytes > s.transcriptBytes),
    });
    bySid.delete(s.sid);
  }
  for (const h of bySid.values()) {
    rows.push({
      sid: h.id, mapped: false, nodeId: null, nodeName: null, nodeLabel: null,
      cwd: h.cwd || '', label: h.label || h.kind || '', launchedAt: h.created ? new Date(h.created * 1000).toISOString() : null,
      model: h.model || '', launcher: h.launcher || '',
      alive: !!h.alive, ended: h.ended || null,
      transcriptBytes: h.transcript_bytes || 0, transcriptMtime: null,
      captured: false, capturedAt: null, sourceTitle: null,
      archived: !!h.archived, archivedAt: h.archived_at || null,
      grown: false,
    });
  }
  return rows.sort((a, b) => String(b.launchedAt || '').localeCompare(String(a.launchedAt || '')));
}
