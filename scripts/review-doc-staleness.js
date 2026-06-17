#!/usr/bin/env node
// ============================================================================
// review-doc-staleness.js — surface docs that probably DRIFTED (the blind spot
// hash-based change-detection can't see).
//
// document-index / notion-index catch when a doc CHANGED. They are blind to when
// a doc SHOULD have changed but didn't — a human-readable artifact (a Notion page,
// a README, the live site) that's stale precisely because it was left UNTOUCHED
// while the thing it describes moved on.
//
// Signal: when a fresh CONCLUSION lands on a project (a new Insight ABOUT it —
// "we shipped/decided X"), any describing Source that INFORMS that same project
// and predates the conclusion is a drift candidate. Re-read it and confirm it
// still reflects reality; fix what drifted (e.g. a "not built yet" that shipped).
//
// It NEVER edits — it lists candidates, like review-supersession. The agent /
// human verifies and fixes.
//
// Usage:
//   node scripts/review-doc-staleness.js                  # projects with a conclusion in the last 14d
//   node scripts/review-doc-staleness.js --days 30
//   node scripts/review-doc-staleness.js --project Scatterbrained
//   node scripts/review-doc-staleness.js --json
// ============================================================================
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

// Human-readable "this describes the project" artifacts that can silently rot.
const DESCRIBING = ['notion_page', 'notion_workspace', 'markdown', 'live_demo'];

const CYPHER = `
  MATCH (p:Project)<-[:ABOUT]-(i:Insight)
  WHERE ($project IS NULL OR p.name = $project)
  WITH p, max(i.created_at) AS newest
  WHERE newest >= datetime() - duration({days: $days})       // project moved recently
  MATCH (p)<-[:INFORMS]-(s:Source)
  WHERE s.source_kind IN $kinds
    AND coalesce(s.last_synced_at, s.created_at) < newest     // the doc predates the conclusion
  RETURN p.name AS project, s.title AS doc, s.source_kind AS kind, s.url AS url,
         toString(coalesce(s.last_synced_at, s.created_at)) AS doc_updated,
         toString(newest) AS latest_conclusion,
         duration.inDays(coalesce(s.last_synced_at, s.created_at), newest).days AS days_behind
  ORDER BY days_behind DESC, project`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const params = {
    project: args.project && args.project !== true ? String(args.project) : null,
    days: args.days ? Number(args.days) : 14,
    kinds: DESCRIBING,
  };

  const driver = getDriver();
  let rows = [];
  try {
    const recs = await run(driver, CYPHER, params);
    rows = recs.map((r) => ({
      project: toPlain(r.get('project')), doc: toPlain(r.get('doc')), kind: toPlain(r.get('kind')),
      url: toPlain(r.get('url')), doc_updated: toPlain(r.get('doc_updated')),
      latest_conclusion: toPlain(r.get('latest_conclusion')), days_behind: toPlain(r.get('days_behind')),
    }));
  } finally {
    await driver.close();
  }

  if (args.json) { console.log(JSON.stringify({ params, candidates: rows }, null, 2)); return; }

  console.log(`\n📄 Doc-drift review — describing docs that predate a conclusion from the last ${params.days}d${params.project ? ` · project=${params.project}` : ''}\n`);
  if (!rows.length) { console.log('No drift candidates. Describing docs are at least as fresh as the latest conclusions.\n'); return; }
  console.log(`${rows.length} candidate(s) — RE-READ each and confirm it still reflects reality (change-detection can't catch this):\n`);
  let last = null;
  for (const r of rows) {
    if (r.project !== last) { console.log(`▸ ${r.project}  (latest conclusion: ${r.latest_conclusion})`); last = r.project; }
    console.log(`    ${String(r.days_behind).padStart(3)}d behind · (${r.kind}) ${r.doc}${r.url ? `  ${r.url}` : ''}`);
  }
  console.log('\nThese are CANDIDATES — verify, then fix any that drifted. Nothing was changed.\n');
}

main().catch((err) => { console.error('review-doc-staleness error:', err.message); process.exit(1); });
