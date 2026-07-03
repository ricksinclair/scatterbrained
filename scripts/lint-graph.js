#!/usr/bin/env node
// Graph integrity check — the backstop that keeps the knowledge graph honest.
//
// Encodes the invariants from your agent instructions (e.g. a CLAUDE.md) as
// assertions, so "rules we hope the agent follows" become "rules the system checks."
//
// Usage:
//   node scripts/lint-graph.js            # human report, exits non-zero on ERRORs
//   node scripts/lint-graph.js --json     # machine-readable, for dashboards/CI
//   node scripts/lint-graph.js --quiet    # only print problems + summary
//
// Severity: ERROR fails the run (exit 1); WARN is reported but does not fail.
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';
import { SOURCE_KIND_LIST, FILE_BACKED_KINDS } from './lib/vocab.js';
import { IDENTITY_SIGNALS } from './lib/identity.js';
// Acceptance-criterion state vocabulary (unverified/pass/fail) — single source in the Studio lib.
import { CRITERION_STATES } from '../public/lib/criteria.js';

// Build the `likely-duplicate-entity` query: for every (label, identity-signal)
// pair, group nodes by that signal's value and flag any value shared by more
// than one distinct natural key. That's the semantic duplicate MERGE can't see —
// the same real entity under two different names (see scripts/lib/identity.js).
function buildLikelyDuplicateCypher() {
  const blocks = [];
  for (const [label, props] of Object.entries(IDENTITY_SIGNALS)) {
    for (const prop of props) {
      blocks.push(`
        MATCH (n:\`${label}\`)
        WHERE n.\`${prop}\` IS NOT NULL AND trim(toString(n.\`${prop}\`)) <> ''
        WITH n.\`${prop}\` AS sig,
             collect(DISTINCT coalesce(n.name, n.title, n.id)) AS keys
        WHERE size(keys) > 1
        RETURN ['${label}'] AS labels,
               '${prop}=' + toString(sig) + ' shared by: ' + keys[0] + ' / ' + keys[1]
               + CASE WHEN size(keys) > 2 THEN ' / +' + toString(size(keys) - 2) + ' more' ELSE '' END AS key`);
    }
  }
  // No identity signals configured anywhere -> a query that returns nothing.
  return blocks.length
    ? blocks.join('\n      UNION ALL\n')
    : `RETURN [] AS labels, '' AS key LIMIT 0`;
}

// Labels we expect to carry a created_at timestamp.
const DATED_LABELS = ['Insight', 'Idea', 'Project', 'Goal', 'Source', 'Rule', 'Skill', 'Person', 'Organization', 'Resource'];
// Nodes that are legitimately allowed to have no relationships.
const ORPHAN_WHITELIST = ['SyncState'];

// Each check returns { rows, severity, label, hint }.
const CHECKS = [
  {
    name: 'orphan-nodes',
    severity: 'ERROR',
    hint: 'Connect with >=1 edge or delete. Orphans are invisible to traversal queries.',
    cypher: `
      MATCH (n) WHERE NOT (n)--()
        AND NONE(l IN labels(n) WHERE l IN $whitelist)
      RETURN labels(n) AS labels,
             coalesce(n.name, n.title, n.id, '<unnamed>') AS key`,
  },
  {
    name: 'missing-created_at',
    severity: 'ERROR',
    hint: 'Backfill created_at; recency-ordered queries silently drop undated nodes.',
    cypher: `
      MATCH (n) WHERE ANY(l IN labels(n) WHERE l IN $dated)
        AND n.created_at IS NULL
      RETURN labels(n) AS labels,
             coalesce(n.name, n.title, n.id, '<unnamed>') AS key`,
  },
  {
    name: 'insight-without-about',
    severity: 'ERROR',
    hint: 'Every Insight must ABOUT a Project/Idea/Skill/Goal or it cannot be found by domain.',
    cypher: `
      MATCH (i:Insight) WHERE NOT (i)-[:ABOUT]->()
      RETURN labels(i) AS labels, i.summary AS key`,
  },
  {
    name: 'source-without-informs',
    severity: 'ERROR',
    hint: 'Every Source must INFORMS something (link-every-artifact rule).',
    cypher: `
      MATCH (s:Source) WHERE NOT (s)-[:INFORMS]->()
      RETURN labels(s) AS labels, coalesce(s.title, s.file_path, '<untitled>') AS key`,
  },
  {
    name: 'duplicate-natural-key',
    severity: 'WARN',
    hint: 'Two nodes share a natural key — likely a CREATE that should have been MERGE.',
    cypher: `
      MATCH (n) WHERE n.name IS NOT NULL
      WITH labels(n)[0] AS label, n.name AS key, count(*) AS c
      WHERE c > 1
      RETURN [label] AS labels, key + ' (x' + toString(c) + ')' AS key`,
  },
  {
    name: 'likely-duplicate-entity',
    severity: 'WARN',
    hint: 'Same-label nodes share an identity signal (repo_url/url/file_path/notion_id/contact_info) under different names — almost certainly the same entity created twice. Consolidate onto one node (move edges, DETACH DELETE the dupe) and add the other name to its `aliases`.',
    cypher: buildLikelyDuplicateCypher(),
  },
  {
    name: 'stale-source-informing-active',
    severity: 'WARN',
    hint: 'A retired/superseded Source still INFORMS active nodes — invalidate the edge or mark bi-temporally.',
    cypher: `
      MATCH (s:Source)-[r:INFORMS]->(t)
      WHERE (s.status = 'retired' OR s.status = 'stale' OR s.superseded_by IS NOT NULL)
        AND coalesce(t.status, 'active') <> 'retired'
        AND r.valid_until IS NULL   // bi-temporally invalidated edges are handled — skip them
      RETURN labels(s) AS labels,
             coalesce(s.title, s.file_path) + ' -> ' + coalesce(t.name, t.title, t.id) AS key`,
  },
  {
    name: 'rule-without-citation',
    severity: 'WARN',
    hint: 'Law Rule has no citation — legal reasoning on it is unverifiable.',
    cypher: `
      MATCH (r:Rule) WHERE r.citation IS NULL OR r.citation = ''
      RETURN labels(r) AS labels, r.name AS key`,
  },
  {
    name: 'source-kind-not-in-vocabulary',
    severity: 'ERROR',
    hint: 'source_kind is missing or outside the closed vocabulary in scripts/lib/vocab.js — normalize it or add the kind there. Off-vocabulary kinds silently split "all Notion pages"-style queries.',
    cypher: `
      MATCH (s:Source)
      WHERE s.source_kind IS NULL OR NOT s.source_kind IN $kinds
      RETURN labels(s) AS labels,
             coalesce(s.title, s.file_path, s.url, '<untitled>') + ' [' + coalesce(s.source_kind, '<null>') + ']' AS key`,
  },
  {
    name: 'file-source-missing-path',
    severity: 'WARN',
    hint: 'A document-lane Source has no file_path — it can only be reached by title. Backfill file_path so the file is locatable.',
    cypher: `
      MATCH (s:Source)
      WHERE s.source_kind IN $fileKinds AND s.file_path IS NULL
      RETURN labels(s) AS labels, coalesce(s.title, s.url, '<untitled>') AS key`,
  },
  {
    name: 'expired-fact-still-presented',
    severity: 'WARN',
    hint: 'Node has valid_until in the past — it is superseded and should not surface as current.',
    cypher: `
      MATCH (n) WHERE n.valid_until IS NOT NULL AND n.valid_until < datetime()
      RETURN labels(n) AS labels, coalesce(n.summary, n.name, n.title, n.id) AS key`,
  },
  {
    name: 'criterion-invalid',
    severity: 'ERROR',
    hint: 'An acceptance criterion (Note.anchor_kind=criterion) must be ABOUT a target node and carry a state from the closed set (unverified/pass/fail, public/lib/criteria.js). An orphan or off-vocab criterion can never gate a regression.',
    cypher: `
      MATCH (c:Note {anchor_kind: 'criterion'})
      WHERE NOT (c)-[:ABOUT]->() OR NOT coalesce(c.state, '') IN $criterionStates
      RETURN labels(c) AS labels, coalesce(left(c.text, 70), c.id, '<no-text>') AS key`,
  },
];

function fmt(labels, key) {
  const l = Array.isArray(labels) ? labels.join(':') : labels;
  const k = key == null ? '' : String(key);
  return `(${l}) ${k.length > 90 ? k.slice(0, 90) + '…' : k}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const driver = getDriver();
  const params = {
    whitelist: ORPHAN_WHITELIST,
    dated: DATED_LABELS,
    kinds: SOURCE_KIND_LIST,
    fileKinds: FILE_BACKED_KINDS,
    criterionStates: CRITERION_STATES,
  };
  const findings = [];

  try {
    for (const check of CHECKS) {
      const recs = await run(driver, check.cypher, params);
      const rows = recs.map((r) => ({ labels: toPlain(r.get('labels')), key: toPlain(r.get('key')) }));
      findings.push({ ...check, count: rows.length, rows });
    }
  } finally {
    await driver.close();
  }

  const errors = findings.filter((f) => f.severity === 'ERROR' && f.count > 0);
  const warns = findings.filter((f) => f.severity === 'WARN' && f.count > 0);

  if (args.json) {
    console.log(JSON.stringify({ findings, errorCount: errors.length, warnCount: warns.length }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  console.log('\n🔍 Graph integrity check\n');
  for (const f of findings) {
    if (args.quiet && f.count === 0) continue;
    const icon = f.count === 0 ? '✅' : f.severity === 'ERROR' ? '❌' : '⚠️ ';
    console.log(`${icon} ${f.name} — ${f.count} ${f.count === 1 ? 'finding' : 'findings'}`);
    if (f.count > 0) {
      console.log(`    ↳ ${f.hint}`);
      for (const row of f.rows.slice(0, 15)) console.log(`      • ${fmt(row.labels, row.key)}`);
      if (f.count > 15) console.log(`      … and ${f.count - 15} more`);
    }
  }

  console.log(`\n${errors.length ? '❌' : '✅'} ${errors.length} error-checks failing, ${warns.length} warnings.\n`);
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('lint-graph error:', err.message);
  process.exit(2);
});
