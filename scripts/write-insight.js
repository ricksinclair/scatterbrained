#!/usr/bin/env node
// Write a new Insight node from stdin and link it into the graph.
//
// Usage:
//   echo "Claude suggested..." | node scripts/write-insight.js \
//     --session "2026-06-12-acme" \
//     --about "governance module,surplus distribution" \
//     --sources "Acme v2 — Architecture & Spec" \
//     --tags "acme,governance"
import { randomUUID } from 'node:crypto';
import { getDriver, run, parseArgs, splitList } from './lib/db.js';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fullText = (await readStdin()).trim();

  if (!fullText) {
    console.error('Error: no text piped to stdin. Pipe the insight text in.');
    process.exit(1);
  }

  const id = randomUUID();
  const summary = fullText.slice(0, 200);
  const session_id = args.session && args.session !== true ? args.session : '';
  const about = splitList(args.about);
  const sources = splitList(args.sources);
  const tags = splitList(args.tags);

  // Exact-first target resolution with a fuzzy fan-out cap. A bare substring match
  // once linked one Insight to all 37 Ideas containing a project's name (2026-07-09,
  // edge spam that had to be hand-trimmed) — so: exact name/title match wins outright;
  // fuzzy is a FALLBACK and refuses to write past the cap, listing the candidates so
  // the caller can name the ones they meant.
  const FANOUT_CAP = 5;
  async function resolveTargets(driver, term, { labels, keyExpr }) {
    const exact = await run(
      driver,
      `MATCH (n) WHERE (${labels}) AND toLower(${keyExpr}) = toLower($term)
       RETURN elementId(n) AS eid, ${keyExpr} AS key`,
      { term }
    );
    if (exact.length) return { rows: exact.map((r) => r.get('eid')) };
    const fuzzy = await run(
      driver,
      `MATCH (n) WHERE (${labels}) AND toLower(${keyExpr}) CONTAINS toLower($term)
       RETURN elementId(n) AS eid, ${keyExpr} AS key LIMIT ${FANOUT_CAP + 1}`,
      { term }
    );
    if (fuzzy.length > FANOUT_CAP) return { overflow: fuzzy.map((r) => r.get('key')) };
    return { rows: fuzzy.map((r) => r.get('eid')) };
  }

  const driver = getDriver();
  try {
    // Resolve EVERY target before writing anything — an over-broad term must not
    // leave a half-linked (or orphaned) Insight behind.
    const aboutEids = [];
    const sourceEids = [];
    const problems = [];
    for (const term of about) {
      const r = await resolveTargets(driver, term, { labels: 'n:Idea OR n:Project', keyExpr: 'n.name' });
      if (r.overflow) problems.push({ term, kind: 'about', candidates: r.overflow });
      else if (!r.rows.length) console.error(`  warning: --about "${term}" matched nothing (no edge)`);
      else aboutEids.push(...r.rows);
    }
    for (const title of sources) {
      const r = await resolveTargets(driver, title, { labels: 'n:Source OR n:Rule', keyExpr: 'coalesce(n.title, n.name)' });
      if (r.overflow) problems.push({ term: title, kind: 'sources', candidates: r.overflow });
      else if (!r.rows.length) console.error(`  warning: --sources "${title}" matched nothing (no edge)`);
      else sourceEids.push(...r.rows);
    }
    if (problems.length) {
      for (const p of problems) {
        console.error(`Error: --${p.kind} "${p.term}" is ambiguous — no exact match and more than ${FANOUT_CAP} fuzzy candidates:`);
        for (const c of p.candidates.slice(0, FANOUT_CAP + 1)) console.error(`    · ${c.length > 90 ? c.slice(0, 90) + '…' : c}`);
        console.error('  Name the exact node(s) you mean (comma-separated). Nothing was written.');
      }
      process.exit(1);
    }

    await run(
      driver,
      `MERGE (i:Insight {id: $id})
       SET i.summary = $summary,
           i.full_text = $full_text,
           i.session_id = $session_id,
           i.tags = $tags,
           i.created_at = coalesce(i.created_at, datetime())`,
      { id, summary, full_text: fullText, session_id, tags }
    );
    const link = (eids, rel) => run(
      driver,
      `MATCH (i:Insight {id: $id})
       UNWIND $eids AS eid
       MATCH (n) WHERE elementId(n) = eid
       MERGE (i)-[:${rel}]->(n)
       RETURN count(n) AS c`,
      { id, eids }
    );
    const aboutLinks = aboutEids.length ? Number((await link([...new Set(aboutEids)], 'ABOUT'))[0].get('c')) : 0;
    const sourceLinks = sourceEids.length ? Number((await link([...new Set(sourceEids)], 'DERIVED_FROM'))[0].get('c')) : 0;

    console.log(`Insight ${id} written: ${summary}...`);
    console.log(`  ABOUT links: ${aboutLinks}  DERIVED_FROM links: ${sourceLinks}  tags: [${tags.join(', ')}]`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
