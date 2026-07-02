import { describe, it, expect } from 'vitest';
import { loopSteps, sessionChip, laneSummary, filterSessions, sessionBucket, RECENT_DAYS } from '../public/lib/act-loop.js';

// The Act loop made visible (D4): Brief → Session → Capture → Insight, derived per
// session row from /api/agent/sessions (mapped/alive/captured/grown/sourceTitle).
// done = the loop reached past this step · active = the current step · pending = not yet.

const row = (extra = {}) => ({
  sid: 'aa11', mapped: true, nodeName: 'Scatterbrained Studio', nodeLabel: 'Project',
  alive: false, captured: false, grown: false, sourceTitle: null,
  model: 'qwen3', launcher: 'claude', launchedAt: '2026-07-01T10:00:00Z', ...extra,
});

const states = (steps) => steps.map((s) => s.state);
const ids = (steps) => steps.map((s) => s.id);

describe('loopSteps — the four stations, in order', () => {
  it('always returns Brief → Session → Capture → Insight', () => {
    expect(ids(loopSteps(row()))).toEqual(['brief', 'session', 'capture', 'insight']);
    expect(loopSteps(row()).map((s) => s.label)).toEqual(['Brief', 'Session', 'Capture', 'Insight']);
  });

  it('live mapped session: brief done, session active, rest pending', () => {
    const steps = loopSteps(row({ alive: true }));
    expect(states(steps)).toEqual(['done', 'active', 'pending', 'pending']);
    expect(steps[0].detail).toBe('Scatterbrained Studio');   // the brief came from this node
    expect(steps[1].detail).toMatch(/live/);
  });

  it('ended, uncaptured: capture is the active (next) step', () => {
    const steps = loopSteps(row());
    expect(states(steps)).toEqual(['done', 'done', 'active', 'pending']);
    expect(steps[1].detail).toBe('qwen3');                    // what ran (model over launcher)
  });

  it('captured: capture done (names the Source), insight becomes the active step', () => {
    const steps = loopSteps(row({ captured: true, sourceTitle: 'agent-session/aa11' }));
    expect(states(steps)).toEqual(['done', 'done', 'done', 'active']);
    expect(steps[2].detail).toBe('agent-session/aa11');
    expect(steps[3].detail).toMatch(/summarize/i);
  });

  it('captured but grown: capture flags the new output (re-capture hint)', () => {
    const steps = loopSteps(row({ captured: true, sourceTitle: 't', grown: true }));
    expect(steps[2].state).toBe('done');
    expect(steps[2].detail).toMatch(/new output/i);
  });

  it('unmapped (Slipway-native) session: no brief, capture never eligible', () => {
    const steps = loopSteps(row({ mapped: false, nodeName: null }));
    expect(steps[0]).toMatchObject({ state: 'pending', detail: 'outside the graph' });
    expect(steps[2].state).toBe('pending');
    expect(steps[3].state).toBe('pending');
  });

  it('is defensive: an empty row still yields four well-formed steps', () => {
    const steps = loopSteps({});
    expect(steps).toHaveLength(4);
    steps.forEach((s) => expect(['done', 'active', 'pending']).toContain(s.state));
  });
});

describe('sessionChip — the rail status chip', () => {
  it('live wins over everything', () => {
    expect(sessionChip(row({ alive: true, captured: true }))).toEqual({ cls: 'live', label: '● live' });
  });
  it('grown (new output since capture) outranks plain captured', () => {
    expect(sessionChip(row({ captured: true, grown: true }))).toEqual({ cls: 'grown', label: 'grew ↻' });
  });
  it('captured, then plain ended', () => {
    expect(sessionChip(row({ captured: true }))).toEqual({ cls: 'captured', label: '✓ captured' });
    expect(sessionChip(row())).toEqual({ cls: 'ended', label: 'ended' });
  });
});

describe('laneSummary — the compact dock row', () => {
  it('counts sessions and live ones', () => {
    expect(laneSummary([row(), row({ alive: true }), row({ alive: true })])).toBe('3 agent sessions · 2 live');
  });
  it('singular form, zero live', () => {
    expect(laneSummary([row()])).toBe('1 agent session · 0 live');
  });
  it('empty/absent list', () => {
    expect(laneSummary([])).toBe('0 agent sessions · 0 live');
    expect(laneSummary()).toBe('0 agent sessions · 0 live');
  });
});

describe('sessionBucket — archived > live > recent > older (mutually exclusive)', () => {
  const NOW = Date.parse('2026-07-10T00:00:00Z');
  const endedDaysAgo = (d) => Math.floor((NOW - d * 86400000) / 1000);   // epoch seconds

  it('archived wins over everything, even a live-looking row', () => {
    expect(sessionBucket({ archived: true, alive: true }, NOW)).toBe('archived');
  });
  it('live when alive and not archived', () => {
    expect(sessionBucket({ alive: true }, NOW)).toBe('live');
  });
  it('recent = ended within the window', () => {
    expect(sessionBucket({ alive: false, ended: endedDaysAgo(1) }, NOW)).toBe('recent');
    expect(sessionBucket({ alive: false, ended: endedDaysAgo(RECENT_DAYS - 0.5) }, NOW)).toBe('recent');
  });
  it('older = ended beyond the window (still unarchived)', () => {
    expect(sessionBucket({ alive: false, ended: endedDaysAgo(RECENT_DAYS + 5) }, NOW)).toBe('older');
  });
  it('no end time → treated as recent (never silently older)', () => {
    expect(sessionBucket({ alive: false }, NOW)).toBe('recent');
  });
});

describe('filterSessions — the Live·Recent / Archived rail filter', () => {
  const NOW = Date.parse('2026-07-10T00:00:00Z');
  const secs = (iso) => Math.floor(Date.parse(iso) / 1000);
  const rows = [
    { sid: 'live1', alive: true },
    { sid: 'rec1', alive: false, ended: secs('2026-07-09T00:00:00Z') },      // recent
    { sid: 'old1', alive: false, ended: secs('2026-06-01T00:00:00Z') },      // older, unarchived
    { sid: 'arc1', alive: false, archived: true, ended: secs('2026-05-01T00:00:00Z') },
    { sid: 'arc2', alive: false, archived: true, ended: secs('2026-04-01T00:00:00Z') },
  ];

  it('default view (live) shows everything NOT archived — old unarchived stays visible', () => {
    const { visible } = filterSessions(rows, 'live', NOW);
    expect(visible.map((r) => r.sid)).toEqual(['live1', 'rec1', 'old1']);
  });
  it('archived view shows only archived rows — they are never dropped, only bucketed', () => {
    const { visible } = filterSessions(rows, 'archived', NOW);
    expect(visible.map((r) => r.sid)).toEqual(['arc1', 'arc2']);
  });
  it('counts drive the chip badges (older counts under Recent)', () => {
    const { counts } = filterSessions(rows, 'live', NOW);
    expect(counts).toEqual({ live: 1, recent: 2, archived: 2 });   // rec1 + old1 under recent
  });
  it('is pure — the input array is not mutated', () => {
    const copy = rows.slice();
    filterSessions(rows, 'archived', NOW);
    expect(rows).toEqual(copy);
  });
  it('defensive on empty/absent input', () => {
    expect(filterSessions([], 'live', NOW)).toEqual({ visible: [], counts: { live: 0, recent: 0, archived: 0 } });
    expect(filterSessions(undefined, 'archived', NOW).visible).toEqual([]);
  });
  it('archiving removes a row from the default view but keeps it under Archived', () => {
    const before = filterSessions(rows, 'live', NOW).visible.map((r) => r.sid);
    expect(before).toContain('old1');
    const archived = rows.map((r) => r.sid === 'old1' ? { ...r, archived: true } : r);
    expect(filterSessions(archived, 'live', NOW).visible.map((r) => r.sid)).not.toContain('old1');
    expect(filterSessions(archived, 'archived', NOW).visible.map((r) => r.sid)).toContain('old1');
  });
});
