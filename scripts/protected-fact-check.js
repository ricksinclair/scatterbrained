#!/usr/bin/env node
// protected-fact-check.js — the rewrite guard for protected key-facts (#23), as a CLI.
//
// Before a text rewrite overwrites a node (graph-sync, an LLM polish, the #21 demo
// cleanup, or a hand edit), run this against the PROPOSED new text. It loads the node's
// live ProtectedFacts and reports any that the rewrite would drop or alter — a "second brain
// that remembers" must HONOR its verified details, never silently lose them.
//
// Usage:
//   node scripts/protected-fact-check.js --node "<name|title|id>" --file new.md
//   node scripts/protected-fact-check.js --node "<…>" --text "the new prose…" [--record] [--json]
//
// --record  persists each casualty as a pending change (pending_status/pending_new) so it
//           surfaces in the Studio needs-review dock for approve/reject. Without it, this is
//           a read-only preview.
// --actor   who is rewriting (default "graph-sync"); --reason  why (free text).
//
// Exit code: 0 when every fact survives; 1 when any fact is dropped/altered (so a caller
// can gate on it: `node scripts/protected-fact-check.js … || echo "needs approval"`); 2 on error.
import fs from 'node:fs';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';
import { checkRewrite } from '../scatterbrained-studio/public/lib/protected-facts.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = args.node || args.id;
  if (!key) { console.error('usage: --node "<name|title|id>" (--file <path> | --text "…") [--record] [--actor X] [--reason Y] [--json]'); process.exit(2); }
  const text = args.file ? fs.readFileSync(String(args.file), 'utf8') : (args.text != null ? String(args.text) : null);
  if (text == null) { console.error('provide --file <path> or --text "…" (the proposed new text)'); process.exit(2); }

  const driver = getDriver();
  try {
    // Resolve the target by any natural handle, then collect its live ProtectedFacts.
    const recs = await run(driver,
      `MATCH (n) WHERE n.name = $k OR n.title = $k OR n.id = $k OR elementId(n) = $k
       WITH n LIMIT 1
       RETURN elementId(n) AS target, coalesce(n.name, n.title, n.id) AS name,
              [(kf:ProtectedFact)-[:ABOUT]->(n) WHERE kf.valid_until IS NULL
                 | { id: kf.id, value: kf.value, value_norm: kf.value_norm, kind: kf.kind }] AS facts`,
      { k: String(key) });
    if (!recs.length) { console.error(`no node matches "${key}"`); process.exit(2); }
    const { target, name, facts } = toPlain(recs[0].toObject());
    const { ok, violations } = checkRewrite(facts, text);

    if (args.record && violations.length) {
      for (const v of violations) {
        await run(driver,
          `MATCH (kf:ProtectedFact {id:$id})
           SET kf.pending_status=$status, kf.pending_new=$new, kf.pending_reason=$reason,
               kf.pending_actor=$actor, kf.pending_at=datetime()`,
          { id: v.id, status: v.status, new: v.suggestedNew,
            reason: args.reason ? String(args.reason) : 'rewrite', actor: args.actor ? String(args.actor) : 'graph-sync' });
      }
    }

    if (args.json) {
      console.log(JSON.stringify({ target, name, ok, recorded: !!(args.record && violations.length), violations }, null, 2));
    } else if (ok) {
      console.log(`✅ ${name}: all ${facts.length} protected fact(s) survive the rewrite.`);
    } else {
      console.log(`⚠️  ${name}: rewrite would change ${violations.length} protected fact(s):`);
      for (const v of violations) {
        console.log(`   • ${v.status.toUpperCase()} [${v.kind}] "${v.value}"${v.suggestedNew ? ` → "${v.suggestedNew}"` : ''}`);
      }
      console.log(args.record
        ? '   ↳ queued for approval — resolve in the Studio needs-review dock (or /api/protected-fact/resolve).'
        : '   ↳ re-run with --record to queue these for approve/reject (don’t silently overwrite).');
    }
    process.exit(ok ? 0 : 1);
  } finally {
    await driver.close();
  }
}

main().catch((err) => { console.error('protected-fact-check error:', err.message); process.exit(2); });
