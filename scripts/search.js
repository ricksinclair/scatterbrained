#!/usr/bin/env node
// ============================================================================
// search.js — keyword/full-text retrieval (the lexical lane of hybrid recall).
//
// Uses Neo4j's native full-text index (`knowledge_text`, BM25/Lucene) over every
// text-bearing property in the graph. No LLM, no API, no embeddings — pure,
// fast, owned lexical search, ranked by relevance.
//
// Bi-temporal aware: superseded nodes (valid_until in the past) are excluded by
// default, so search reflects what's currently true. Each hit carries its
// provenance (the Sources that INFORM it) and what it's ABOUT — so a result is
// explainable, not a bare string match.
//
// This is the first lane of the roadmap (engram #1). The semantic/vector lane
// (local embeddings + a Neo4j vector index, fused with this) is the next step.
//
// Usage:
//   node scripts/search.js "cooperative governance"
//   node scripts/search.js "knowledge graph" --limit 5
//   node scripts/search.js "governance" --label Insight
//   node scripts/search.js "engram OR neo4j" --json        # Lucene syntax supported
//   node scripts/search.js "..." --include-superseded
// ============================================================================
import neo4j from 'neo4j-driver';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

const INDEX = 'knowledge_text';

const CYPHER = `
  CALL db.index.fulltext.queryNodes($index, $q) YIELD node, score
  WHERE ($label IS NULL OR $label IN labels(node))
    AND ($includeSuperseded OR node.valid_until IS NULL OR node.valid_until >= datetime())
  WITH node, score ORDER BY score DESC LIMIT $limit
  RETURN labels(node)[0] AS label,
         coalesce(node.name, node.title, node.summary, node.id) AS key,
         score,
         node.valid_until IS NOT NULL AS superseded,
         [(node)-[:ABOUT]->(t) | coalesce(t.name, t.title)][0..3] AS about,
         [(s:Source)-[:INFORMS]->(node) | coalesce(s.title, s.url)][0..3] AS sources`;

function trunc(s, n) {
  const t = s == null ? '' : String(s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const q = (args._ || []).join(' ').trim();
  if (!q) {
    console.error('Usage: node scripts/search.js "<query>" [--limit N] [--label L] [--json] [--include-superseded]');
    process.exit(1);
  }
  const limit = args.limit ? Number(args.limit) : 10;
  const params = {
    index: INDEX,
    q,
    label: args.label && args.label !== true ? String(args.label) : null,
    includeSuperseded: Boolean(args['include-superseded']),
    limit: neo4j.int(Number.isFinite(limit) && limit > 0 ? limit : 10),
  };

  const driver = getDriver();
  let rows;
  try {
    const recs = await run(driver, CYPHER, params);
    rows = recs.map((r) => ({
      label: toPlain(r.get('label')),
      key: toPlain(r.get('key')),
      score: toPlain(r.get('score')),
      superseded: toPlain(r.get('superseded')),
      about: toPlain(r.get('about')),
      sources: toPlain(r.get('sources')),
    }));
  } catch (err) {
    if (/no such fulltext|index.*does not exist|knowledge_text/i.test(err.message)) {
      console.error(`search: full-text index "${INDEX}" not found. Create it:\n  cat scripts/seed-schema.cypher | docker exec -i <neo4j> cypher-shell -u neo4j -p <pw>`);
      process.exit(2);
    }
    throw err;
  } finally {
    await driver.close();
  }

  if (args.json) {
    console.log(JSON.stringify({ query: q, count: rows.length, results: rows }, null, 2));
    return;
  }

  console.log(`\n🔎 "${q}" — ${rows.length} result${rows.length === 1 ? '' : 's'}\n`);
  if (!rows.length) {
    console.log('No matches. Try broader terms, OR-joined alternatives, or --include-superseded.\n');
    return;
  }
  for (const r of rows) {
    const tag = r.superseded ? ' [superseded]' : '';
    console.log(`  ${r.score.toFixed(2)}  (${r.label})${tag}  ${trunc(r.key, 88)}`);
    if (r.about && r.about.length) console.log(`        about: ${r.about.join(', ')}`);
    if (r.sources && r.sources.length) console.log(`         via:   ${r.sources.map((s) => trunc(s, 40)).join(' · ')}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('search error:', err.message);
  process.exit(1);
});
