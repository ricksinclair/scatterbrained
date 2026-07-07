// Self-contained HTML serializer (the "portable, keeps the visuals" export target — the answer to
// Markdown's lossiness). Same composed `parts` the report renders, wrapped in one standalone file:
// inline stylesheet, no external requests, SVG charts embed natively. Pure → tested; the app supplies
// `css` (a style string with CSS-var values already resolved via getComputedStyle) so this module
// never touches the DOM. PDF reuses this output + a print stylesheet + window.print() (no serializer).
import { esc } from './dom.js';
import { keyFacts } from './registry.js';

export function nodeToHtml(signals = {}, data = {}, parts = [], { css = '' } = {}) {
  const name = signals.name || 'Untitled';
  const meta = [signals.label, signals.status, data.valid_until ? `superseded ${String(data.valid_until).slice(0, 10)}` : null]
    .filter(Boolean).join(' · ');
  const facts = keyFacts(signals, data);
  const factsHtml = facts.length
    ? `<div class="x-facts">${facts.map((f) => `<span class="x-fact"><b>${esc(f.value)}</b> ${esc(f.label)}</span>`).join('')}</div>`
    : '';
  const body = signals.full_text || signals.desc || signals.description;
  const bodyHtml = body ? `<p class="x-body">${esc(body)}</p>` : '';
  // parts[].html is trusted composed output (registry renderers already escape their inputs) — the
  // ONE place raw HTML is emitted, exactly as the on-screen report does. Everything from the raw
  // node (name/meta/body/facts) is escaped above.
  const sections = parts.map((p) => `<section class="rpt-c rpt-c-${esc(p.id)}">${p.html}</section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>${css}</style>
</head>
<body class="sb-export">
<header class="x-head"><h1>${esc(name)}</h1>${meta ? `<div class="x-meta">${esc(meta)}</div>` : ''}${factsHtml}${bodyHtml}</header>
<main class="x-main">
${sections}
</main>
<footer class="x-foot">Exported from Scatterbrained Studio</footer>
</body></html>`;
}
