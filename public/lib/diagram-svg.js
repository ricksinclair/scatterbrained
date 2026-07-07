// diagram-svg.js — sentinel→CSS-var rewriting + sanitization for rendered PlantUML
// SVGs (pure; shared server/client — the server runs it before caching).
// The render uses ONE sentinel theme (public/plantuml/_sentinel.puml); this module
// swaps each magic hex for its CSS custom property so the SVG re-themes live when
// applyTheme() rewrites the vars — zero re-renders, theme-agnostic render cache.
import { SENTINELS } from './puml-theme.js';

// PlantUML emits colors in fill="…" / stroke="…" attributes and style="…" blocks,
// verbatim and case-preserved; a plain global, case-insensitive replace covers all.
export function rewriteSentinels(svg) {
  let out = String(svg || '');
  for (const [hex, cssVar] of Object.entries(SENTINELS)) {
    out = out.replace(new RegExp(hex, 'gi'), cssVar);
  }
  return out;
}

// Scale-to-container: keep viewBox, drop the fixed width/height PlantUML bakes in
// (both the attributes AND the style="width:…;height:…" form), and tag the root for
// styling. Only touches the root <svg> element.
export function fitSvg(svg, className = 'sb-diagram') {
  return String(svg || '').replace(/<svg\b[^>]*>/i, (tag) =>
    tag
      .replace(/\s(width|height)="[^"]*"/gi, '')
      .replace(/(style="[^"]*)"/i, (_, style) => style.replace(/(?:^|;)\s*(?:width|height):[^;"]*/gi, '') + '"')
      .replace(/<svg\b/i, (s) => `${s} class="${className}"`));
}

// Sanitize before innerHTML: PlantUML [[url]] links can carry arbitrary schemes, and
// SVG is a script container. Strip <script>/<foreignObject>, on* handlers, and any
// href that isn't http(s) or a fragment. (Same posture as the docs sanitizer.)
export function sanitizeSvg(svg) {
  let out = String(svg || '');
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s(href|xlink:href)\s*=\s*"([^"]*)"/gi, (m, attr, url) =>
    /^(https?:|#)/i.test(url.trim()) ? m : '');
  return out;
}

// The full post-render pipeline (what the server's render endpoint applies).
export function prepareSvg(svg) {
  return fitSvg(sanitizeSvg(rewriteSentinels(svg)));
}
