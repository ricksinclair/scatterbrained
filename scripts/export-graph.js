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
  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath =
    args.output && args.output !== true
      ? path.resolve(ROOT, args.output)
      : path.resolve(ROOT, 'backups', `graph-${dateStr}.json`);

  const driver = getDriver();
  try {
    // --- Nodes ---
    const nodeRecs = await run(
      driver,
      `MATCH (n) RETURN labels(n) AS labels, properties(n) AS props`
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
              properties(r) AS props`
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
