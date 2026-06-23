// Report export (M3, Act layer) — turn the current node + its composed data into a
// portable, citable Markdown briefing (personas P5 strategist, P4 second-brain).
// Pure → tested; the app just wraps the string in a download. Grounded in the same
// data the report renders, so the briefing matches what's on screen.
import { keyFacts, rankEdges } from './registry.js';

export function nodeToMarkdown(signals = {}, data = {}) {
  const L = [];
  const name = signals.name || 'Untitled';
  L.push(`# ${name}`);
  const meta = [signals.label, signals.status, data.valid_until ? `superseded ${String(data.valid_until).slice(0, 10)}` : null]
    .filter(Boolean).join(' · ');
  if (meta) L.push(`*${meta}*`);
  L.push('');

  const body = signals.full_text || signals.desc || signals.description;
  if (body) { L.push(body.trim()); L.push(''); }

  const facts = keyFacts(signals, data);
  if (facts.length) {
    L.push('## Key facts');
    facts.forEach((f) => L.push(`- **${f.label}:** ${f.value}`));
    L.push('');
  }

  const sources = data.sources || (data.edges || []).filter((e) => e.label === 'Source' && e.dir === 'in');
  if (sources.length) {
    L.push(`## Sources (${sources.length})`);
    sources.slice(0, 20).forEach((s) => {
      const ref = s.url || s.file_path;
      L.push(ref ? `- [${s.name}](${ref})` : `- ${s.name}`);
    });
    L.push('');
  }

  const rels = rankEdges((data.edges || []).filter((e) => !(e.label === 'Source' && e.dir === 'in')));
  if (rels.length) {
    L.push('## Relations');
    rels.slice(0, 24).forEach((e) => L.push(`- ${e.type} ${e.dir === 'out' ? '→' : '←'} ${e.name}`));
    L.push('');
  }

  if (data.source && data.source.text) {
    L.push(`## Excerpt — ${data.source.title || 'source'}`);
    L.push('```');
    L.push(data.source.text.trim());
    L.push('```');
    L.push('');
  }

  L.push(`---\n_Exported from Scatterbrained Studio._`);
  return L.join('\n');
}

// Safe filename from a node name.
export function exportFilename(name) {
  return (String(name || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node') + '.md';
}
