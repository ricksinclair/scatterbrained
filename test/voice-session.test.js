import { describe, it, expect, vi } from 'vitest';
import { createVoiceSession, sayAckBudgetMs, STALE_MS } from '../lib/voice-session.js';

// Deterministic world: manual clock + captured timers the test fires by hand.
function world() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    tick: (ms) => { t += ms; },
    fire: (i) => { const cb = timers[i].cb; timers[i].fired = true; cb(); },
    timers,
    events: [],
    session: null,
    make() {
      this.session = createVoiceSession({
        now: () => t,
        setTimer: (cb, ms) => { timers.push({ cb, ms, fired: false, cleared: false }); return timers.length - 1; },
        clearTimer: (i) => { if (timers[i]) timers[i].cleared = true; },
        onEvent: (name, data) => this.events.push({ name, ...data }),
      });
      return this.session;
    },
  };
}

describe('connect / supersede / disconnect', () => {
  it('connect returns a session and announces it', () => {
    const w = world(); const s = w.make();
    const { sessionId, superseded } = s.connect({ model: 'claude-fable-5' });
    expect(sessionId).toBeTruthy();
    expect(superseded).toBe(false);
    expect(s.isActive(sessionId)).toBe(true);
    expect(w.events).toContainEqual({ name: 'agent', state: 'connected', model: 'claude-fable-5' });
  });
  it('a newer connect supersedes: the old parked listen resolves {kind:superseded}', async () => {
    const w = world(); const s = w.make();
    const a = s.connect({ model: 'a' });
    const parked = s.listen(a.sessionId, {});
    const b = s.connect({ model: 'b' });
    expect(b.superseded).toBe(true);
    await expect(parked).resolves.toEqual({ kind: 'superseded' });
    expect(s.isActive(a.sessionId)).toBe(false);
  });
  it('disconnect tears down and announces idle; wrong session is refused', () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    expect(s.disconnect('nope')).toEqual({ ok: false });
    expect(s.disconnect(sessionId)).toEqual({ ok: true });
    expect(s.status()).toEqual({ connected: false });
    expect(w.events).toContainEqual({ name: 'agent', state: 'idle' });
  });
});

describe('the listen rendezvous', () => {
  it('an utterance resolves a parked listen immediately, ui context attached', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    const parked = s.listen(sessionId, {});
    s.utterance({ text: 'hello', source: 'speech', ui: { selected_node_id: 'n1', selected_node_name: 'X', lens: 'graph' } });
    const r = await parked;
    expect(r).toMatchObject({ kind: 'utterance', text: 'hello', source: 'speech', ui: { selected_node_id: 'n1' } });
  });
  it('utterances queue while the agent thinks; the next listen drains one', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    expect(s.utterance({ text: 'one' })).toEqual({ routed: 'agent' });
    s.utterance({ text: 'two' });
    await expect(s.listen(sessionId, {})).resolves.toMatchObject({ text: 'one' });
    await expect(s.listen(sessionId, {})).resolves.toMatchObject({ text: 'two' });
  });
  it('no agent → routed none; stale/unknown session listen → superseded', async () => {
    const w = world(); const s = w.make();
    expect(s.utterance({ text: 'x' })).toEqual({ routed: 'none' });
    await expect(s.listen('ghost', {})).resolves.toEqual({ kind: 'superseded' });
  });
  it('a parked listen times out with {kind:timeout}', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    const parked = s.listen(sessionId, { timeoutS: 25 });
    expect(w.timers[0].ms).toBe(25000);
    w.fire(0);
    await expect(parked).resolves.toEqual({ kind: 'timeout' });
  });
  it('a re-poll replaces the old park (old resolves superseded)', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    const first = s.listen(sessionId, {});
    const second = s.listen(sessionId, {});
    await expect(first).resolves.toEqual({ kind: 'superseded' });
    s.utterance({ text: 'hi' });
    await expect(second).resolves.toMatchObject({ text: 'hi' });
  });
});

describe('the say / say-done / interrupt round-trip', () => {
  it('natural completion: {spoken:true}', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    const say = s.say(sessionId, { text: 'hello world' });
    const evt = w.events.find((e) => e.name === 'say');
    expect(evt.text).toBe('hello world');
    expect(s.sayDone({ msg_id: evt.msg_id })).toEqual({ ok: true });
    await expect(say).resolves.toEqual({ ok: true, spoken: true });
  });
  it('barge-in: {interrupted, spoken_chars} clamped to the text', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    const say = s.say(sessionId, { text: 'hello world' });
    const evt = w.events.find((e) => e.name === 'say');
    s.sayDone({ msg_id: evt.msg_id, interrupted: true, spoken_chars: 900 });
    await expect(say).resolves.toEqual({ ok: true, interrupted: true, spoken_chars: 11 });
  });
  it('muted/no_tts pass the reason through; wrong msg_id is refused', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    const say = s.say(sessionId, { text: 'quiet' });
    expect(s.sayDone({ msg_id: 'wrong' })).toEqual({ ok: false });
    const evt = w.events.find((e) => e.name === 'say');
    s.sayDone({ msg_id: evt.msg_id, reason: 'muted' });
    await expect(say).resolves.toEqual({ ok: true, spoken: false, reason: 'muted' });
  });
  it('a dead tab cannot hang the agent: the ack budget resolves no_ack', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    const say = s.say(sessionId, { text: 'x'.repeat(100) });
    const guard = w.timers.find((t) => t.ms === sayAckBudgetMs('x'.repeat(100)));
    expect(guard).toBeTruthy();
    w.fire(w.timers.indexOf(guard));
    await expect(say).resolves.toEqual({ ok: true, spoken: false, reason: 'no_ack' });
  });
  it('say while speaking → already_speaking; empty text and dead session are refused', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    s.say(sessionId, { text: 'first' });
    await expect(s.say(sessionId, { text: 'second' })).resolves.toEqual({ error: 'already_speaking' });
    await expect(s.say(sessionId, { text: '  ' })).resolves.toEqual({ error: 'text required' });
    await expect(s.say('ghost', { text: 'x' })).resolves.toEqual({ error: 'not connected' });
  });
  it('sayAckBudgetMs is bounded', () => {
    expect(sayAckBudgetMs('')).toBe(10000);
    expect(sayAckBudgetMs('x'.repeat(100000))).toBe(90000);
  });
});

describe('staleness + provenance breadcrumbs', () => {
  it('quiet past STALE_MS with no parked listen reads stale; a listen park does not', async () => {
    const w = world(); const s = w.make();
    const { sessionId } = s.connect({ model: 'a' });
    w.tick(STALE_MS + 1);
    expect(s.status().stale).toBe(true);
    s.listen(sessionId, {});             // parked again — alive
    expect(s.status().stale).toBe(false);
  });
  it('touched nodes accumulate from ui context and explicit touches', () => {
    const w = world(); const s = w.make();
    s.connect({ model: 'a' });
    s.utterance({ text: 'x', ui: { selected_node_id: 'n1', selected_node_name: 'One', selected_node_label: 'Idea' } });
    s.touch('n2', { name: 'Two', label: 'Goal' });
    expect(s.touchedNodes()).toEqual([
      { id: 'n1', name: 'One', label: 'Idea' },
      { id: 'n2', name: 'Two', label: 'Goal' },
    ]);
  });
});
