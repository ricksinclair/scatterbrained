// panels.js — server-side validation for the assistant's show_panel tool (VOICE Phase 5,
// the first real consumer of SPEC §10.7's sets/views layer). The model composes over a
// CLOSED vocabulary — panel kinds here, component ids from SETS['voice-panel'] — and
// every error echoes the legal values so the agent self-corrects without re-reading docs.
// Pure: no IO; node existence is the caller's check (it has the driver).
import { SETS } from '../public/lib/sets.js';
import { validateChartSpec } from '../public/lib/chart-spec.js';

export const PANEL_KINDS = ['agenda', 'today', 'node', 'search', 'viz'];
export const PANEL_COMPONENTS = [...SETS['voice-panel']];

const err = (code, message, allowed) => ({ error: { code, message, ...(allowed ? { allowed } : {}) } });

// validatePanel(spec) → { spec: normalized } | { error: {code, message, allowed?} }
export function validatePanel(raw = {}) {
  const kind = raw.kind;
  if (!PANEL_KINDS.includes(kind)) return err('unknown_kind', `kind must be one of: ${PANEL_KINDS.join(', ')}`, PANEL_KINDS);
  const spec = { kind };
  if (raw.title != null) {
    if (typeof raw.title !== 'string') return err('bad_params', 'title must be a string');
    spec.title = raw.title.slice(0, 80);
  }
  if (kind === 'node') {
    if (!raw.node_id || typeof raw.node_id !== 'string') return err('bad_params', 'node_id is required for kind:"node"');
    spec.node_id = raw.node_id.slice(0, 200);
    if (raw.components != null) {
      if (!Array.isArray(raw.components) || !raw.components.length) return err('bad_params', 'components must be a non-empty array of component ids');
      const bad = raw.components.filter((c) => !PANEL_COMPONENTS.includes(c));
      if (bad.length) return err('unknown_component', `not in the voice-panel set: ${bad.join(', ')}`, PANEL_COMPONENTS);
      spec.components = [...new Set(raw.components)];
    }
  } else if (kind === 'search') {
    if (!raw.q || typeof raw.q !== 'string' || !raw.q.trim()) return err('bad_params', 'q is required for kind:"search"');
    spec.q = raw.q.trim().slice(0, 200);
  } else if (kind === 'agenda') {
    if (raw.project != null) {
      if (typeof raw.project !== 'string') return err('bad_params', 'project must be a string');
      spec.project = raw.project.slice(0, 80);
    }
  } else if (kind === 'today') {
    // The day-view hour rail ("what's scheduled for later today"). since_now (default true) keeps
    // only what's still ahead — the same filter get_briefing scope:'today' applies.
    if (raw.since_now != null) {
      if (typeof raw.since_now !== 'boolean') return err('bad_params', 'since_now must be a boolean');
      spec.since_now = raw.since_now;
    }
  } else if (kind === 'viz') {
    // A chart from graph data: a cypher to run live, or rows already in hand (the agent's
    // query_graph result). An optional spec is validated here; without one the server derives a
    // deterministic default from the rows. The chart itself is composed, never HTML — same boundary.
    const hasCypher = raw.cypher != null, hasRows = raw.rows != null;
    if (!hasCypher && !hasRows) return err('bad_params', 'kind:"viz" needs a cypher to run or rows to chart');
    if (hasCypher) {
      if (typeof raw.cypher !== 'string' || !raw.cypher.trim()) return err('bad_params', 'cypher must be a non-empty string');
      spec.cypher = raw.cypher.slice(0, 2000);
    }
    if (hasRows) {
      if (!Array.isArray(raw.rows)) return err('bad_params', 'rows must be an array of result objects');
      spec.rows = raw.rows.slice(0, 200);
    }
    if (raw.params != null) {
      if (typeof raw.params !== 'object' || Array.isArray(raw.params)) return err('bad_params', 'params must be an object');
      spec.params = raw.params;
    }
    if (raw.spec != null) {
      const v = validateChartSpec(raw.spec);
      if (v.error) return v;                       // echoes the chart-kind vocabulary through
      spec.spec = v.spec;
    }
  }
  // anything outside the per-kind fields is a mistake worth surfacing, not ignoring
  const legal = new Set(['kind', 'title', 'node_id', 'components', 'q', 'project', 'since_now', 'cypher', 'rows', 'params', 'spec']);
  const unknown = Object.keys(raw).filter((k) => !legal.has(k));
  if (unknown.length) return err('bad_params', `unknown field(s): ${unknown.join(', ')}`);
  return { spec };
}
