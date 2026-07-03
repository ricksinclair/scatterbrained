// impact-svg.js — dumb SVG stringifier for impactLayout() (impact-uml.js): every coordinate is
// already decided by the tested pure layout; this file only emits markup. Themed entirely from
// tokens.css via the .dag-* classes. The caller (codebase-ui.js) delegates clicks off the data
// attributes: data-rel (drill into a file's impact), data-open/data-line (open a file at a call
// line), data-member (filter the diagram to one focus member), data-expand (show all callers);
// data-key/data-member on edges power the hover highlight.
import { langColor } from './lang-colors.js';
import { G, memberLabel } from './impact-uml.js';

const base = (rel) => (rel && rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel) || '';
const cap = (s, n = 26) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const bez = (e) => { const mx = (e.x1 + e.x2) / 2; return `M${e.x1.toFixed(1)},${e.y1.toFixed(1)} C${mx.toFixed(1)},${e.y1.toFixed(1)} ${mx.toFixed(1)},${e.y2.toFixed(1)} ${e.x2.toFixed(1)},${e.y2.toFixed(1)}`; };

export function renderImpactSvg(L, { esc = (s) => s } = {}) {
  if (!L || (!L.callers.length && !L.deps.length && !L.members.length)) return '';
  const capY = G.MARGIN + 12;
  const caption = (x, text) => `<text class="dag-cap" x="${x}" y="${capY}">${esc(text)}</text>`;
  let s = `<svg class="dag" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" role="img" `
    + `aria-label="dependency diagram: ${L.cols.callers.total} callers into ${esc(base(L.focus.id))}, ${L.cols.deps.total} imports out">`
    + `<defs><marker id="dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
    + `<path class="dag-arrowhead" d="M0,0 L8,4 L0,8 z"/></marker></defs>`;

  if (L.callers.length) s += caption(L.cols.callers.x, `callers · ${L.cols.callers.shown === L.cols.callers.total ? L.cols.callers.total : L.cols.callers.shown + ' of ' + L.cols.callers.total}`);
  if (L.deps.length) s += caption(L.cols.deps.x, `imports · ${L.cols.deps.total}`);

  // edges first, nodes on top
  s += L.edges.map((e) =>
    `<path class="dag-edge${e.kind === 'type' ? ' dag-edge-type' : ''}" data-member="${esc(e.member)}" data-key="${esc(e.key)}" d="${bez(e)}" marker-end="url(#dag-arrow)"/>`).join('');
  s += L.depEdges.map((e) =>
    `<path class="dag-edge dag-edge-dep${e.cycle ? ' dag-edge-back' : ''}" d="${bez(e)}" marker-end="url(#dag-arrow)"/>`).join('');

  // caller boxes: header (drills) + method compartment (each row opens the file at its line)
  s += L.callers.map((b) => {
    let n = `<g class="dag-node" data-rel="${esc(b.id)}" transform="translate(${b.x.toFixed(1)},${b.y.toFixed(1)})">`
      + `<title>${esc(b.id)}</title>`
      + `<rect class="dag-pill" width="${b.w.toFixed(1)}" height="${b.h}" rx="8"/>`
      + `<circle class="dag-dot" cx="${G.PAD_X + G.DOT / 2}" cy="${G.HEADER_H / 2}" r="${G.DOT / 2}" fill="${langColor(b.lang || 'other')}"/>`
      + `<text class="dag-label" x="${G.PAD_X + G.DOT + G.GAP}" y="${G.HEADER_H / 2}" dominant-baseline="central">${esc(cap(base(b.id)))}</text>`
      + `<line class="dag-div" x1="0" y1="${G.HEADER_H}" x2="${b.w.toFixed(1)}" y2="${G.HEADER_H}"/>`;
    b.methods.forEach((m, i) => {
      const ry = G.HEADER_H + G.COMPART_PAD + i * G.METHOD_H, ty = ry + G.METHOD_H / 2;
      n += `<g class="dag-method" data-open="${esc(b.path || '')}" data-line="${m.line}" data-key="${esc(m.key)}">`
        + `<title>${esc(m.label)} → ${esc(m.members.map((x) => x.name).join(', '))} · line ${m.lines.join(', ')}</title>`
        + `<rect class="dag-mhit" x="1" y="${ry}" width="${(b.w - 2).toFixed(1)}" height="${G.METHOD_H}"/>`
        + `<text class="dag-mlabel" x="${G.PAD_X}" y="${ty}" dominant-baseline="central">${esc(m.label)}</text>`
        + `<text class="dag-mline" x="${(b.w - G.PAD_X).toFixed(1)}" y="${ty}" text-anchor="end" dominant-baseline="central">${m.line}${m.lines.length > 1 ? '+' : ''}</text></g>`;
    });
    if (b.moreMethods) n += `<text class="dag-mmore" x="${G.PAD_X}" y="${G.HEADER_H + G.COMPART_PAD + b.methods.length * G.METHOD_H + G.METHOD_H / 2}" dominant-baseline="central">+${b.moreMethods} more</text>`;
    return n + `</g>`;
  }).join('');

  if (L.ghost) s += `<g class="dag-ghost" data-expand="1" transform="translate(${L.ghost.x},${L.ghost.y.toFixed(1)})">`
    + `<rect class="dag-ghost-pill" width="${L.ghost.w.toFixed(1)}" height="${L.ghost.h}" rx="8"/>`
    + `<text class="dag-ghost-t" x="${(L.ghost.w / 2).toFixed(1)}" y="${L.ghost.h / 2}" text-anchor="middle" dominant-baseline="central">+${L.ghost.count} more caller${L.ghost.count === 1 ? '' : 's'} — show all</text></g>`;

  // the focus: a UML class box whose compartment is its USED api surface (click a row to filter)
  const F = L.focus;
  s += `<g class="dag-node dag-focus" transform="translate(${F.x.toFixed(1)},${F.y.toFixed(1)})">`
    + `<title>${esc(F.id || '')}</title>`
    + `<rect class="dag-pill" width="${F.w.toFixed(1)}" height="${F.h}" rx="10"/>`
    + `<circle class="dag-dot" cx="${G.PAD_X + G.DOT / 2}" cy="${G.F_HEADER_H / 2}" r="${G.DOT / 2}" fill="${langColor(F.lang || 'other')}"/>`
    + `<text class="dag-flabel" x="${G.PAD_X + G.DOT + G.GAP}" y="${G.F_HEADER_H / 2}" dominant-baseline="central">${esc(cap(base(F.id || ''), 30))}</text>`;
  if (L.members.length) {
    s += `<line class="dag-div" x1="0" y1="${G.F_HEADER_H}" x2="${F.w.toFixed(1)}" y2="${G.F_HEADER_H}"/>`;
    for (const m of L.members) {
      const ry = m.y - F.y, ty = ry + G.MEMBER_H / 2;
      s += `<g class="dag-member${m.kind === 'type' ? ' dag-member-type' : ''}${m.on ? ' on' : ''}" data-member="${esc(m.name)}">`
        + `<title>${esc(m.name)} — used by ${m.callerCount} caller${m.callerCount === 1 ? '' : 's'} (click to ${m.on ? 'clear filter' : 'filter'})</title>`
        + `<rect class="dag-mhit" x="1" y="${ry.toFixed(1)}" width="${(F.w - 2).toFixed(1)}" height="${G.MEMBER_H}"/>`
        + `<text class="dag-mem-l" x="${G.PAD_X}" y="${ty.toFixed(1)}" dominant-baseline="central">${esc(memberLabel(m))}</text>`
        + `<text class="dag-mem-n" x="${(F.w - G.PAD_X).toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="end" dominant-baseline="central">${m.callerCount}</text></g>`;
    }
  }
  s += `</g>`;

  // imports: header-only pills, drillable like any node
  s += L.deps.map((d) => `<g class="dag-node" data-rel="${esc(d.id)}" transform="translate(${d.x},${d.y.toFixed(1)})">`
    + `<title>${esc(d.id)}${d.cycle ? ' — also imports the focus (cycle)' : ''}</title>`
    + `<rect class="dag-pill" width="${d.w.toFixed(1)}" height="${d.h}" rx="12"/>`
    + `<circle class="dag-dot" cx="${G.PAD_X + G.DOT / 2}" cy="${d.h / 2}" r="${G.DOT / 2}" fill="${langColor(d.lang || 'other')}"/>`
    + `<text class="dag-label" x="${G.PAD_X + G.DOT + G.GAP}" y="${d.h / 2}" dominant-baseline="central">${esc(cap(base(d.id)))}</text></g>`).join('');
  if (L.hiddenDeps > 0) {
    const last = L.deps[L.deps.length - 1];
    s += `<text class="dag-mmore" x="${L.cols.deps.x}" y="${(last.y + last.h + G.GHOST_H / 2).toFixed(1)}" dominant-baseline="central">+${L.hiddenDeps} more — full list below</text>`;
  }
  return s + `</svg>`;
}
