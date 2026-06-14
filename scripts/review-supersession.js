#!/usr/bin/env node
// ============================================================================
// review-supersession.js — surface candidate stale Insights for human review.
//
// The graph never invalidates anything on its own (that needs your judgment),
// so recency is currently the only staleness signal. This script does the
// SURFACING half: within each domain (Insights that share an ABOUT target), it
// finds clusters of insights on overlapping topics and flags pairs where one is
// materially newer — the likely "newer replaces older" cases — so you can
// confirm and run `npm run supersede` on the ones that are genuinely dead.
//
// It NEVER writes. It only prints candidates. Heuristic, deliberately
// conservative: it suggests, the human decides.
//
// Usage:
//   node scripts/review-supersession.js                 # all projects
//   node scripts/review-supersession.js --project Acme
//   node scripts/review-supersession.js --min-overlap 2 # require >=2 shared tags
//   node scripts/review-supersession.js --gap-days 30   # newer must lead by >=N days
//   node scripts/review-supersession.js --json
// ============================================================================
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

// Candidate pairs: two *active* (not already invalidated) Insights that are
// ABOUT the same node, share >= $minOverlap tags, where one is >= $gapDays newer.
const CANDIDATES = `
  MATCH (a:Insight)-[:ABOUT]->(target)<-[:ABOUT]-(b:Insight)
  WHERE a.id < b.id                         // each unordered pair once
    AND a.valid_until IS NULL AND b.valid_until IS NULL
    AND coalesce(target.name, target.title) = coalesce($project, coalesce(target.name, target.title))
  WITH target, a, b,
       [t IN coalesce(a.tags, []) WHERE t IN coalesce(b.tags, [])] AS shared,
       coalesce(a.created_at, datetime('1970-01-01')) AS at_a,
       coalesce(b.created_at, datetime('1970-01-01')) AS at_b
  WHERE size(shared) >= $minOverlap
  WITH target, shared,
       CASE WHEN at_a >= at_b THEN b ELSE a END AS older,
       CASE WHEN at_a >= at_b THEN a ELSE b END AS newer,
       CASE WHEN at_a >= at_b THEN at_a ELSE at_b END AS newer_at,
       CASE WHEN at_a >= at_b THEN at_b ELSE at_a END AS older_at
  WHERE duration.inDays(older_at, newer_at).days >= $gapDays
  RETURN coalesce(target.name, target.title) AS domain,
         shared AS shared_tags,
         older.id AS older_id, coalesce(older.summary, older.name) AS older_summary, toString(older_at) AS older_at,
         newer.id AS newer_id, coalesce(newer.summary, newer.name) AS newer_summary, toString(newer_at) AS newer_at
  ORDER BY domain, newer_at DESC`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const params = {
    project: args.project && args.project !== true ? String(args.project) : null,
    minOverlap: args['min-overlap'] ? Number(args['min-overlap']) : 1,
    gapDays: args['gap-days'] ? Number(args['gap-days']) : 14,
  };

  const driver = getDriver();
  let rows = [];
  try {
    const recs = await run(driver, CANDIDATES, params);
    rows = recs.map((r) => ({
      domain: toPlain(r.get('domain')),
      shared_tags: toPlain(r.get('shared_tags')),
      older_id: toPlain(r.get('older_id')),
      older_summary: toPlain(r.get('older_summary')),
      older_at: toPlain(r.get('older_at')),
      newer_id: toPlain(r.get('newer_id')),
      newer_summary: toPlain(r.get('newer_summary')),
      newer_at: toPlain(r.get('newer_at')),
    }));
  } finally {
    await driver.close();
  }

  if (args.json) {
    console.log(JSON.stringify({ params, candidates: rows }, null, 2));
    return;
  }

  console.log(`\n🕰️  Supersession review — overlap>=${params.minOverlap} tag(s), newer leads by >=${params.gapDays}d${params.project ? `, project=${params.project}` : ''}\n`);
  if (rows.length === 0) {
    console.log('No candidate pairs. Either nothing overlaps enough, or staleness is already marked.\n');
    return;
  }
  console.log(`${rows.length} candidate pair(s) — review and, if the older is genuinely replaced, run the suggested command:\n`);
  for (const r of rows) {
    console.log(`▸ domain: ${r.domain}   shared: [${(r.shared_tags || []).join(', ')}]`);
    console.log(`    OLDER (${r.older_at}): ${truncate(r.older_summary)}`);
    console.log(`    NEWER (${r.newer_at}): ${truncate(r.newer_summary)}`);
    console.log(`    ↳ if replaced:  npm run supersede -- --old ${r.older_id} --by ${r.newer_id} --reason "<why>"\n`);
  }
  console.log('These are SUGGESTIONS — confirm each before superseding. Nothing was written.\n');
}

function truncate(s, n = 110) {
  const t = s == null ? '' : String(s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

main().catch((err) => {
  console.error('review-supersession error:', err.message);
  process.exit(2);
});
