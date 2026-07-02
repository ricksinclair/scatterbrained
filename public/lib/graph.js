// Pure graph helpers — no DOM, no globals. Imported by both the browser app and
// the Vitest suite so the tested logic is exactly the shipped logic.

// Readable label for a node name in the constellation. Two failure modes of naive
// end-truncation, both seen live: (1) path-like names collide on a shared prefix
// ("docs/reference/states/alabama.md" … "/wyoming.md" all show the same head)
// → show the basename instead; (2) long names that differ only in their TAIL
// ("Northwind — Partner Code…" vs "Northwind — Research…") lose the distinguishing part to a
// trailing ellipsis → keep both ends with a middle ellipsis. Pure + tested.
export function smartLabel(name, max = 26) {
  let s = String(name == null ? '' : name).trim();
  if (s.includes('/')) {                                   // path-like → drop the shared directory
    const base = s.slice(s.lastIndexOf('/') + 1);
    if (base) s = base;
  }
  if (s.length <= max) return s;
  if (max <= 3) return s.slice(0, max);
  const head = Math.ceil((max - 1) * 0.6);                 // keep more of the head, enough tail to disambiguate
  const tail = max - 1 - head;
  return s.slice(0, head) + '…' + (tail > 0 ? s.slice(s.length - tail) : '');
}

export function statusText(node) {
  if (node.superseded) return 'superseded → ' + (node.superseded_by || 'newer memory');
  if ((node.degree || 0) === 0) return 'orphan — no edges';
  return node.embeddable ? 'valid · indexed' : 'valid';
}

export function lensActive(node, lens) {
  if (lens === 'all') return true;
  if (lens === 'stale') return !!node.stale;
  return node.label === lens;
}

// Greedy label declutter: given label candidates (each { id, x, y, w, h, priority,
// forced }), return the Set of ids whose labels should render — highest priority
// first, skipping any that would overlap an already-placed label. `forced` labels
// (selected / focused / searched) always render and are never skipped. AABB overlap
// in whatever coordinate space the caller supplies (we use graph units). Pure +
// tested so the shipped declutter logic is the tested logic.
export function placeLabels(candidates = [], { maxLabels = 60 } = {}) {
  const sorted = [...candidates].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const placed = [];
  const shown = new Set();
  for (const c of sorted) {
    if (shown.size >= maxLabels && !c.forced) break;
    const x0 = c.x - c.w / 2, y0 = c.y, x1 = x0 + c.w, y1 = c.y + c.h;
    const hit = placed.some((p) => !(x1 < p.x0 || x0 > p.x1 || y1 < p.y0 || y0 > p.y1));
    if (hit && !c.forced) continue;
    placed.push({ x0, y0, x1, y1 });
    shown.add(c.id);
  }
  return shown;
}

// Deterministic radial layout for an inline 1-hop neighborhood (the `relations`
// component in report view): place `items` evenly on a circle of `radius` around
// (cx, cy), starting at 12 o'clock. Pure → the SVG it drives is tested. Returns the
// items with { x, y, angle } added (originals untouched).
export function neighborhoodLayout(items = [], { cx = 0, cy = 0, radius = 90, start = -Math.PI / 2 } = {}) {
  const n = items.length;
  if (!n) return [];
  return items.map((it, i) => {
    const angle = start + (i * 2 * Math.PI) / n;
    return { ...it, angle, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

// Degree-of-interest weights for a focus node: self=1, 1-hop=0.95, 2-hop=0.3.
// `getAdj(id)` returns an iterable of neighbor ids.
export function computeDoi(id, getAdj) {
  const doi = { [id]: 1 };
  const hop1 = getAdj(id) || [];
  for (const nb of hop1) doi[nb] = Math.max(doi[nb] || 0, 0.95);
  for (const nb of hop1) {
    for (const nb2 of getAdj(nb) || []) {
      if (doi[nb2] === undefined) doi[nb2] = 0.3;
    }
  }
  return doi;
}

// collideRadius(node, relSize=4, pad=6) → the collision radius in GRAPH units for the
// simulation's collide force. force-graph paints a node at `relSize * √val` (val = node.r),
// so the collide radius is that rendered radius + a constant pad so neighbors keep a hairline
// of space and their labels have room. Pure so the sizing is tested, not eyeballed.
export function collideRadius(node, relSize = 4, pad = 6) {
  const val = Math.max(0, Number(node && node.r) || 0);
  return relSize * Math.sqrt(val) + pad;
}

// particlesForZoom(base, zoom, { pauseAbove=6, thinAbove=3 }) → how many edge particles to
// run on a link at the current zoom. Zoomed WAY in, particle animation is the choppy cost
// (canvas redraws per DPR² pixel), and the flow is barely legible on a near-empty viewport —
// so thin them above `thinAbove`, pause them entirely above `pauseAbove`. At overview zoom
// it's exactly `base` (no behavior change where the constellation is judged). Pure + tested.
export function particlesForZoom(base, zoom, { pauseAbove = 6, thinAbove = 3 } = {}) {
  const b = Math.max(0, base | 0);
  if (b === 0) return 0;                 // calm / filtered-out links stay off
  const z = Number(zoom) || 1;
  if (z > pauseAbove) return 0;
  if (z > thinAbove) return Math.max(1, Math.round(b / 2));
  return b;
}
