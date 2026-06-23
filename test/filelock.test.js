import { describe, it, expect } from 'vitest';
import {
  isStale, canAcquire, isHeldByOther, acquire, release, status, prune,
  HOLDER_STUDIO, LOCK_TTL_MIN,
} from '../lib/filelock.js';

const NOW = Date.parse('2026-06-17T12:00:00Z');
const MIN = 60 * 1000;
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const lock = (holder, msAgo) => ({ holder, lock_at: at(msAgo), lock_at_unix: Math.floor((NOW - msAgo) / 1000) });

describe('filelock — staleness', () => {
  it('missing / bad lock_at is stale', () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale('nope', NOW)).toBe(true);
  });
  it('fresh within TTL, stale past it', () => {
    expect(isStale(at(5 * MIN), NOW)).toBe(false);
    expect(isStale(at((LOCK_TTL_MIN + 1) * MIN), NOW)).toBe(true);
  });
});

describe('filelock — canAcquire / isHeldByOther', () => {
  const me = HOLDER_STUDIO;
  it('free when unheld', () => expect(canAcquire({}, '/a.md', me, NOW)).toBe(true));
  it('free when already mine', () => expect(canAcquire({ '/a.md': lock(me, MIN) }, '/a.md', me, NOW)).toBe(true));
  it('blocked when held fresh by another', () => {
    const map = { '/a.md': lock('agent:x', MIN) };
    expect(canAcquire(map, '/a.md', me, NOW)).toBe(false);
    expect(isHeldByOther(map, '/a.md', me, NOW)).toBe(true);
  });
  it('free when another holder is stale', () => {
    const map = { '/a.md': lock('agent:x', 40 * MIN) };
    expect(canAcquire(map, '/a.md', me, NOW)).toBe(true);
    expect(isHeldByOther(map, '/a.md', me, NOW)).toBe(false);
  });
});

describe('filelock — acquire (pure, returns new map)', () => {
  it('acquires an unheld file and stamps both ISO + unix time', () => {
    const r = acquire({}, '/a.md', { reason: 'edit', nowMs: NOW });
    expect(r.acquired).toBe(true);
    expect(r.holder).toBe(HOLDER_STUDIO);
    expect(r.map['/a.md'].lock_at).toBe(new Date(NOW).toISOString());
    expect(r.map['/a.md'].lock_at_unix).toBe(Math.floor(NOW / 1000));
  });
  it('refuses a fresh other-held file, leaving the map unchanged', () => {
    const map = { '/a.md': lock('agent:x', MIN) };
    const r = acquire(map, '/a.md', { nowMs: NOW });
    expect(r.acquired).toBe(false);
    expect(r.holder).toBe('agent:x');
    expect(r.map['/a.md'].holder).toBe('agent:x');   // untouched
  });
  it('force takes over regardless', () => {
    const map = { '/a.md': lock('agent:x', MIN) };
    const r = acquire(map, '/a.md', { nowMs: NOW, force: true });
    expect(r.acquired).toBe(true);
    expect(r.map['/a.md'].holder).toBe(HOLDER_STUDIO);
  });
  it('does not mutate the input map', () => {
    const map = {};
    acquire(map, '/a.md', { nowMs: NOW });
    expect(map['/a.md']).toBeUndefined();
  });
});

describe('filelock — release / prune / status', () => {
  it('release clears my own lock but not a fresh other-holder lock', () => {
    expect(release({ '/a.md': lock(HOLDER_STUDIO, MIN) }, '/a.md', HOLDER_STUDIO, NOW)['/a.md']).toBeUndefined();
    expect(release({ '/a.md': lock('agent:x', MIN) }, '/a.md', HOLDER_STUDIO, NOW)['/a.md']).toBeDefined();
  });
  it('release clears a stale other-holder lock', () => {
    expect(release({ '/a.md': lock('agent:x', 40 * MIN) }, '/a.md', HOLDER_STUDIO, NOW)['/a.md']).toBeUndefined();
  });
  it('prune drops stale entries, keeps fresh', () => {
    const map = { '/fresh.md': lock('x', MIN), '/old.md': lock('y', 40 * MIN) };
    const p = prune(map, NOW);
    expect(p['/fresh.md']).toBeDefined();
    expect(p['/old.md']).toBeUndefined();
  });
  it('status reports holder + staleness', () => {
    expect(status({ '/a.md': lock('agent:x', MIN) }, '/a.md', NOW)).toMatchObject({ holder: 'agent:x', stale: false });
    expect(status({}, '/a.md', NOW)).toBeNull();
  });
});
