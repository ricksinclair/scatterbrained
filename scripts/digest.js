#!/usr/bin/env node
// digest.js — the intention-clock PUSH (#25 P3). Surfaces what's due / overdue / to review /
// upcoming from the graph's intention dates (due_at / review_at / Goal.target_date), so the
// scheduler's dates find YOU out-of-app instead of waiting in the calendar.
//
// Usage:
//   node scripts/digest.js                 # human brief
//   node scripts/digest.js --json          # machine output (cron / automation)
//   node scripts/digest.js --project Acme
//
// Schedule the PUSH cadence (examples — NOT installed automatically; your ops call):
//   • cron (weekdays 8am):  0 8 * * 1-5  cd ~/Projects/scatterbrained && npm run -s digest
//   • Claude Code:          the `/schedule` skill, or it already prints inside `npm run resume`.
//
// Never throws / always exits 0 — a digest must not break a cron or a session start.
import { getDriver, parseArgs } from './lib/db.js';
import { fetchDigestRows } from './lib/digest-query.js';
import { groupDigest, relativeLabel, isEmptyDigest, BUCKET_ORDER, BUCKET_META }
  from '../public/lib/digest.js';

function isoToday() {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const asJson = !!args.json;
  const project = args.project && args.project !== true ? String(args.project) : null;
  const now = isoToday();

  let driver, rows;
  try {
    driver = getDriver();
    rows = await fetchDigestRows(driver, { project });
  } catch (e) {
    if (asJson) console.log(JSON.stringify({ ok: false, error: 'graph unreachable' }));
    else console.log('⏰ Digest — graph unreachable (is Neo4j up? `docker compose up -d`). Skipping.');
    return;
  } finally {
    if (driver) await driver.close().catch(() => {});
  }

  const g = groupDigest(rows, now);
  if (asJson) { console.log(JSON.stringify({ ok: true, now, project: project || null, ...g })); return; }

  console.log('\n⏰  DUE — the intention clock' + (project ? ` — ${project}` : '') + '\n' + '─'.repeat(40));
  if (isEmptyDigest(g)) { console.log('\n✓ Nothing due — all clear.\n'); return; }
  for (const b of BUCKET_ORDER) {
    const items = g[b];
    if (!items.length) continue;
    console.log(`\n${BUCKET_META[b].emoji} ${BUCKET_META[b].label}`);
    for (const it of items) {
      const verb = it.kind === 'review' ? 'review' : 'due';
      const name = it.name.length > 64 ? it.name.slice(0, 63) + '…' : it.name;
      console.log(`   • [${it.label}] ${name}  ·  ${verb} ${relativeLabel(it.date, now)}`);
    }
  }
  console.log('');
}

main().catch(() => { /* never break a cron / session start */ });
