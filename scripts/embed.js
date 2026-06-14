#!/usr/bin/env node
// ============================================================================
// embed.js — backfill semantic embeddings onto knowledge nodes (the vector lane).
//
// For each text-bearing node it builds a representative string, embeds it with
// the local model (bge-small-en-v1.5, via scripts/lib/embedder.js — no API), and
// writes n.embedding (384-d) + n.embedding_hash + the :Embeddable label so the
// `knowledge_vec` vector index picks it up. Change-aware: a node whose text hash
// is unchanged is skipped, so re-runs are cheap. Needs the OPTIONAL dependency:
//   npm install @xenova/transformers
//
// Usage:
//   node scripts/embed.js                 # embed new/changed nodes
//   node scripts/embed.js --all           # re-embed everything (e.g. model change)
//   node scripts/embed.js --label Insight # restrict to one label
//   node scripts/embed.js --stats         # just report what would be embedded
// ============================================================================
import crypto from 'node:crypto';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';
import { embedderAvailable, embedTexts, EMBED_DIM } from './lib/embedder.js';

// Per-label: which properties compose the text we embed. Knowledge-rich labels
// only (entities like Skill/Person are short labels with little semantic body).
const TEXT_BY_LABEL = {
  Insight: ['summary', 'full_text'],
  Idea: ['name', 'description'],
  Rule: ['name', 'summary'],
  Project: ['name', 'description'],
  Goal: ['name', 'description'],
  Resource: ['title', 'summary'],
};

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const onlyLabel = args.label && args.label !== true ? String(args.label) : null;
  const labels = onlyLabel ? [onlyLabel] : Object.keys(TEXT_BY_LABEL);
  const forceAll = Boolean(args.all);

  if (!(await embedderAvailable())) {
    console.error('embed: the optional embedder is not installed. Run:\n  npm install @xenova/transformers');
    process.exit(2);
  }

  const driver = getDriver();
  try {
    // 1. Gather candidate nodes + their composed text + stored hash.
    const candidates = [];
    for (const label of labels) {
      const props = TEXT_BY_LABEL[label];
      if (!props) { console.error(`embed: no text mapping for label "${label}"`); continue; }
      const recs = await run(
        driver,
        `MATCH (n:${label})
         RETURN elementId(n) AS eid,
                trim(reduce(s='', p IN $props | s + ' ' + coalesce(toString(n[p]),''))) AS text,
                n.embedding_hash AS hash`,
        { props }
      );
      for (const r of recs) {
        const text = toPlain(r.get('text'));
        if (!text) continue;
        candidates.push({ eid: toPlain(r.get('eid')), label, text, hash: toPlain(r.get('hash')) });
      }
    }

    const todo = candidates.filter((c) => forceAll || c.hash !== sha(c.text));
    console.log(`embed: ${candidates.length} embeddable node(s) · ${todo.length} to (re)embed · ${candidates.length - todo.length} unchanged`);
    if (args.stats || todo.length === 0) { if (args.stats) console.log('(--stats: no writes)'); return; }

    // 2. Embed (batched inside embedTexts) and 3. write back.
    const vectors = await embedTexts(todo.map((c) => c.text));
    let written = 0;
    for (let i = 0; i < todo.length; i++) {
      const v = vectors[i];
      if (!v || v.length !== EMBED_DIM) continue;
      await run(
        driver,
        `MATCH (n) WHERE elementId(n) = $eid
         SET n.embedding = $vec, n.embedding_hash = $hash, n:Embeddable`,
        { eid: todo[i].eid, vec: v, hash: sha(todo[i].text) }
      );
      written++;
      if (written % 50 === 0) console.log(`  …${written}/${todo.length}`);
    }
    console.log(`embed: wrote ${written} embedding(s). Vector lane is live — try \`npm run search -- "<query>"\`.`);
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('embed error:', err.message);
  process.exit(1);
});
