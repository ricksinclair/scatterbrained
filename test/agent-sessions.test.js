import { describe, it, expect } from 'vitest';
import { addSession, markCaptured, pruneSessions, sessionsView, MAX_SESSIONS } from '../lib/agent-sessions.js';

// The Studio-side launch record (Act plane Phase 3): pure map ops over
// ~/.scatterbrained/agent-sessions.json (server owns the IO, filelock.js discipline).

const launch = (sid, at = '2026-07-01T10:00:00Z', extra = {}) => ({
  sid, nodeId: 'eid-' + sid, nodeName: 'Node ' + sid, nodeLabel: 'Project',
  cwd: '/repo', briefPath: '/repo/SLIPWAY_BRIEF.md', label: 'agent', launchedAt: at, ...extra,
});

describe('addSession / markCaptured', () => {
  it('records a launch keyed by sid, uncaptured', () => {
    const m = addSession({}, launch('aa11'));
    expect(m.aa11).toMatchObject({ sid: 'aa11', nodeName: 'Node aa11', nodeLabel: 'Project', captured: false });
  });

  it('markCaptured stamps capture state without touching other fields', () => {
    let m = addSession({}, launch('aa11'));
    m = markCaptured(m, 'aa11', { capturedAt: '2026-07-01T11:00:00Z', sourceTitle: 'agent-session/aa11', transcriptBytes: 42, contentHash: 'h' });
    expect(m.aa11).toMatchObject({ captured: true, sourceTitle: 'agent-session/aa11', transcriptBytes: 42, nodeName: 'Node aa11' });
  });

  it('markCaptured on an unknown sid is a no-op', () => {
    const m = { aa11: launch('aa11') };
    expect(markCaptured(m, 'zz99', {})).toBe(m);
  });

  it('is pure — inputs are not mutated', () => {
    const m = addSession({}, launch('aa11'));
    markCaptured(m, 'aa11', { sourceTitle: 't' });
    expect(m.aa11.captured).toBe(false);
  });
});

describe('pruneSessions — newest MAX by launchedAt', () => {
  it('keeps the newest and evicts the oldest (captured entries not spared)', () => {
    let m = {};
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      m = addSession(m, launch('s' + String(i).padStart(4, '0'), `2026-07-01T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`));
    }
    expect(Object.keys(m)).toHaveLength(MAX_SESSIONS);
    expect(m.s0000).toBeUndefined();          // oldest evicted
    expect(m['s' + String(MAX_SESSIONS + 4).padStart(4, '0')]).toBeDefined();  // newest kept
  });

  it('leaves small maps untouched (same reference)', () => {
    const m = { a: launch('a') };
    expect(pruneSessions(m)).toBe(m);
  });
});

describe('sessionsView — join with Slipway history + fs stats', () => {
  const hist = [
    { id: 'aa11', label: 'agent · claude', kind: 'launcher', launcher: 'claude', model: 'M1', cwd: '/repo', created: 1782900000, alive: true, transcript_bytes: 10 },
    { id: 'ff99', label: 'shell', kind: 'shell', launcher: '', model: '', cwd: '', created: 1782900100, alive: false, ended: 1782900200, transcript_bytes: 5 },
  ];

  it('mapped sessions get node context + liveness from history + bytes from stats', () => {
    const m = addSession({}, launch('aa11'));
    const rows = sessionsView(m, hist, { aa11: { bytes: 999, mtimeMs: 123 } });
    const r = rows.find((x) => x.sid === 'aa11');
    expect(r).toMatchObject({ mapped: true, nodeName: 'Node aa11', alive: true, model: 'M1', transcriptBytes: 999, transcriptMtime: 123 });
  });

  it('unmapped history rows are listed but not capturable context (mapped:false)', () => {
    const rows = sessionsView({}, hist, {});
    const r = rows.find((x) => x.sid === 'ff99');
    expect(r).toMatchObject({ mapped: false, nodeName: null, alive: false, ended: 1782900200, transcriptBytes: 5 });
    expect(r.launchedAt).toMatch(/^2026-/);   // derived from created epoch
  });

  it('history null (Slipway down) ⇒ nothing is alive, mapped rows survive', () => {
    const m = addSession({}, launch('aa11'));
    const rows = sessionsView(m, null, { aa11: { bytes: 7, mtimeMs: 1 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sid: 'aa11', alive: false, transcriptBytes: 7 });
  });

  it('flags grown=true when the transcript outgrew the captured byte count', () => {
    let m = addSession({}, launch('aa11'));
    m = markCaptured(m, 'aa11', { transcriptBytes: 10, sourceTitle: 't' });
    const rows = sessionsView(m, null, { aa11: { bytes: 20, mtimeMs: 1 } });
    expect(rows[0].grown).toBe(true);
    const same = sessionsView(m, null, { aa11: { bytes: 10, mtimeMs: 1 } });
    expect(same[0].grown).toBe(false);
  });

  it('carries Slipway archive flags through to mapped and unmapped rows', () => {
    const h = [
      { id: 'aa11', label: 'agent', model: 'M1', created: 1782900000, alive: false, ended: 1782900100, transcript_bytes: 10, archived: true, archived_at: '2026-07-02T00:00:00Z' },
      { id: 'ff99', label: 'shell', kind: 'shell', created: 1782900200, alive: false, transcript_bytes: 5, archived: true, archived_at: '2026-07-02T01:00:00Z' },
    ];
    const m = addSession({}, launch('aa11'));
    const rows = sessionsView(m, h, {});
    const mapped = rows.find((x) => x.sid === 'aa11');
    const native = rows.find((x) => x.sid === 'ff99');
    expect(mapped).toMatchObject({ archived: true, archivedAt: '2026-07-02T00:00:00Z' });
    expect(native).toMatchObject({ archived: true, archivedAt: '2026-07-02T01:00:00Z' });
  });

  it('defaults archived=false when Slipway omits the field (back-compat)', () => {
    const m = addSession({}, launch('aa11'));
    const rows = sessionsView(m, hist, {});
    expect(rows.find((x) => x.sid === 'aa11')).toMatchObject({ archived: false, archivedAt: null });
    expect(rows.find((x) => x.sid === 'ff99')).toMatchObject({ archived: false, archivedAt: null });
  });

  it('sorts newest-first by launchedAt', () => {
    let m = addSession({}, launch('old1', '2026-06-01T00:00:00Z'));
    m = addSession(m, launch('new1', '2026-07-01T00:00:00Z'));
    const rows = sessionsView(m, null, {});
    expect(rows.map((r) => r.sid)).toEqual(['new1', 'old1']);
  });
});
