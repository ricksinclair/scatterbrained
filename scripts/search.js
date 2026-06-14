#!/usr/bin/env node
// ============================================================================
// search.js — hybrid retrieval over the graph (keyword + semantic + provenance).
//
// Two lanes, fused with Reciprocal Rank Fusion (RRF):
//   • KEYWORD  — Neo4j full-text (BM25/Lucene) over every text property. Always on.
//   • SEMANTIC — k-NN over the `knowledge_vec` vector index (local bge-small
//                embeddings). On automatically IFF the optional embedder is
//                installed AND nodes have been embedded (`npm run embed`).
//
// Graceful degradation: with no embedder/embeddings, search runs keyword-only —
// exactly as before, no error. Bi-temporal aware (superseded nodes excluded by
// default). Every hit carries provenance (Sources) and what it's ABOUT.
//
// Usage:
//   node scripts/search.js "cooperative governance"      # hybrid if available
//   node scripts/search.js "..." --keyword               # force keyword-only
//   node scripts/search.js "..." --semantic              # force vector-only
//   node scripts/search.js "..." --limit 5 --label Insight --json
//   node scripts/search.js "..." --include-superseded
// ============================================================================
import neo4j from 'neo4j-driver';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';
import { embedderAvailable, embedOne } from './lib/embedder.js';

const RRF_K = 60; // standard RRF constant

// Shared display projection for a matched node, by lane query.
const PROJECT = `
  elementId(node) AS eid, labels(node)[0] AS label,
  coalesce(node.name, node.title, node.summary, node.id) AS key,
  node.valid_until IS NOT NULL AS superseded,
  [(node)-[:ABOUT]->(t) | coalesce(t.name, t.title)][0..3] AS about,
  [(s:Source)-[:INFORMS]->(node) | coalesce(s.title, s.url)][0..3] AS sources`;

const FILTER = `
  ($label IS NULL OR $label IN labels(node))
  AND ($includeSuperseded OR node.valid_until IS NULL OR node.valid_until >= datetime())`;

function mapRows(recs) {
  return recs.map((r) => ({
    eid: toPlain(r.get('eid')), label: toPlain(r.get('label')), key: toPlain(r.get('key')),
    superseded: toPlain(r.get('superseded')), about: toPlain(r.get('about')), sources: toPlain(r.get('sources')),
  }));
}

async function keywordLane(driver, q, params, pull) {
  const recs = await run(driver, `
    CALL db.index.fulltext.queryNodes('knowledge_text', $q) YIELD node, score
    WHERE ${FILTER}
    WITH node, score ORDER BY score DESC LIMIT $pull
    RETURN ${PROJECT}, score`, { ...params, q, pull: neo4j.int(pull) });
  return mapRows(recs);
}

async function semanticLane(driver, vec, params, pull) {
  try {
    const recs = await run(driver, `
      CALL db.index.vector.queryNodes('knowledge_vec', $pull, $vec) YIELD node, score
      WHERE ${FILTER}
      RETURN ${PROJECT}, score`, { ...params, vec, pull: neo4j.int(pull) });
    return mapRows(recs);
  } catch {
    return null; // index missing / empty / unsupported -> lane unavailable
  }
}

function rrfFuse(lanes) {
  const merged = new Map();
  for (const [name, rows] of Object.entries(lanes)) {
    (rows || []).forEach((row, i) => {
      let m = merged.get(row.eid);
      if (!m) { m = { ...row, lanes: {}, rrf: 0 }; merged.set(row.eid, m); }
      m.lanes[name] = i + 1;
      m.rrf += 1 / (RRF_K + i + 1);
    });
  }
  return [...merged.values()].sort((a, b) => b.rrf - a.rrf);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const q = (args._ || []).join(' ').trim();
  if (!q) {
    console.error('Usage: node scripts/search.js "<query>" [--limit N] [--label L] [--keyword|--semantic] [--json] [--include-superseded]');
    process.exit(1);
  }
  const limit = args.limit ? Number(args.limit) : 10;
  const pull = Math.max(limit * 3, 20);
  const params = {
    label: args.label && args.label !== true ? String(args.label) : null,
    includeSuperseded: Boolean(args['include-superseded']),
  };
  const wantKeyword = !args.semantic;
  const wantSemantic = !args.keyword;

  const driver = getDriver();
  let lanesUsed = [];
  let fused = [];
  try {
    const lanes = {};
    if (wantKeyword) { lanes.keyword = await keywordLane(driver, q, params, pull); lanesUsed.push('keyword'); }
    if (wantSemantic && (await embedderAvailable())) {
      const vec = await embedOne(q, { query: true });
      const sem = await semanticLane(driver, vec, params, pull);
      if (sem) { lanes.semantic = sem; lanesUsed.push('semantic'); }
    }
    fused = rrfFuse(lanes).slice(0, limit);
  } finally {
    await driver.close();
  }

  if (args.json) {
    console.log(JSON.stringify({ query: q, lanes: lanesUsed, count: fused.length, results: fused }, null, 2));
    return;
  }

  const mode = lanesUsed.length === 2 ? 'hybrid' : (lanesUsed[0] || 'none');
  console.log(`\n🔎 "${q}" — ${fused.length} result${fused.length === 1 ? '' : 's'} · ${mode}${args.semantic || args.keyword ? '' : (lanesUsed.includes('semantic') ? '' : ' (semantic lane off — run `embed` + install @xenova/transformers)')}\n`);
  if (!fused.length) { console.log('No matches. Try broader terms or --include-superseded.\n'); return; }
  for (const r of fused) {
    const where = Object.keys(r.lanes).map((l) => l[0]).join('+'); // k, s, or k+s
    const tag = r.superseded ? ' [superseded]' : '';
    console.log(`  ·${where}·  (${r.label})${tag}  ${r.key.length > 84 ? r.key.slice(0, 84) + '…' : r.key}`);
    if (r.about && r.about.length) console.log(`         about: ${r.about.join(', ')}`);
    if (r.sources && r.sources.length) console.log(`         via:   ${r.sources.map((s) => (s.length > 40 ? s.slice(0, 40) + '…' : s)).join(' · ')}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('search error:', err.message);
  process.exit(1);
});
