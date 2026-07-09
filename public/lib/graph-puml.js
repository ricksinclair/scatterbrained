// graph-puml.js — a node's graph neighborhood → PlantUML source (pure).
// "Explain this cluster as a diagram": mindmap (rel-type branches) or component
// (label-stereotyped boxes + typed edges). The theme pack's stereotype styles
// (<<Insight>>, <<Project>>, …) color elements as their graph node type, so the
// output is graph-consistent in every Studio theme AND in the standalone files.
//
// Input neighborhood shape (built by /api/diagram/from-graph):
//   focus:     { id, name, label }
//   neighbors: [{ id, name, label, relType, dir ('out'|'in'), depth (1|2), parentId? }]

export const MAX_NODES = 40;

const clean = (s, n = 48) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t || '(unnamed)';
};

// Mindmap: root = focus (accent-styled by the theme's rootNode), one branch per
// relationship type, depth-2 leaves under their parent node. Overflow per branch
// collapses to a "+N more" leaf so a hub node stays readable.
function toMindmap({ focus, neighbors }) {
  const d1 = neighbors.filter((x) => x.depth !== 2);
  const d2 = neighbors.filter((x) => x.depth === 2);
  const byType = new Map();
  for (const nb of d1) {
    const key = nb.relType || 'RELATED';
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(nb);
  }
  const lines = ['@startmindmap', `* ${clean(focus.name, 60)}`];
  let used = 1;
  for (const [type, list] of byType) {
    lines.push(`** ${clean(type, 40)}`);
    let shown = 0;
    for (const nb of list) {
      if (used >= MAX_NODES) break;
      lines.push(`*** ${clean(nb.name)}`);
      used++; shown++;
      for (const kid of d2.filter((k) => k.parentId === nb.id)) {
        if (used >= MAX_NODES) break;
        lines.push(`**** ${clean(kid.name)}`);
        used++;
      }
    }
    const hidden = list.length - shown;
    if (hidden > 0) lines.push(`*** +${hidden} more`);
  }
  lines.push('@endmindmap');
  return lines.join('\n');
}

// Component: one <<Label>>-stereotyped rectangle per node, typed arrows for edges.
// Edge direction honors dir; depth-2 rows draw parent→child with their own relType.
function toComponent({ focus, neighbors }) {
  const ids = new Map();       // graph id → puml alias
  const alias = (id) => { if (!ids.has(id)) ids.set(id, 'n' + ids.size); return ids.get(id); };
  const nodeLine = (n) => `rectangle "${clean(n.name)}" as ${alias(n.id)} <<${n.label || 'Source'}>>`;
  const capped = neighbors.slice(0, MAX_NODES - 1);
  const lines = ['@startuml', nodeLine(focus)];
  for (const nb of capped) lines.push(nodeLine(nb));
  for (const nb of capped) {
    const from = nb.depth === 2 ? alias(nb.parentId) : alias(focus.id);
    const rel = clean(nb.relType || '', 30);
    lines.push(nb.dir === 'in'
      ? `${alias(nb.id)} --> ${from} : ${rel}`
      : `${from} --> ${alias(nb.id)} : ${rel}`);
  }
  const hidden = neighbors.length - capped.length;
  if (hidden > 0) lines.push(`note as overflow\n+${hidden} more connections\nend note`);
  lines.push('@enduml');
  return lines.join('\n');
}

export function toPlantuml(neighborhood, { kind = 'mindmap' } = {}) {
  if (!neighborhood || !neighborhood.focus) return null;
  const nb = { focus: neighborhood.focus, neighbors: neighborhood.neighbors || [] };
  return kind === 'component' ? toComponent(nb) : toMindmap(nb);
}
