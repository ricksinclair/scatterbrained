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

// Structure-lossless JSON serializer (the "portable interop" export target). Same composed
// data the report renders; returns a plain object — the caller stringifies + downloads. Carries
// node identity, key facts, ranked relations, sources, and the chart spec (a Lens/data node's
// chart survives the round-trip since it lives in data.chart).
export function nodeToJson(signals = {}, data = {}) {
  const sources = data.sources || (data.edges || []).filter((e) => e.label === 'Source' && e.dir === 'in');
  const rels = rankEdges((data.edges || []).filter((e) => !(e.label === 'Source' && e.dir === 'in')));
  return {
    node: {
      id: signals.id || data.id || null,
      name: signals.name || null,
      label: signals.label || null,
      status: signals.status || null,
      tags: signals.tags || [],
      created_at: data.created_at || null,
      valid_until: data.valid_until || null,
      superseded_by: data.superseded_by || null,
    },
    text: signals.full_text || signals.desc || signals.description || null,
    facts: keyFacts(signals, data),
    edges: rels.map((e) => ({ type: e.type, dir: e.dir, name: e.name, label: e.label, id: e.id || null })),
    sources: sources.map((s) => ({ name: s.name, url: s.url || null, file_path: s.file_path || null, source_kind: s.source_kind || null })),
    chart: data.chart || null,
    exported_from: 'Scatterbrained Studio',
  };
}

// Safe filename from a node name, with an explicit extension (default 'md' for back-compat).
export function exportFilename(name, ext = 'md') {
  return (String(name || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node') + '.' + ext;
}
