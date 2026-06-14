#!/usr/bin/env node
// Restore the graph from an export file produced by export-graph.js.
//
// Usage:
//   node scripts/import-graph.js --input backups/graph-2026-06-12.json
//   node scripts/import-graph.js --input backups/graph-2026-06-12.json --dry-run
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriver, run, parseArgs } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

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

const SAFE_LABEL = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_TYPE = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args['dry-run'];
  if (!args.input || args.input === true) {
    console.error('Error: --input <file> is required.');
    process.exit(1);
  }
  const inPath = path.resolve(ROOT, args.input);
  const data = JSON.parse(readFileSync(inPath, 'utf8'));
  const nodes = data.nodes || [];
  const relationships = data.relationships || [];

  console.log(`Import source: ${inPath}`);
  console.log(`Exported at:   ${data.exported_at || 'unknown'}`);
  console.log(`Nodes:         ${nodes.length}`);
  console.log(`Relationships: ${relationships.length}`);

  if (dryRun) {
    console.log('\n--- DRY RUN: nothing will be written ---');
    const counts = {};
    for (const n of nodes) counts[n.label] = (counts[n.label] || 0) + 1;
    console.log('Would merge nodes by label:');
    for (const [l, c] of Object.entries(counts).sort()) console.log(`  ${l}: ${c}`);
    const relCounts = {};
    for (const r of relationships) relCounts[r.type] = (relCounts[r.type] || 0) + 1;
    console.log('Would merge relationships by type:');
    for (const [t, c] of Object.entries(relCounts).sort()) console.log(`  ${t}: ${c}`);
    return;
  }

  const driver = getDriver();
  let nodesMerged = 0;
  let relsMerged = 0;
  const errors = [];

  try {
    // --- Nodes ---
    for (const node of nodes) {
      const label = node.label;
      const props = node.properties || {};
      const key = KEY_BY_LABEL[label];
      if (!SAFE_LABEL.test(label) || !key || props[key] === undefined) {
        errors.push(`Skipped node (bad label/key): ${label}`);
        continue;
      }
      try {
        await run(
          driver,
          `MERGE (n:${label} {${key}: $keyVal})
           SET n += $props`,
          { keyVal: props[key], props }
        );
        nodesMerged++;
        if (nodesMerged % 50 === 0) console.log(`  ...merged ${nodesMerged} nodes`);
      } catch (e) {
        errors.push(`Node ${label} ${props[key]}: ${e.message}`);
      }
    }
    console.log(`Nodes merged: ${nodesMerged}`);

    // --- Relationships ---
    for (const rel of relationships) {
      const { type, from_label, from_name, to_label, to_name, properties } = rel;
      const fromKey = KEY_BY_LABEL[from_label];
      const toKey = KEY_BY_LABEL[to_label];
      if (
        !SAFE_TYPE.test(type) ||
        !SAFE_LABEL.test(from_label) ||
        !SAFE_LABEL.test(to_label) ||
        !fromKey ||
        !toKey
      ) {
        errors.push(`Skipped rel (bad shape): ${from_label}-[${type}]->${to_label}`);
        continue;
      }
      try {
        await run(
          driver,
          `MATCH (a:${from_label} {${fromKey}: $fromName})
           MATCH (b:${to_label} {${toKey}: $toName})
           MERGE (a)-[r:${type}]->(b)
           SET r += $props`,
          { fromName: from_name, toName: to_name, props: properties || {} }
        );
        relsMerged++;
        if (relsMerged % 50 === 0) console.log(`  ...merged ${relsMerged} relationships`);
      } catch (e) {
        errors.push(`Rel ${from_name}-[${type}]->${to_name}: ${e.message}`);
      }
    }
    console.log(`Relationships merged: ${relsMerged}`);

    console.log('\n=== Import summary ===');
    console.log(`Nodes merged:         ${nodesMerged}`);
    console.log(`Relationships merged: ${relsMerged}`);
    console.log(`Errors:               ${errors.length}`);
    for (const e of errors) console.log(`  ! ${e}`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
