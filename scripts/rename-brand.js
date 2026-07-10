#!/usr/bin/env node
// ============================================================================
// rename-brand.js — complete, fan-out rename of a retired brand/entity name.
//
// The Engram→Scatterbrained drift happened because a rename is a FAN-OUT (the
// name is denormalized into many nodes' name/description/tags), but it was done
// as a single manual edit on one attribute of one node. This makes the fan-out
// one command — and, crucially, knows what to LEAVE ALONE: identifiers that
// merely contain the token (e.g. the published npm name engram-kg) and the
// history/key fields where the old name is faithful (former_name, id, …).
//
// Scope by default = LIVE IDENTITY only (see lib/aliases.js IDENTITY_LABELS):
// the current product + roadmap nodes. Insight/Source prose that NARRATES the
// old era is deliberately untouched. Pass --include <key>,… to additionally
// rename specific Insight/Source nodes that describe the live product.
//
// Usage:
//   node scripts/rename-brand.js                       # dry-run, all retired aliases
//   node scripts/rename-brand.js --include a,b         # also rename nodes named a,b
//   node scripts/rename-brand.js --apply               # write
//
// On each changed node: rewrite brand words in identity fields, carry the old
// name into former_name, stamp renamed_at, and add a `renamed` tag. Idempotent
// (re-running finds nothing) and dry by default. Back up + lint:graph after.
// ============================================================================
import { getDriver, run, parseArgs, toPlain, splitList } from './lib/db.js';
import {
  IDENTITY_LABELS,
  NAME_FIELDS,
  REWRITE_FIELDS,
  ALLOWED_FIELDS,
  brandRegexCypher,
  rewriteBrand,
} from './lib/aliases.js';

// Fields rewritten on an explicitly --include'd node (e.g. an Insight that
// describes the live product, not the old era). Broader than IDENTITY_FIELDS.
const INCLUDE_FIELDS = ['name', 'title', 'summary', 'full_text', 'description', 'tags'];

// Compute the rewritten value for each field that actually changes.
function computeChanges(props, fields) {
  const changes = {};
  for (const k of fields) {
    if (ALLOWED_FIELDS.has(k)) continue;
    const v = props[k];
    if (v == null) continue;
    if (Array.isArray(v)) {
      const nv = v.map((x) => (typeof x === 'string' ? rewriteBrand(x) : x));
      if (JSON.stringify(nv) !== JSON.stringify(v)) changes[k] = nv;
    } else if (typeof v === 'string') {
      const nv = rewriteBrand(v);
      if (nv !== v) changes[k] = nv;
    }
  }
  return changes;
}

async function readProps(driver, eid) {
  const recs = await run(driver, `MATCH (n) WHERE elementId(n) = $eid RETURN properties(n) AS p, labels(n) AS labels`, { eid });
  if (!recs.length) return null;
  return { props: toPlain(recs[0].get('p')), labels: toPlain(recs[0].get('labels')) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = !!args.apply;
  const includeKeys = splitList(args.include);
  const re = brandRegexCypher();
  const driver = getDriver();

  try {
    // 1) Auto-discover live-identity drift: identity-label nodes whose NAME/title
    //    still carries the old brand (i.e. the thing is still CALLED that). A node
    //    already renamed (canonical name, only historical mentions in its prose)
    //    is intentionally left alone.
    const idRecs = await run(
      driver,
      `MATCH (n) WHERE any(l IN labels(n) WHERE l IN $labels)
         AND any(k IN $fields WHERE n[k] IS NOT NULL AND toString(n[k]) =~ $re)
       RETURN elementId(n) AS eid`,
      { labels: IDENTITY_LABELS, fields: NAME_FIELDS, re }
    );
    const targets = new Map(); // eid -> field set
    for (const r of idRecs) targets.set(toPlain(r.get('eid')), REWRITE_FIELDS);

    // 2) Explicit --include nodes (Insight/Source describing the live product).
    for (const key of includeKeys) {
      const recs = await run(
        driver,
        `MATCH (n) WHERE n.name = $key OR n.id = $key OR n.title = $key RETURN elementId(n) AS eid`,
        { key }
      );
      if (!recs.length) { console.error(`  ⚠️  --include "${key}" matched no node`); continue; }
      for (const r of recs) {
        const eid = toPlain(r.get('eid'));
        targets.set(eid, [...new Set([...(targets.get(eid) || []), ...INCLUDE_FIELDS])]);
      }
    }

    if (targets.size === 0) {
      console.log('\n✅ rename-brand: no live-identity drift found. Nothing to do.\n');
      process.exit(0);
    }

    console.log(`\n🔁 rename-brand — ${targets.size} node(s) with brand drift${apply ? '' : '  (dry-run; pass --apply to write)'}\n`);

    let written = 0;
    for (const [eid, fields] of targets) {
      const node = await readProps(driver, eid);
      if (!node) continue;
      const { props, labels } = node;
      const changes = computeChanges(props, fields);
      if (Object.keys(changes).length === 0) continue;

      const oldName = props.name || props.title || null;
      const nameChanged = 'name' in changes || 'title' in changes;

      // Tag bookkeeping: ensure a `renamed` marker when identity changed.
      if (nameChanged) {
        const base = Array.isArray(changes.tags) ? changes.tags : (Array.isArray(props.tags) ? props.tags.map((x) => (typeof x === 'string' ? rewriteBrand(x) : x)) : []);
        changes.tags = [...new Set([...base, 'renamed'])];
      }

      console.log(`(${labels.join(':')}) ${oldName}`);
      for (const [k, v] of Object.entries(changes)) {
        const show = Array.isArray(v) ? `[${v.join(', ')}]` : v;
        const shown = String(show).length > 120 ? String(show).slice(0, 120) + '…' : show;
        console.log(`   · ${k} → ${shown}`);
      }
      if (nameChanged) console.log(`   · former_name ← ${oldName}   · renamed_at ← now`);

      if (apply) {
        const setParts = ['n += $vals'];
        const params = { eid, vals: changes };
        if (nameChanged) {
          setParts.push('n.former_name = coalesce(n.former_name, $oldName)');
          setParts.push('n.renamed_at = coalesce(n.renamed_at, datetime())');
          params.oldName = oldName;
        }
        await run(driver, `MATCH (n) WHERE elementId(n) = $eid SET ${setParts.join(', ')}`, params);
        written++;
      }
      console.log('');
    }

    if (apply) console.log(`✅ Rewrote ${written} node(s). Run \`npm run lint:graph\` to confirm 0 drift, then back up.\n`);
    else console.log(`(dry-run) ${targets.size} node(s) would change. Re-run with --apply to write.\n`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('rename-brand error:', err.message);
  process.exit(2);
});
