#!/usr/bin/env node
// Quickly add any node type to the graph without writing Cypher.
// Uses MERGE on the node's natural key, so re-running updates in place.
//
// Usage:
//   node scripts/add-node.js person --name "Jane Doe" --role "cooperative attorney" \
//     --organization "Smith & Associates" --jurisdiction "NC" \
//     --contact "jane@smithlaw.com" --relationship "SME" --tags "legal,acme,nc"
//
//   node scripts/add-node.js idea --name "Inventory sync module" \
//     --description "Track quarterly revenue by region" \
//     --status "open_question" --domain "software" --tags "acme,governance"
//
//   node scripts/add-node.js resource --name "The Pragmatic Programmer" --type "book" \
//     --url "https://example.com" --summary "A classic guide to software craftsmanship" \
//     --tags "engineering,reference"
//
// Two cross-cutting flags on any type:
//   --aliases "a,b"  alternate names this entity is known by (searchable; helps
//                    dedup resolve a future session's different name to this node).
//   --force          skip the creation-time dedup guard (see probeDuplicates).
import { getDriver, run, parseArgs, splitList, toPlain } from './lib/db.js';
import { signalsFor, keysLookAlike } from './lib/identity.js';

// Creation-time dedup guard. Before MERGE, look for an existing same-label node
// that is probably the *same real entity* under a different natural key — either
// it shares an identity signal (repo_url/url/file_path/notion_id/contact_info)
// or its name/alias closely resembles the one we're about to create. Returns
// [{ key, reasons[] }]. MERGE only dedupes on an exact key, so this is the
// moment to catch "ulrictodman.com" vs "Personal Site (ulrictodman.com)".
async function probeDuplicates(driver, { label, keyProp, keyVal, signals }) {
  // 1) Identity-signal collision — precise: same signal value, different key.
  const signalEntries = Object.entries(signals);
  let signalHits = [];
  if (signalEntries.length) {
    const ors = signalEntries.map(([p]) => `n.\`${p}\` = $sig_${p}`).join(' OR ');
    const params = { keyVal };
    for (const [p, v] of signalEntries) params[`sig_${p}`] = v;
    const recs = await run(driver, `
      MATCH (n:\`${label}\`)
      WHERE coalesce(n.name, n.title, n.id) <> $keyVal AND (${ors})
      RETURN coalesce(n.name, n.title, n.id) AS key,
             [p IN $props WHERE n[p] IN $vals] AS matchedProps`,
      { ...params, props: signalEntries.map(([p]) => p), vals: signalEntries.map(([, v]) => v) });
    signalHits = recs.map((r) => ({
      key: toPlain(r.get('key')),
      reasons: (toPlain(r.get('matchedProps')) || []).map((p) => `same ${p}`),
    }));
  }

  // 2) Name / alias resemblance — fetch same-label keys + aliases, judge in JS
  //    (graphs are small; keysLookAlike is deliberately conservative).
  const nameRecs = await run(driver, `
    MATCH (n:\`${label}\`)
    WHERE coalesce(n.name, n.title, n.id) <> $keyVal
    RETURN coalesce(n.name, n.title, n.id) AS key, coalesce(n.aliases, []) AS aliases`,
    { keyVal });
  const nameHits = [];
  for (const r of nameRecs) {
    const key = toPlain(r.get('key'));
    const aliases = toPlain(r.get('aliases')) || [];
    const reasons = [];
    if (keysLookAlike(key, keyVal)) reasons.push(`name resembles "${key}"`);
    if (aliases.some((a) => keysLookAlike(a, keyVal))) reasons.push(`matches an alias of "${key}"`);
    if (reasons.length) nameHits.push({ key, reasons });
  }

  // Merge by key, unioning reasons.
  const byKey = new Map();
  for (const hit of [...signalHits, ...nameHits]) {
    const existing = byKey.get(hit.key);
    if (existing) existing.reasons = [...new Set([...existing.reasons, ...hit.reasons])];
    else byKey.set(hit.key, { key: hit.key, reasons: [...hit.reasons] });
  }
  return [...byKey.values()];
}

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
  const flagAliases = cfg.aliases || {};

  // Build the property map, applying flag aliases (e.g. --contact -> contact_info).
  const provided = {};
  for (const [flag, value] of Object.entries(args)) {
    if (flag === '_' || flag === 'tags' || flag === 'aliases' || flag === 'force') continue;
    const prop = flagAliases[flag] || flag;
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
  // `aliases` — alternate names this entity is known by, so a future search (and
  // the dedup guard) resolves them to this canonical node. List-valued like tags.
  const nodeAliases = splitList(args.aliases);

  const driver = getDriver();

  // Creation-time dedup guard (skip with --force). Identity signals are the
  // label's strong-identity props that were actually provided on this call.
  if (!args.force) {
    const signals = {};
    for (const p of signalsFor(cfg.label)) {
      if (provided[p] != null && String(provided[p]).trim() !== '') signals[p] = provided[p];
    }
    try {
      const dupes = await probeDuplicates(driver, { label: cfg.label, keyProp: cfg.key, keyVal, signals });
      if (dupes.length) {
        console.error(`\n⚠️  "${keyVal}" looks like it may already exist as a ${cfg.label}:`);
        for (const d of dupes) console.error(`     • "${d.key}"  (${d.reasons.join(', ')})`);
        console.error(`\n   If it's the SAME entity: consolidate onto the existing node instead of`);
        console.error(`   creating a parallel one — move any edges over, then add "${keyVal}" to its`);
        console.error(`   --aliases. If it's genuinely DIFFERENT, re-run with --force to proceed.\n`);
        await driver.close();
        process.exit(1);
      }
    } catch (err) {
      // A probe failure must never block a legitimate write — warn and continue.
      console.error(`(dedup guard skipped: ${err.message})`);
    }
  }

  // SET only the non-key props that were provided, plus tags + created_at.
  const setProps = cfg.props.filter((p) => p !== cfg.key && provided[p] !== undefined);
  const setClauses = setProps.map((p) => `n.${p} = $${p}`);
  setClauses.push('n.tags = $tags');
  if (nodeAliases.length) setClauses.push('n.aliases = $aliases');
  setClauses.push('n.created_at = coalesce(n.created_at, datetime())');

  const cypher = `
    MERGE (n:${cfg.label} {${cfg.key}: $keyVal})
    SET ${setClauses.join(', ')}
    RETURN n.${cfg.key} AS key
  `;
  const params = { keyVal, tags, aliases: nodeAliases };
  for (const p of setProps) params[p] = provided[p];

  try {
    const recs = await run(driver, cypher, params);
    const key = recs[0]?.get('key');
    const aliasNote = nodeAliases.length ? `  aliases: [${nodeAliases.join(', ')}]` : '';
    console.log(`✓ ${cfg.label} merged: "${key}"  tags: [${tags.join(', ')}]${aliasNote}`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
