#!/usr/bin/env node
// Quickly add any node type to the graph without writing Cypher.
// Uses MERGE on the node's natural key, so re-running updates in place.
//
// Usage:
//   node scripts/add-node.js person --name "Jane Doe" --role "cooperative attorney" \
//     --organization "Smith & Associates" --jurisdiction "NC" \
//     --contact "jane@smithlaw.com" --relationship "SME" --tags "legal,acme,nc"
//
//   node scripts/add-node.js idea --name "fair-use tracking module" \
//     --description "Track member fair-use for Subchapter T distributions" \
//     --status "open_question" --domain "software" --tags "acme,governance"
//
//   node scripts/add-node.js resource --name "Open Organization Toolbox" --type "book" \
//     --url "https://example.com" --summary "Guide to worker co-op formation" \
//     --tags "cooperative,legal"
import { getDriver, run, parseArgs, splitList } from './lib/db.js';

const TYPES = {
  person: {
    label: 'Person',
    key: 'name',
    props: ['name', 'role', 'organization', 'jurisdiction', 'contact_info', 'relationship_to_owner'],
    aliases: { contact: 'contact_info', relationship: 'relationship_to_owner' },
  },
  organization: {
    label: 'Organization',
    key: 'name',
    props: ['name', 'type', 'jurisdiction', 'url', 'purpose'],
  },
  project: {
    label: 'Project',
    key: 'name',
    props: ['name', 'status', 'domain', 'description', 'repo_url', 'notion_url'],
    aliases: { repo: 'repo_url', notion: 'notion_url' },
  },
  idea: {
    label: 'Idea',
    key: 'name',
    props: ['name', 'description', 'status', 'domain'],
  },
  rule: {
    label: 'Rule',
    key: 'name',
    props: ['name', 'type', 'jurisdiction', 'citation', 'summary', 'confidence'],
  },
  resource: {
    label: 'Resource',
    key: 'title',
    props: ['title', 'type', 'url', 'summary'],
    aliases: { name: 'title' },
  },
  source: {
    label: 'Source',
    key: 'title',
    props: ['title', 'type', 'url', 'notion_id'],
    aliases: { name: 'title' },
  },
  insight: {
    label: 'Insight',
    key: 'id',
    props: ['id', 'summary', 'full_text', 'session_id'],
  },
  skill: {
    label: 'Skill',
    key: 'name',
    props: ['name', 'category', 'proficiency'],
  },
  goal: {
    label: 'Goal',
    key: 'name',
    props: ['name', 'timeframe', 'status', 'description'],
  },
};

async function main() {
  const argv = process.argv.slice(2);
  const type = argv[0];
  const cfg = TYPES[type];
  if (!cfg) {
    console.error(`Unknown node type "${type || ''}".`);
    console.error(`Supported types: ${Object.keys(TYPES).join(', ')}`);
    process.exit(1);
  }

  const args = parseArgs(argv.slice(1));
  const aliases = cfg.aliases || {};

  // Build the property map, applying aliases (e.g. --contact -> contact_info).
  const provided = {};
  for (const [flag, value] of Object.entries(args)) {
    if (flag === '_' || flag === 'tags') continue;
    const prop = aliases[flag] || flag;
    if (cfg.props.includes(prop)) {
      provided[prop] = value === true ? '' : value;
    }
  }

  const keyVal = provided[cfg.key];
  if (!keyVal) {
    console.error(`Error: ${type} requires --${cfg.key === 'title' ? 'name|title' : cfg.key}.`);
    process.exit(1);
  }

  const tags = splitList(args.tags);

  // SET only the non-key props that were provided, plus tags + created_at.
  const setProps = cfg.props.filter((p) => p !== cfg.key && provided[p] !== undefined);
  const setClauses = setProps.map((p) => `n.${p} = $${p}`);
  setClauses.push('n.tags = $tags');
  setClauses.push('n.created_at = coalesce(n.created_at, datetime())');

  const cypher = `
    MERGE (n:${cfg.label} {${cfg.key}: $keyVal})
    SET ${setClauses.join(', ')}
    RETURN n.${cfg.key} AS key
  `;
  const params = { keyVal, tags };
  for (const p of setProps) params[p] = provided[p];

  const driver = getDriver();
  try {
    const recs = await run(driver, cypher, params);
    const key = recs[0]?.get('key');
    console.log(`✓ ${cfg.label} merged: "${key}"  tags: [${tags.join(', ')}]`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
