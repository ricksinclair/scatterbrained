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
  node.former_name AS former_name,
  [(node)-[:ABOUT]->(t) | coalesce(t.name, t.title)][0..3] AS about,
  [(s:Source)-[:INFORMS]->(node) | coalesce(s.title, s.url)][0..3] AS sources`;

const FILTER = `
  ($label IS NULL OR $label IN labels(node))
  AND ($includeSuperseded OR node.valid_until IS NULL OR node.valid_until >= datetime())`;

function mapRows(recs) {
  return recs.map((r) => ({
    eid: toPlain(r.get('eid')), label: toPlain(r.get('label')), key: toPlain(r.get('key')),
    superseded: toPlain(r.get('superseded')), former_name: toPlain(r.get('former_name')),
    about: toPlain(r.get('about')), sources: toPlain(r.get('sources')),
  }));
}

// Lucene syntax is a feature at the CLI, but /api/search and the voice agent's search_nodes
// hand this lane whatever a human typed. A trailing `AND` or an unbalanced `(` makes Lucene
// throw (verified: Neo.ClientError.Procedure.ProcedureCallFailed) — a class of 500 the old
// CONTAINS query could not produce. Escape the syntax characters and lowercase the bare
// boolean operators (Lucene only honors them in caps), turning the query into literal terms.
const LUCENE_SPECIAL = /[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g;
export function escapeLucene(q) {
  return String(q ?? '')
    .replace(LUCENE_SPECIAL, (m) => m.split('').map((c) => `\\${c}`).join(''))
    .replace(/\b(AND|OR|NOT)\b/g, (m) => m.toLowerCase())
    .trim();
}

// Superseded facts are kept, never deleted — so they stay searchable, but a current answer
// must outrank a retired one. Stable, so fused rank survives within each group.
export function demoteSuperseded(rows) {
  return [...rows].sort((a, b) => Number(!!a.superseded) - Number(!!b.superseded));
}

const KEYWORD_CYPHER = `
    CALL db.index.fulltext.queryNodes('knowledge_text', $q) YIELD node, score
    WHERE ${FILTER}
    WITH node, score ORDER BY score DESC LIMIT $pull
    RETURN ${PROJECT}, score`;

async function keywordLane(driver, q, params, pull) {
  const ask = (query) => run(driver, KEYWORD_CYPHER, { ...params, q: query, pull: neo4j.int(pull) });
  let recs;
  try {
    recs = await ask(q);                       // honor deliberate Lucene syntax when it parses
  } catch {
    const safe = escapeLucene(q);              // …otherwise treat the whole thing as literal terms
    if (!safe) return [];
    recs = await ask(safe);
  }
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

// Weighted RRF: fuse by RANK POSITION per lane (never raw scores — BM25 and cosine
// live on incompatible scales), each lane scaled by its weight. No weights → every
// lane weighs 1, the original behavior.
export function rrfFuse(lanes, weights = {}) {
  const merged = new Map();
  for (const [name, rows] of Object.entries(lanes)) {
    const w = weights[name] ?? 1;
    (rows || []).forEach((row, i) => {
      let m = merged.get(row.eid);
      if (!m) { m = { ...row, lanes: {}, rrf: 0 }; merged.set(row.eid, m); }
      m.lanes[name] = i + 1;
      m.rrf += w / (RRF_K + i + 1);
    });
  }
  return [...merged.values()].sort((a, b) => b.rrf - a.rrf);
}

// Query-type-aware lane weights — a heuristic, deliberately not a classifier.
// Exact-token queries (a product codename, "golden-questions harness", quoted phrases) are
// navigational: the exact words are the strongest clue → trust BM25. Long or
// question-shaped queries are exploratory: paraphrase matters → trust vectors.
export function laneWeights(q) {
  const s = String(q || '').trim();
  const tokens = s.split(/\s+/).filter(Boolean);
  const questionish = /^(why|how|what|who|where|when|which|did|do|does|is|are|can|should)\b/i.test(s) || s.endsWith('?');
  const nameish = tokens.some((t) => /[-_]/.test(t) || /\d/.test(t) || /^[A-Z]{2,}/.test(t) || /^[a-z]+[A-Z]/.test(t));
  const quoted = /"[^"]+"/.test(s);
  // Navigational: the exact words are the strongest clue — damp the vector lane so a
  // stray both-lane match can't outvote the exact hit. Everything else: NEUTRAL.
  // (Measured 2026-07-09: up-weighting semantic on long/question queries cost hit@10
  // with this graph's lane strengths — the harness killed that half of the heuristic.)
  if (!questionish && (quoted || (tokens.length <= 3 && nameish) || tokens.length <= 2)) return { keyword: 1, semantic: 0.3 };
  return { keyword: 1, semantic: 1 };
}

// Graph-proximity rerank: tried and REJECTED against the golden-questions gate
// (2026-07-09). Raw in-set edge count crowned hub nodes over the specific answer
// (-18pp fused hit@1); even degree-normalized at boost 0.15 it cost -3.6pp hit@1 /
// -3pp MRR. Plain RRF's top-1 is right 71% here and proximity perturbation mostly
// breaks ties the wrong way. Don't re-add without beating the baseline in
// scripts/eval-baseline.json. The real headroom is the recall tail (Sources carry
// no body text), which is a content problem, not a ranking one.

// The one production search path — the CLI below and the retrieval eval harness
// (scripts/eval-retrieval.js) both call this, so what gets scored is what ships.
// Returns { lanesUsed, lanes (per-lane ranked rows), results (fused, sliced) }.
export async function searchGraph(driver, q, { limit = 10, label = null, includeSuperseded = false, keyword = true, semantic = true } = {}) {
  const pull = Math.max(limit * 3, 20);
  const params = { label, includeSuperseded };
  const lanes = {};
  const lanesUsed = [];
  if (keyword) { lanes.keyword = await keywordLane(driver, q, params, pull); lanesUsed.push('keyword'); }
  if (semantic && (await embedderAvailable())) {
    const vec = await embedOne(q, { query: true });
    const sem = await semanticLane(driver, vec, params, pull);
    if (sem) { lanes.semantic = sem; lanesUsed.push('semantic'); }
  }
  // WRRF (weights only matter when both lanes ran) + graph-proximity rerank over
  // a candidate pool deeper than the ask, so the rerank can pull a coherent
  // just-below-the-fold hit above a stray orphan.
  const fused = rrfFuse(lanes, lanesUsed.length > 1 ? laneWeights(q) : {});
  return { lanesUsed, lanes, results: fused.slice(0, limit) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const q = (args._ || []).join(' ').trim();
  if (!q) {
    console.error('Usage: node scripts/search.js "<query>" [--limit N] [--label L] [--keyword|--semantic] [--json] [--include-superseded]');
    process.exit(1);
  }
  const limit = args.limit ? Number(args.limit) : 10;

  const driver = getDriver();
  let lanesUsed = [];
  let fused = [];
  try {
    const out = await searchGraph(driver, q, {
      limit,
      label: args.label && args.label !== true ? String(args.label) : null,
      includeSuperseded: Boolean(args['include-superseded']),
      keyword: !args.semantic,
      semantic: !args.keyword,
    });
    lanesUsed = out.lanesUsed;
    fused = out.results;
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

// Run as a CLI only when invoked directly (so tests can import the exports).
if (process.argv[1] && process.argv[1].endsWith('search.js')) {
  main().catch((err) => {
    console.error('search error:', err.message);
    process.exit(1);
  });
}
