// impact-uml.js — pure layout for the impact view's UML-style dependency diagram. Replaces the
// generic layered DAG for this surface: an impact ego graph is not an arbitrary graph, it is a
// STAR (N callers → one focus → M imports), and a layout that knows that can do what a generic
// one can't — anchor the focus in the middle as a real UML class box whose compartment is the
// focus file's USED API SURFACE (the members callers actually touch, with caller counts), and
// draw method-level edges from each caller function to the specific member it calls.
//
// Scale is handled member-centrically: members are ranked by fan-in, callers are CLUSTERED by
// the highest-ranked member they touch (so edge bundles run nearly horizontal instead of
// criss-crossing), and past a cap callers collapse into a "+N more" ghost — with every member
// keeping at least one visible representative caller, so no member's story disappears.
// `memberFilter` narrows the view to one member's callers (the member list stays complete, so
// the filter is also the navigation). All geometry is computed here, in pixels, so the renderer
// (impact-svg.js) is a dumb stringifier and THIS — the part a vendored lib hides — is the part
// under unit test.
//
// Input:  { focus:{id,lang}, callers:[{file,lang,path,sites:[{fn,lines,members:[{name,kind,lines}]}]}],
//           dependencies:[{id,lang}], memberFilter?, expand? }
// Output: { focus, members, callers, ghost, deps, edges, depEdges, width, height, … } — see return.

export const G = {
  MARGIN: 16, CAP_H: 20,                       // outer margin · column-caption strip
  HEADER_H: 26, METHOD_H: 18, COMPART_PAD: 5,  // caller box: header + method rows
  F_HEADER_H: 32, MEMBER_H: 20,                // focus box: taller header + member rows
  PAD_X: 10, CHAR_W: 7.1, DOT: 8, GAP: 6,
  V_GAP: 12, FLOW_GAP: 150, DEP_GAP: 110,      // stack gap · callers→focus · focus→imports
  DEP_H: 24, DEP_VGAP: 8, GHOST_H: 26,
  CAP_CALLERS: 12, CAP_METHODS: 5, CAP_DEPS: 14,
};

const base = (rel) => (rel && rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel) || '';
const cap = (s, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const memberLabel = (m) => (m.kind === 'type' ? '«type» ' + cap(m.name, 20) : cap(m.name, 22) + '()');

export function impactLayout({ focus = {}, callers = [], dependencies = [], memberFilter = null, expand = false } = {}) {
  const usable = callers.filter((c) => (c.sites || []).length);

  // ── the focus's used API surface, aggregated over ALL callers (never filtered — the member
  // list is the map you filter WITH). kind 'call' beats 'type'; call rows rank above type rows.
  const memMap = new Map();
  for (const c of usable) for (const s of c.sites) for (const m of (s.members || [])) {
    const e = memMap.get(m.name) || { name: m.name, kind: 'type', files: new Set(), sites: 0 };
    if (m.kind === 'call') e.kind = 'call';
    e.files.add(c.file); e.sites++;
    memMap.set(m.name, e);
  }
  const members = [...memMap.values()].sort((a, b) =>
    (a.kind === 'type') - (b.kind === 'type') || b.files.size - a.files.size || a.name.localeCompare(b.name))
    .map((e, i) => ({ name: e.name, kind: e.kind, callerCount: e.files.size, idx: i }));
  const memIdx = new Map(members.map((m) => [m.name, m.idx]));

  // ── filter + cluster callers. Primary member = the best-ranked member a caller touches;
  // sorting by it groups callers into bands aligned with the member rows they point at.
  const active = memberFilter && memIdx.has(memberFilter) ? memberFilter : null;
  const touches = (s, name) => (s.members || []).some((m) => m.name === name);
  let view = usable.map((c) => ({ ...c, viewSites: active ? c.sites.filter((s) => touches(s, active)) : c.sites }))
    .filter((c) => c.viewSites.length);
  const primary = (c) => Math.min(...c.viewSites.flatMap((s) => (s.members || []).map((m) => memIdx.get(m.name) ?? members.length)));
  view.sort((a, b) => primary(a) - primary(b) || b.viewSites.length - a.viewSites.length || a.file.localeCompare(b.file));

  // ── collapse past the cap, but guarantee each member ≥1 visible representative. A member
  // filter is an explicit "show me everyone who calls this" — it never collapses.
  let visible = view, hiddenCallers = 0;
  if (!expand && !active && view.length > G.CAP_CALLERS) {
    const picked = new Set();
    for (const m of members) {                       // one rep per member first, in member order
      if (picked.size >= G.CAP_CALLERS) break;
      const rep = view.find((c) => !picked.has(c.file) && c.viewSites.some((s) => touches(s, m.name)));
      if (rep) picked.add(rep.file);
    }
    for (const c of view) { if (picked.size >= G.CAP_CALLERS) break; picked.add(c.file); }
    visible = view.filter((c) => picked.has(c.file));
    hiddenCallers = view.length - visible.length;
  }

  // ── caller box geometry (right-aligned so every outgoing edge starts on one vertical line).
  const lineFor = (s) => active ? ((s.members.find((m) => m.name === active) || {}).lines || s.lines)[0] : s.lines[0];
  const methodText = (fn, line) => `${cap(fn || '(module)', 22)}  ${line}`;
  const callerBoxes = visible.map((c) => {
    const shown = c.viewSites.slice(0, G.CAP_METHODS);
    const moreMethods = c.viewSites.length - shown.length;
    const methods = shown.map((s) => ({
      fn: s.fn, label: cap(s.fn || '(module)', 22), line: lineFor(s), lines: s.lines,
      members: (s.members || []).map((m) => ({ name: m.name, kind: m.kind })),
      key: c.file + '#' + (s.fn || '(module)'),
    }));
    const headW = G.DOT + G.GAP + cap(base(c.file)).length * G.CHAR_W;
    const methW = Math.max(0, ...c.viewSites.slice(0, G.CAP_METHODS).map((s) => methodText(s.fn, lineFor(s)).length * G.CHAR_W));
    const w = G.PAD_X * 2 + Math.max(headW, methW, 70);
    const h = G.HEADER_H + G.COMPART_PAD + (methods.length + (moreMethods ? 1 : 0)) * G.METHOD_H + 3;
    return { id: c.file, lang: c.lang, path: c.path, w, h, methods, moreMethods };
  });
  const colW = Math.max(80, ...callerBoxes.map((b) => b.w));
  const top = G.MARGIN + G.CAP_H;
  let y = top;
  for (const b of callerBoxes) { b.x = G.MARGIN + colW - b.w; b.y = y; y += b.h + G.V_GAP; }
  const ghost = hiddenCallers
    ? { x: G.MARGIN, y, w: colW, h: G.GHOST_H, count: hiddenCallers }
    : null;
  const callerColH = (ghost ? ghost.y + ghost.h : y - G.V_GAP) - top;

  // ── focus box: header + the full member compartment (its used surface, with caller counts).
  const fHeadW = G.DOT + G.GAP + cap(base(focus.id || ''), 30).length * G.CHAR_W * 1.1;
  const fRowW = Math.max(0, ...members.map((m) => (memberLabel(m).length + String(m.callerCount).length + 3) * G.CHAR_W));
  const fw = G.PAD_X * 2 + Math.max(fHeadW, fRowW, 180);
  const fh = G.F_HEADER_H + (members.length ? G.COMPART_PAD + members.length * G.MEMBER_H + 3 : 0);
  const fx = G.MARGIN + colW + G.FLOW_GAP;

  // ── imports column (header-only pills) — makes the focus literally central: what depends on
  // it flows in from the left, what it depends on flows out to the right.
  const depsShown = dependencies.slice(0, G.CAP_DEPS);
  const hiddenDeps = dependencies.length - depsShown.length;
  const depW = depsShown.length
    ? Math.max(80, ...depsShown.map((d) => G.PAD_X * 2 + G.DOT + G.GAP + cap(base(d.id)).length * G.CHAR_W)) : 0;
  const depColH = depsShown.length ? depsShown.length * (G.DEP_H + G.DEP_VGAP) - G.DEP_VGAP + (hiddenDeps ? G.GHOST_H : 0) : 0;
  const dx = fx + fw + G.DEP_GAP;

  // ── vertical composition: tallest column sets the canvas; focus + imports centre on it.
  const colMaxH = Math.max(callerColH, fh, depColH, 40);
  const fy = top + Math.max(0, (colMaxH - fh) / 2);
  const focusBox = { id: focus.id, lang: focus.lang, x: fx, y: fy, w: fw, h: fh };
  const memberRows = members.map((m, i) => ({ ...m, y: fy + G.F_HEADER_H + G.COMPART_PAD + i * G.MEMBER_H, on: m.name === active }));
  const memberY = new Map(memberRows.map((m) => [m.name, m.y + G.MEMBER_H / 2]));
  let dy = top + Math.max(0, (colMaxH - depColH) / 2);
  const deps = depsShown.map((d) => {
    const p = { id: d.id, lang: d.lang, x: dx, y: dy, w: depW, h: G.DEP_H, cycle: usable.some((c) => c.file === d.id) };
    dy += G.DEP_H + G.DEP_VGAP;
    return p;
  });

  // ── edges: caller method row → the focus member row(s) it touches (the whole point).
  const edges = [];
  for (const b of callerBoxes) {
    b.methods.forEach((m, i) => {
      const y1 = b.y + G.HEADER_H + G.COMPART_PAD + i * G.METHOD_H + G.METHOD_H / 2;
      for (const mm of m.members) {
        if (active && mm.name !== active) continue;
        const y2 = memberY.get(mm.name);
        if (y2 == null) continue;
        edges.push({ x1: b.x + b.w, y1, x2: fx, y2, member: mm.name, kind: mm.kind, key: m.key });
      }
    });
  }
  const depEdges = deps.map((d) => ({
    x1: fx + fw, y1: fy + G.F_HEADER_H / 2, x2: d.x, y2: d.y + d.h / 2, id: d.id, cycle: d.cycle,
  }));

  return {
    focus: focusBox, members: memberRows, callers: callerBoxes, ghost, deps, edges, depEdges,
    cols: { callers: { x: G.MARGIN, shown: visible.length, total: view.length }, deps: { x: dx, shown: deps.length, total: dependencies.length } },
    memberFilter: active, hiddenCallers, hiddenDeps, totalCallers: usable.length,
    width: Math.ceil((deps.length ? dx + depW : fx + fw) + G.MARGIN),
    height: Math.ceil(top + colMaxH + G.MARGIN),
  };
}
