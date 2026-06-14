#!/usr/bin/env node
// ============================================================================
// supersede.js — invalidate a node WITHOUT deleting it (bi-temporal rule).
//
// The protocol is "invalidate, don't delete": when a fact is superseded, set
// valid_until + superseded_by + invalidated_reason so history is kept and
// contradictions resolve by recency. Doing that by hand is fiddly Cypher, so it
// rarely happened — 77 insights, 0 ever invalidated. This makes it one command.
//
// Usage:
//   node scripts/supersede.js --old <id-or-name> --reason "why" [--by <id-or-name>]
//   node scripts/supersede.js --old <id> --by <newId> --reason "replaced by 90-day plan"
//
//   --old     natural key of the node being retired (Insight id/UUID, or any
//             node's name/title). Required.
//   --reason  free text: why it's superseded. Required (recorded verbatim).
//   --by      optional natural key of the node that replaces it; stored in
//             superseded_by so a reader can follow the chain.
//   --at      optional ISO timestamp for valid_until (default: now).
//   --dry     print what would change without writing.
//
// Sets on the old node: valid_until (datetime), invalidated_reason (text),
// superseded_by (the --by node's id/name, if given). Never deletes. After this,
// lint's `expired-fact-still-presented` will surface the node if anything still
// presents it as current, and recency-ordered reads skip it.
// ============================================================================
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

// Match a node by Insight id (UUID) OR by name/title, across the knowledge labels.
const MATCH_BY_KEY = `
  MATCH (n)
  WHERE (n.id = $key OR n.name = $key OR n.title = $key)
  RETURN n.id AS id, coalesce(n.name, n.title, n.id) AS label,
         labels(n) AS labels, n.valid_until AS valid_until`;

async function resolve(driver, key) {
  const recs = await run(driver, MATCH_BY_KEY, { key });
  return recs.map((r) => ({
    id: toPlain(r.get('id')),
    label: toPlain(r.get('label')),
    labels: toPlain(r.get('labels')),
    valid_until: toPlain(r.get('valid_until')),
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const oldKey = args.old;
  const reason = args.reason;
  const byKey = args.by && args.by !== true ? args.by : null;
  const at = args.at && args.at !== true ? args.at : null;

  if (!oldKey || oldKey === true || !reason || reason === true) {
    console.error('Usage: node scripts/supersede.js --old <id-or-name> --reason "why" [--by <id-or-name>] [--at <iso>] [--dry]');
    process.exit(1);
  }

  const driver = getDriver();
  try {
    const oldMatches = await resolve(driver, String(oldKey));
    if (oldMatches.length === 0) {
      console.error(`supersede: no node matches --old "${oldKey}".`);
      process.exit(1);
    }
    if (oldMatches.length > 1) {
      console.error(`supersede: --old "${oldKey}" is ambiguous (${oldMatches.length} matches). Use the UUID id.`);
      for (const m of oldMatches) console.error(`  • (${m.labels.join(':')}) ${m.label} [id=${m.id}]`);
      process.exit(1);
    }
    const old = oldMatches[0];

    let bySummary = null;
    if (byKey) {
      const byMatches = await resolve(driver, String(byKey));
      if (byMatches.length !== 1) {
        console.error(`supersede: --by "${byKey}" matched ${byMatches.length} nodes — must be exactly 1.`);
        process.exit(1);
      }
      bySummary = byMatches[0];
    }

    if (old.valid_until) {
      console.error(`supersede: (${old.labels.join(':')}) ${old.label} is already invalidated (valid_until=${old.valid_until}). Nothing to do.`);
      process.exit(0);
    }

    console.log(`\nSuperseding (${old.labels.join(':')}) ${old.label}`);
    console.log(`  reason: ${reason}`);
    if (bySummary) console.log(`  superseded_by: (${bySummary.labels.join(':')}) ${bySummary.label}`);
    console.log(`  valid_until: ${at || 'now'}`);

    if (args.dry) {
      console.log('\n(--dry) no write performed.\n');
      process.exit(0);
    }

    await run(
      driver,
      `MATCH (n) WHERE n.id = $id OR n.name = $key OR n.title = $key
       SET n.valid_until = ${at ? 'datetime($at)' : 'datetime()'},
           n.invalidated_reason = $reason,
           n.superseded_by = $by
       RETURN n.id AS id`,
      { id: old.id, key: old.label, reason: String(reason), by: bySummary ? bySummary.id || bySummary.label : null, ...(at ? { at } : {}) }
    );

    console.log('\n✅ Invalidated (not deleted). Run `npm run lint:graph` to confirm, then back up.\n');
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('supersede error:', err.message);
  process.exit(2);
});
