// Pure lock-state logic over a plain map { [file_path]: { holder, lock_at, lock_at_unix,
// reason } }, persisted as a local JSON lockfile (~/.scatterbrained/locks.json).
//
// WHY a lockfile, not Neo4j: a lock is *ephemeral operational state*, not knowledge — it
// doesn't belong in the lifelong graph (it would couple lock availability to a running
// Docker daemon, churn writes into something that's exported/linted, and be the slowest
// possible backend for "is path X locked?"). The lockfile is daemon-free, works when Neo4j
// is down, and is readable by the agent hook in pure shell (jq) with no Node spawn.
//
// IMPORTANT: the lock is *advisory* (friction-reduction). The actual guarantee that the
// Studio never destroys an agent's work is git-based (snapshot-before-overwrite +
// dirty-tree refuse + fresh-hash conflict) — see save.js / server.saveFile. No DOM/IO here;
// the IO wrapper lives in server.js and the helpers are unit-tested exactly as shipped.

export const HOLDER_STUDIO = 'studio-user';
export const LOCK_TTL_MIN = 30;

export function lockfileRelPath() { return '.scatterbrained/locks.json'; }

export function isStale(lockAtIso, nowMs = Date.now(), ttlMin = LOCK_TTL_MIN) {
  if (!lockAtIso) return true;
  const t = Date.parse(lockAtIso);
  if (Number.isNaN(t)) return true;
  return nowMs - t > ttlMin * 60 * 1000;
}
export function lockOf(map, fp) { return (map && map[fp]) || null; }

// Is `fp` held by someone OTHER than `holder`, with a still-fresh lock?
export function isHeldByOther(map, fp, holder, nowMs = Date.now(), ttlMin = LOCK_TTL_MIN) {
  const l = lockOf(map, fp);
  return !!(l && l.holder && l.holder !== holder && !isStale(l.lock_at, nowMs, ttlMin));
}
// Free if unheld, already mine, or stale.
export function canAcquire(map, fp, holder, nowMs = Date.now(), ttlMin = LOCK_TTL_MIN) {
  const l = lockOf(map, fp);
  if (!l || !l.holder) return true;
  if (l.holder === holder) return true;
  return isStale(l.lock_at, nowMs, ttlMin);
}

// Pure: returns a NEW map + the outcome. `force` is an explicit user takeover.
export function acquire(map, fp, { holder = HOLDER_STUDIO, reason = '', nowMs = Date.now(), ttlMin = LOCK_TTL_MIN, force = false } = {}) {
  const can = force || canAcquire(map, fp, holder, nowMs, ttlMin);
  const next = { ...(map || {}) };
  if (can) next[fp] = { holder, lock_at: new Date(nowMs).toISOString(), lock_at_unix: Math.floor(nowMs / 1000), reason };
  const l = next[fp] || lockOf(map, fp) || {};
  return { map: next, acquired: can, holder: l.holder || null, lockAt: l.lock_at || null, reason: l.reason || null };
}
// Only the current holder (or an unset/expired lock) is cleared — a stale-takeover winner
// isn't wiped by the previous holder's late release/beacon.
export function release(map, fp, holder, nowMs = Date.now(), ttlMin = LOCK_TTL_MIN) {
  const l = lockOf(map, fp);
  const next = { ...(map || {}) };
  if (!l || !l.holder || l.holder === holder || isStale(l.lock_at, nowMs, ttlMin)) delete next[fp];
  return next;
}
export function status(map, fp, nowMs = Date.now(), ttlMin = LOCK_TTL_MIN) {
  const l = lockOf(map, fp);
  if (!l) return null;
  return { holder: l.holder, lockAt: l.lock_at, reason: l.reason, stale: isStale(l.lock_at, nowMs, ttlMin) };
}
// Drop expired entries (called on every read so the file self-cleans).
export function prune(map, nowMs = Date.now(), ttlMin = LOCK_TTL_MIN) {
  const next = {};
  for (const [fp, l] of Object.entries(map || {})) if (l && !isStale(l.lock_at, nowMs, ttlMin)) next[fp] = l;
  return next;
}
