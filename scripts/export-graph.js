#!/usr/bin/env node
// Export the entire graph to a versioned JSON backup file.
//
// Usage:
//   node scripts/export-graph.js
//   node scripts/export-graph.js --output backups/my-backup.json
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Natural key per label, used to identify relationship endpoints by name.
const KEY_BY_LABEL = {
  Person: 'name',
  Organization: 'name',
  Project: 'name',
  Idea: 'name',
  Rule: 'name',
  Resource: 'title',
  Source: 'title',
  Insight: 'id',
  Skill: 'name',
  Goal: 'name',
  Note: 'id',
  Review: 'id',
  ProtectedFact: 'id',
};

function primaryLabel(labels) {
  // Prefer a known schema label if the node has several.
  for (const l of labels) if (KEY_BY_LABEL[l]) return l;
  return labels[0] || 'Unknown';
}

// Derived, regenerable properties excluded from backups (they bloat the snapshot
// and are reproduced from text by `npm run embed`). Restore, then re-embed.
const DERIVED_PROPS = ['embedding', 'embedding_hash'];
function stripDerived(props) {
  let stripped = false;
  for (const p of DERIVED_PROPS) if (p in props) { delete props[p]; stripped = true; }
  return stripped;
}

function keyValue(label, props) {
  const k = KEY_BY_LABEL[label] || 'name';
  return props[k];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Single, overwritten, git-versioned snapshot (NOT one file per day). git
  // already preserves history; dated files just duplicated that and bloated the
  // repo. Determinism (the ORDER BY below) keeps per-commit diffs small + readable.
  const outPath =
    args.output && args.output !== true
      ? path.resolve(ROOT, args.output)
      : path.resolve(ROOT, 'backups', 'graph.json');

  const driver = getDriver();
  try {
    // --- Nodes --- (ordered for stable, reviewable git diffs)
    const nodeRecs = await run(
      driver,
      `MATCH (n) RETURN labels(n) AS labels, properties(n) AS props
       ORDER BY head(labels(n)), coalesce(n.name, n.title, n.id, n.summary, '')`
    );
    const nodes = [];
    const nodeCounts = {};
    let embeddingsStripped = 0;
    for (const r of nodeRecs) {
      const labels = r.get('labels');
      const props = toPlain(r.get('props'));
      if (stripDerived(props)) embeddingsStripped++;
      const label = primaryLabel(labels);
      nodeCounts[label] = (nodeCounts[label] || 0) + 1;
      nodes.push({ label, properties: props });
    }

    // --- Relationships ---
    const relRecs = await run(
      driver,
      `MATCH (a)-[r]->(b)
       RETURN type(r) AS type,
              labels(a) AS from_labels, properties(a) AS from_props,
              labels(b) AS to_labels, properties(b) AS to_props,
              properties(r) AS props
       ORDER BY type(r), coalesce(a.name, a.title, a.id, ''), coalesce(b.name, b.title, b.id, '')`
    );
    const relationships = [];
    for (const r of relRecs) {
      const fromLabel = primaryLabel(r.get('from_labels'));
      const toLabel = primaryLabel(r.get('to_labels'));
      const fromProps = toPlain(r.get('from_props'));
      const toProps = toPlain(r.get('to_props'));
      relationships.push({
        type: r.get('type'),
        from_label: fromLabel,
        from_name: keyValue(fromLabel, fromProps),
        to_label: toLabel,
        to_name: keyValue(toLabel, toProps),
        properties: toPlain(r.get('props')),
      });
    }

    const payload = {
      exported_at: new Date().toISOString(),
      node_counts: nodeCounts,
      relationship_count: relationships.length,
      derived_excluded: DERIVED_PROPS, // regenerate after restore with `npm run embed`
      nodes,
      relationships,
    };

    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(payload, null, 2));

    // Integrity gate: a relationship whose endpoint serialized to null can't be
    // restored (import matches endpoints by natural key) — it would be silently
    // dropped. The backup is still written, but we FAIL LOUDLY so the cause (a
    // node missing its natural key) gets fixed instead of hiding in the JSON.
    const broken = relationships.filter((r) => r.from_name == null || r.to_name == null);
    if (broken.length) {
      console.error(`\n❌ ${broken.length} relationship(s) have a NULL endpoint — they will NOT restore.`);
      console.error('   Cause: an endpoint node is missing its natural key. Fix with `npm run lint:graph` (node-missing-natural-key).');
      for (const r of broken.slice(0, 8)) {
        console.error(`     • ${r.type}: (${r.from_label}) ${r.from_name ?? '<NULL>'} -> (${r.to_label}) ${r.to_name ?? '<NULL>'}`);
      }
      if (broken.length > 8) console.error(`     … and ${broken.length - 8} more`);
      process.exitCode = 1; // signal the integrity failure; the file is still written
    }

    console.log('Graph export complete.');
    console.log('Node counts by label:');
    for (const [label, count] of Object.entries(nodeCounts).sort()) {
      console.log(`  ${label}: ${count}`);
    }
    console.log(`Total nodes: ${nodes.length}`);
    console.log(`Total relationships: ${relationships.length}`);
    if (embeddingsStripped) console.log(`Excluded derived embeddings from ${embeddingsStripped} node(s) — regenerate with \`npm run embed\`.`);
    console.log(`Output: ${outPath}`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
