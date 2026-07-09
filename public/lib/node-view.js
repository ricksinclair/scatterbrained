// node-view.js — derive the composable-UI inputs ({signals, data}) from an /api/node
// payload. Extracted from app.js selectNode (VOICE Phase 5) so the assistant's dynamic
// panels and the inspector run the SAME derivation instead of drifting copies — the
// registry renderers assume this exact shape. Pure: caller supplies snooze state + now.
import { splitCriteria } from './criteria.js';
import { resurfaceState } from './registry.js';

// Relation-type distribution → the chart component's bars (the "shape" of a node's
// connections). Prefers the server's uncapped rel_types over the capped edge list.
export function relationDistribution(types = []) {
  const counts = {};
  (types || []).forEach((t) => { if (t) counts[t] = (counts[t] || 0) + 1; });
  const bars = Object.keys(counts).map((t) => ({ label: t, value: counts[t] })).sort((a, b) => b.value - a.value);
  return bars.length ? { title: 'connections by type', bars } : null;
}

// node: the /api/node payload. n: the live graph node (may be {} for off-canvas surfaces
// like voice panels). source: the /api/source payload (or null).
export function deriveNodeView(node = {}, n = {}, { source = null, snoozedUntil = 0, now = Date.now() } = {}) {
  const edges = node.edges || [];
  const edgeSources = edges.filter((e) => e.label === 'Source' && e.dir === 'in');
  // Prefer the server's full (uncapped) INFORMS list so provenance can show ALL sources.
  const sources = (node.all_sources && node.all_sources.length) ? node.all_sources : edgeSources;
  // criterion notes get their own `acceptance` section; ordinary notes keep the inbox
  const noteSplit = splitCriteria(node.notes || []);
  const signals = {
    ...node, ...n,
    label: n.label || node.label,
    sourceKind: node.source_kind || n.source_kind,
    filePath: node.file_path || n.file_path || (source && source.sourcePath),
    url: node.url || n.url,
    tags: node.tags || n.tags,
    hasText: !!(node.full_text || node.desc || n.desc || node.description),
    sourceCount: sources.length,
    edgeCount: edges.length - edgeSources.length,
    source_count: node.source_count,
    degree: node.degree != null ? node.degree : n.degree,
    superseded: !!node.superseded_by,
    confidence: node.confidence || n.confidence,
    citation: node.citation || n.citation,
    jurisdiction: node.jurisdiction || n.jurisdiction,
    status: node.status || n.status,
    full_text: node.full_text || n.full_text,
    desc: node.desc || n.desc,
    criterionCount: noteSplit.criteria.length,
    // stored PlantUML source (a diagram Source node, or any node carrying a puml prop)
    puml: node.puml || n.puml || (node.props && node.props.puml) || null,
  };
  const data = {
    edges, sources, source,
    degree: node.degree, relTypes: node.rel_types,
    created_at: node.created_at, valid_until: node.valid_until,
    superseded_by: node.superseded_by, invalidated_reason: node.invalidated_reason,
    superseded_by_id: node.superseded_by_id, superseded_by_name: node.superseded_by_name,
    resurface: resurfaceState(node.created_at, node.degree, { snoozedUntil, now, superseded: !!node.superseded_by }),
    chart: relationDistribution(node.rel_types || edges.map((e) => e.type)),
    notes: noteSplit.rest, criteria: noteSplit.criteria,
    protectedFacts: node.protected_facts || [], retiredFacts: node.retired_facts || [],
    id: n.id || node.id,
    goal_milestones: node.goal_milestones || [], goal_blockers: node.goal_blockers || [],
    propCount: node.props ? Object.keys(node.props).filter((k) => k !== 'embedding' && k !== 'embedding_hash' && node.props[k] != null).length : null,
  };
  return { signals, data };
}
