// criteria.js — acceptance criteria as product (regression guardrails for any project).
// A criterion is a Note (anchor_kind 'criterion') ABOUT an Idea/Project: a pinned, testable
// expectation that must survive change — to BEHAVIOR what a ProtectedFact is to PROSE.
// State lives in the shared Note.state field using the criterion subset of the closed vocab
// in docnotes.js (unverified | pass | fail) and changes ONLY via explicit verification
// events (POST /api/criterion/verify), never via the generic note-state cycle.
//
// Pure, DOM-free, unit-tested. Shared by the server (verify endpoint, pulse lane, the
// review-lens criteria checklist) and the inspector/report `acceptance` component.

import { STATE_LABEL } from './docnotes.js';

// The criterion lifecycle — a subset of the closed Note.state vocabulary (docnotes.js).
export const CRITERION_STATES = ['unverified', 'pass', 'fail'];
// Guard against vocab drift: every criterion state must exist in the shared Note vocab.
for (const s of CRITERION_STATES) {
  if (!STATE_LABEL[s]) throw new Error(`criterion state '${s}' missing from docnotes STATE_LABEL`);
}
export const isCriterionState = (s) => CRITERION_STATES.includes(s);
// Verification results a test runner may POST — 'unverified' is the birth state, not a verdict.
export const VERIFY_STATES = ['pass', 'fail'];

// A 'pass' older than this is STALE — "verified-then-stale beyond a threshold" (criterion 4).
// 14 days matches the codebase's other freshness horizons (the dock's due window in
// rollDueRows and review-supersession's recency lead), so one number means "recent" everywhere.
export const STALE_DAYS = 14;
const DAY_MS = 86400000;

// Split a node's notes into criteria vs the ordinary inbox notes — the one shaping
// step app.js does before handing data to the registry components.
export function splitCriteria(notes = []) {
  const criteria = [], rest = [];
  for (const n of notes || []) (n && n.anchor_kind === 'criterion' ? criteria : rest).push(n);
  return { criteria, rest };
}

// Effective status of one criterion at `nowMs`: 'fail' | 'stale' | 'pass' | 'unverified'.
// stale = passed, but last_verified_at is more than STALE_DAYS ago (or unparseable).
export function criterionStatus(c = {}, nowMs = 0) {
  const st = isCriterionState(c.state) ? c.state : 'unverified';
  if (st !== 'pass') return st;
  const t = Date.parse(c.last_verified_at || '');
  if (Number.isNaN(t) || nowMs - t > STALE_DAYS * DAY_MS) return 'stale';
  return 'pass';
}

// Counts for the section header / receipts: { total, pass, fail, stale, unverified }.
export function criteriaSummary(list = [], nowMs = 0) {
  const out = { total: 0, pass: 0, fail: 0, stale: 0, unverified: 0 };
  for (const c of list || []) { out.total++; out[criterionStatus(c, nowMs)]++; }
  return out;
}

// The needs-review dock lane (criterion 4): from raw criterion rows (state ∈ fail|pass, with
// last_verified_at), keep only the actionable ones — regressed (fail) and stale (pass beyond
// STALE_DAYS) — fail first, then stalest-first. The staleness math stays HERE (one source),
// not duplicated in Cypher; the pulse query over-fetches fail+pass and this prunes.
export function shapeCriteriaLane(rowList = [], nowMs = 0, cap = 20) {
  const out = [];
  for (const r of rowList || []) {
    const status = criterionStatus(r, nowMs);
    if (status !== 'fail' && status !== 'stale') continue;
    out.push({ ...r, status });
  }
  out.sort((a, b) => (a.status === b.status
    ? String(a.last_verified_at || '').localeCompare(String(b.last_verified_at || ''))
    : (a.status === 'fail' ? -1 : 1)));
  return out.slice(0, cap);
}

// The review-lens checklist (criterion 5): group a project's criterion rows
// [{anchor_id, anchor_name, id, text, state, last_verified_at}] by their anchor (Idea/Project),
// each group's items ordered fail → stale → unverified → pass so open work leads.
const STATUS_RANK = { fail: 0, stale: 1, unverified: 2, pass: 3 };
export function groupCriteriaByAnchor(rowList = [], nowMs = 0) {
  const by = new Map();
  for (const r of rowList || []) {
    const k = r.anchor_id || r.anchor_name || '?';
    if (!by.has(k)) by.set(k, { anchor_id: r.anchor_id, anchor_name: r.anchor_name, items: [] });
    by.get(k).items.push({ ...r, status: criterionStatus(r, nowMs) });
  }
  const groups = [...by.values()];
  for (const g of groups) g.items.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  groups.sort((a, b) => String(a.anchor_name || '').localeCompare(String(b.anchor_name || '')));
  return groups;
}
