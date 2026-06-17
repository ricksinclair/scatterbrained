#!/usr/bin/env node
// ============================================================================
// review-undocumented-decisions.js — surface decisions that live ONLY in the
// graph and never made it to a human-readable surface (the write-back gap).
//
// Scatterbrained makes the graph canonical and Notion/docs a capture lane. That keeps
// the machine's memory current — but the agent's own conclusions land as
// `Insight` nodes, which a human can't casually read. Left unchecked you get the
// INVERSE of the original problem: a rich, fresh graph behind STALE human docs.
//
// review-doc-staleness.js is doc-centric ("which describing doc drifted — re-read
// it"). It structurally CANNOT flag the worst case: a decision with NO human
// surface at all (there's no row to match). This script is decision-centric:
// for each recent decision (an `Insight` ABOUT a project), is there ANY
// human-readable surface — Notion page/workspace, README, the live site —
// refreshed at or after it? If not, the decision is undocumented-for-humans.
//
// Heuristic (same proxy as review-doc-staleness): a human surface touched at/after
// the decision is treated as "covers it." Freshness ≠ proof it documents that
// exact decision, but it's the cheap, deterministic signal. It NEVER edits — it
// lists candidates for the agent/human to write up (dual-write: graph + Notion/CHANGELOG).
//
// Usage:
//   node scripts/review-undocumented-decisions.js                 # decisions from the last 14d
//   node scripts/review-undocumented-decisions.js --days 30
//   node scripts/review-undocumented-decisions.js --project Scatterbrained
//   node scripts/review-undocumented-decisions.js --json
// ============================================================================
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

// Human-readable "this describes the project" surfaces a person actually reads.
export const HUMAN_SURFACES = ['notion_page', 'notion_workspace', 'markdown', 'live_demo'];

export const CYPHER = `
  MATCH (p:Project)<-[:ABOUT]-(i:Insight)
  WHERE ($project IS NULL OR p.name = $project)
    AND i.created_at >= datetime() - duration({days: $days})
  WITH p, collect({summary: coalesce(i.summary, '(Insight has no summary — add one)'), at: i.created_at}) AS decisions
  OPTIONAL MATCH (p)<-[:INFORMS]-(s:Source)
    WHERE s.source_kind IN $kinds
  WITH p, decisions,
       max(coalesce(s.last_synced_at, s.created_at)) AS freshestHuman,
       count(s) AS humanCount
  // keep only the decisions no human surface has caught up to
  WITH p, freshestHuman, humanCount,
       [d IN decisions WHERE freshestHuman IS NULL OR d.at > freshestHuman] AS undoc
  WHERE size(undoc) > 0
  RETURN p.name AS project,
         humanCount AS human_surfaces,
         (freshestHuman IS NULL) AS no_human_surface,
         CASE WHEN freshestHuman IS NULL THEN null ELSE toString(freshestHuman) END AS freshest_human,
         [d IN undoc | d.summary] AS undocumented_decisions,
         size(undoc) AS n
  ORDER BY no_human_surface DESC, n DESC, project`;

// Pure renderer — kept separate from the DB call so it's unit-testable.
export function formatReport(rows, params) {
  const out = [];
  out.push(`\n📝 Undocumented-decisions review — decisions from the last ${params.days}d not yet reflected in a human-readable surface${params.project ? ` · project=${params.project}` : ''}\n`);
  if (!rows.length) {
    out.push('No undocumented decisions. Every recent decision has a human-readable surface at least as fresh.\n');
    return out.join('\n');
  }
  out.push(`${rows.length} project(s) with decisions that live only in the graph — WRITE THEM UP (Notion Changelog/Decisions + CHANGELOG.md), then re-sync:\n`);
  for (const r of rows) {
    const where = r.no_human_surface
      ? 'NO human-readable surface exists yet'
      : `newest human surface predates these (last refreshed ${r.freshest_human})`;
    out.push(`▸ ${r.project}  — ${r.n} undocumented · ${where}`);
    for (const d of r.undocumented_decisions) out.push(`    • ${d}`);
  }
  out.push('\nThese are CANDIDATES — write the human-readable entry, then graph-sync. Nothing was changed.');
  out.push('A surface only clears a flag once it is ingested as a Source: CHANGELOG.md must sit inside a');
  out.push('document-sources.json root and out of excludeFiles (it ships ingested by default); Notion pages');
  out.push('clear it once re-read during graph-sync.\n');
  return out.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const params = {
    project: args.project && args.project !== true ? String(args.project) : null,
    days: args.days ? Number(args.days) : 14,
    kinds: HUMAN_SURFACES,
  };

  const driver = getDriver();
  let rows = [];
  try {
    const recs = await run(driver, CYPHER, params);
    rows = recs.map((r) => ({
      project: toPlain(r.get('project')),
      human_surfaces: toPlain(r.get('human_surfaces')),
      no_human_surface: toPlain(r.get('no_human_surface')),
      freshest_human: toPlain(r.get('freshest_human')),
      undocumented_decisions: toPlain(r.get('undocumented_decisions')),
      n: toPlain(r.get('n')),
    }));
  } finally {
    await driver.close();
  }

  if (args.json) { console.log(JSON.stringify({ params, candidates: rows }, null, 2)); return; }
  console.log(formatReport(rows, params));
}

// Run as a CLI only when invoked directly (so tests can import the exports).
if (process.argv[1] && process.argv[1].endsWith('review-undocumented-decisions.js')) {
  main().catch((err) => { console.error('review-undocumented-decisions error:', err.message); process.exit(1); });
}
