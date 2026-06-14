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

  const driver = getDriver();
  try {
    // Create the Insight node.
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

    // ABOUT edges to Idea / Project (fuzzy, case-insensitive contains match).
    let aboutLinks = 0;
    for (const term of about) {
      const recs = await run(
        driver,
        `MATCH (i:Insight {id: $id})
         MATCH (n) WHERE (n:Idea OR n:Project)
           AND toLower(n.name) CONTAINS toLower($term)
         MERGE (i)-[:ABOUT]->(n)
         RETURN count(n) AS c`,
        { id, term }
      );
      aboutLinks += recs[0]?.get('c')?.toNumber?.() ?? 0;
    }

    // DERIVED_FROM edges to Source (and Rule) by title/name match.
    let sourceLinks = 0;
    for (const title of sources) {
      const recs = await run(
        driver,
        `MATCH (i:Insight {id: $id})
         MATCH (s) WHERE (s:Source AND toLower(s.title) CONTAINS toLower($title))
           OR (s:Rule AND toLower(s.name) CONTAINS toLower($title))
         MERGE (i)-[:DERIVED_FROM]->(s)
         RETURN count(s) AS c`,
        { id, title }
      );
      sourceLinks += recs[0]?.get('c')?.toNumber?.() ?? 0;
    }

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
