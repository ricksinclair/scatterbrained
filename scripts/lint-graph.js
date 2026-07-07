#!/usr/bin/env node
// Graph integrity check — the backstop that keeps the knowledge graph honest.
//
// Encodes the invariants from the global and per-project CLAUDE.md conventions as
// assertions, so "rules we hope the agent follows" become "rules the system checks."
//
// Usage:
//   node scripts/lint-graph.js            # human report, exits non-zero on ERRORs
//   node scripts/lint-graph.js --json     # machine-readable, for dashboards/CI
//   node scripts/lint-graph.js --quiet    # only print problems + summary
//
// Severity: ERROR fails the run (exit 1); WARN is reported but does not fail.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';
import { SOURCE_KIND_LIST, FILE_BACKED_KINDS, REL_TYPES, REL_TYPES_KNOWN, REL_SHAPE_LIST, RELSHAPE_EXEMPT_LABELS } from './lib/vocab.js';
import { IDENTITY_SIGNALS } from './lib/identity.js';
import { IDENTITY_LABELS as ALIAS_LABELS, NAME_FIELDS as ALIAS_NAME_FIELDS, brandRegexCypher } from './lib/aliases.js';
// Scatterbrained Studio's composable-UI annotation vocab (SPEC §10.7): render hints written
// onto graph nodes must reference a real component/view. Single source of truth.
import { COMPONENTS as UI_COMPONENTS } from '../scatterbrained-studio/public/lib/resolve.js';
import { VIEWS as UI_VIEWS } from '../scatterbrained-studio/public/lib/views.js';
// Acceptance-criterion state vocabulary (unverified/pass/fail) — single source in the Studio lib.
import { CRITERION_STATES } from '../scatterbrained-studio/public/lib/criteria.js';

// Repo root = the dir containing scripts/. Relative Source.file_paths are
// resolved against it, matching where this lint (and the indexer) run.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Canonicalize a Source.file_path so the SAME file recorded once as an absolute
// path and once as a repo-relative path (or with a leading ~) collapses to one
// identity. Cypher can't touch the filesystem, so this dedup must run in JS.
function canonPath(fp) {
  if (fp == null) return null;
  let p = String(fp).trim();
  if (!p) return null;
  if (p === '~' || p.startsWith('~/')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(REPO_ROOT, p); // absolute p is returned normalized; relative p is anchored to REPO_ROOT
}

// `duplicate-file-path-normalized` finding: Sources whose file_paths differ as
// written but point at the same real file. This is the abs-vs-relative-vs-~ gap
// that `likely-duplicate-entity` (exact-string group-by) structurally misses.
async function findDuplicateFilePaths(driver) {
  const recs = await run(driver,
    `MATCH (s:Source) WHERE s.file_path IS NOT NULL AND trim(s.file_path) <> ''
     RETURN coalesce(s.title, s.name, s.id) AS key, s.file_path AS fp`);
  const byCanon = new Map();
  for (const r of recs) {
    const canon = canonPath(toPlain(r.get('fp')));
    if (!canon) continue;
    let g = byCanon.get(canon);
    if (!g) byCanon.set(canon, (g = { keys: new Set(), raws: new Set() }));
    g.keys.add(toPlain(r.get('key')));
    g.raws.add(String(toPlain(r.get('fp'))).trim());
  }
  const rows = [];
  for (const [canon, g] of byCanon) {
    // Only flag when normalization did real work (>1 distinct raw path) AND the
    // file backs >1 distinct node — exact-string dupes stay with the generic check.
    if (g.keys.size > 1 && g.raws.size > 1) {
      const keys = [...g.keys];
      rows.push({
        labels: ['Source'],
        key: `${canon} shared by: ${keys[0]} / ${keys[1]}`
          + (keys.length > 2 ? ` / +${keys.length - 2} more` : ''),
      });
    }
  }
  return rows;
}

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
const DATED_LABELS = ['Insight', 'Idea', 'Project', 'Goal', 'Source', 'Rule', 'Skill', 'Person', 'Organization', 'Resource', 'Note', 'Review', 'ProtectedFact', 'Lens'];
// Nodes that are legitimately allowed to have no relationships.
// Review (Studio code review) is a legitimately standalone artifact: it's created
// when you open a repo@ref and may carry zero comments yet, so an empty one is not a bug.
// Lens (Studio saved live-query view) may be a global lens over the whole graph, ABOUT no single
// node — a legitimately standalone artifact like Review.
const ORPHAN_WHITELIST = ['SyncState', 'Review', 'Lens'];

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
    name: 'protected-fact-without-about',
    severity: 'ERROR',
    hint: 'Every ProtectedFact must be ABOUT a target node (the node whose detail it protects) — an orphan protected-fact guards nothing.',
    cypher: `
      MATCH (k:ProtectedFact) WHERE NOT (k)-[:ABOUT]->()
      RETURN labels(k) AS labels, coalesce(k.value, k.id, '<unvalued>') AS key`,
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
    name: 'duplicate-file-path-normalized',
    severity: 'WARN',
    hint: 'Two Sources point at the same file via differently-written paths (absolute vs repo-relative vs ~). Consolidate onto one node (move edges, DETACH DELETE the dupe). The exact-string case is caught by likely-duplicate-entity; this catches the path-form mismatch it misses.',
    fn: findDuplicateFilePaths,
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
    name: 'node-missing-natural-key',
    severity: 'ERROR',
    hint: "A node lacks its natural key (Insight.id, Source/Resource.title, or .name on the others). Backups key relationship endpoints by this value, so edges touching a keyless node serialize to a NULL endpoint and are silently dropped on restore. Backfill the key.",
    cypher: `
      MATCH (n)
      WHERE ((n:Insight OR n:Note OR n:Review OR n:ProtectedFact OR n:Lens) AND n.id IS NULL)
         OR ((n:Source OR n:Resource) AND n.title IS NULL)
         OR ((n:Person OR n:Organization OR n:Project OR n:Idea OR n:Rule OR n:Skill OR n:Goal) AND n.name IS NULL)
      RETURN labels(n) AS labels, coalesce(n.name, n.title, n.id, n.summary, '<no-key>') AS key`,
  },
  {
    name: 'retired-alias-drift',
    severity: 'WARN',
    hint: "A live-identity node is still NAMED for a retired brand/entity (registry: scripts/lib/aliases.js). The rename was incomplete, or a new node reintroduced the old name. Fix with `npm run rename:brand`. Historical prose (Insight/Source) and real identifiers (e.g. the published npm name engram-kg) are intentionally exempt — only name/title on identity labels is checked.",
    cypher: `
      MATCH (n) WHERE any(l IN labels(n) WHERE l IN $aliasLabels)
        AND any(k IN $aliasNameFields WHERE n[k] IS NOT NULL AND toString(n[k]) =~ $brandRe)
      RETURN labels(n) AS labels, coalesce(n.name, n.title, n.id, '<unnamed>') AS key`,
  },
  {
    name: 'relationship-type-not-in-vocabulary',
    severity: 'ERROR',
    hint: 'An edge uses a relationship type outside the known set in scripts/lib/vocab.js (canonical REL_TYPES ∪ grandfathered REL_TYPES_LEGACY). Migrate it to a canonical type, or — if it is genuinely needed — add it deliberately to the vocab + seed-schema. The Studio associate control only ever writes canonical types.',
    cypher: `
      MATCH ()-[r]->()
      WITH DISTINCT type(r) AS t
      WHERE NOT t IN $relKnown
      RETURN ['(rel)'] AS labels, t AS key`,
  },
  {
    name: 'relationship-shape-unexpected',
    severity: 'WARN',
    hint: 'A canonical-typed edge has an endpoint-label shape not in REL_SHAPES (scripts/lib/vocab.js) — often a backwards or mis-typed edge (e.g. a reversed USED_IN, or an Insight used as an INFORMS source). Re-point/retype it, or add the shape to the allowlist if it is legitimate. /api/relate already refuses to create new out-of-shape edges; this surfaces ones written outside it.',
    cypher: `
      MATCH (a)-[r]->(b)
      WITH type(r) AS t,
           [l IN labels(a) WHERE l <> 'Embeddable'][0] AS sa,
           [l IN labels(b) WHERE l <> 'Embeddable'][0] AS tb
      WHERE t IN $relCanonical AND NOT sa IN $relExempt AND NOT tb IN $relExempt
        AND NOT (t + '|' + sa + '>' + tb) IN $relShapes
      WITH t, sa, tb, count(*) AS c
      RETURN ['(rel)'] AS labels, t + ': ' + sa + ' -> ' + tb + ' ×' + toString(c) AS key`,
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
  {
    name: 'feature-without-acceptance',
    severity: 'WARN',
    hint: 'CLAUDE.md hard rule 6: behaviors must be expressed and validated as acceptance criteria. An Idea being worked (in_progress/implemented) since the policy date (2026-07-03) has NO criterion Notes ABOUT it — log 3-8 testable criteria (Studio inspector \u2192 Acceptance, or POST /api/note with anchor_kind=criterion). Pre-policy Ideas are grandfathered, mirroring REL_TYPES_LEGACY.',
    cypher: `
      MATCH (i:Idea)
      WHERE coalesce(i.status, '') IN ['in_progress', 'implemented']
        AND i.created_at >= datetime('2026-07-03T00:00:00Z')
        AND NOT (i)<-[:ABOUT]-(:Note {anchor_kind: 'criterion'})
      RETURN labels(i) AS labels, i.name AS key`,
  },
  {
    name: 'ui-hint-out-of-vocabulary',
    severity: 'ERROR',
    hint: 'A composable-UI render hint (render_hint / ui[] / ui:* tag) references a component or view outside the closed vocab (scatterbrained-studio/public/lib/resolve.js + views.js). Fix the hint or add the id to the vocab. Off-vocab hints are silently dropped at render time.',
    cypher: `
      MATCH (n)
      WHERE (n.render_hint IS NOT NULL AND NOT n.render_hint IN $uiComponents)
         OR any(u IN coalesce(n.ui, []) WHERE NOT u IN $uiComponents)
         OR any(t IN coalesce(n.tags, []) WHERE t STARTS WITH 'ui:' AND NOT (
              (size(split(t, ':')) = 2 AND split(t, ':')[1] IN $uiComponents)
              OR (size(split(t, ':')) = 3 AND split(t, ':')[1] IN $uiViews AND split(t, ':')[2] IN $uiComponents)
            ))
      RETURN labels(n) AS labels, coalesce(n.name, n.title, n.summary, n.id) AS key`,
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
    relKnown: REL_TYPES_KNOWN,
    relCanonical: REL_TYPES,
    relShapes: REL_SHAPE_LIST,
    relExempt: RELSHAPE_EXEMPT_LABELS,
    uiComponents: UI_COMPONENTS,
    uiViews: UI_VIEWS,
    criterionStates: CRITERION_STATES,
    aliasLabels: ALIAS_LABELS,
    aliasNameFields: ALIAS_NAME_FIELDS,
    brandRe: brandRegexCypher(),
  };
  const findings = [];

  try {
    for (const check of CHECKS) {
      const rows = check.fn
        ? await check.fn(driver, params)
        : (await run(driver, check.cypher, params)).map((r) => ({ labels: toPlain(r.get('labels')), key: toPlain(r.get('key')) }));
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
