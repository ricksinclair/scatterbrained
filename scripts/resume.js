#!/usr/bin/env node
// "Where were we?" — the shared cross-session re-entry brief.
//
// Prints a one-glance snapshot for the start of any session (human or agent):
// graph freshness, active goals + progress, newest insights, open threads
// (proposed ideas / blocked nodes), and any integrity warnings worth knowing.
//
// Usage:
//   node scripts/resume.js                  # full brief
//   node scripts/resume.js --project Acme # focus on one project
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

function hoursSince(dt) {
  if (!dt) return null;
  const then = new Date(String(dt)).getTime();
  return Math.round((Date.now() - then) / 36e5);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = args.project && args.project !== true ? args.project : null;
  const driver = getDriver();

  try {
    // 1. Freshness
    const sync = await run(driver, `MATCH (s:SyncState) RETURN s.last_full_sync AS t LIMIT 1`);
    const lastSync = toPlain(sync[0]?.get('t'));
    const age = hoursSince(lastSync);

    console.log('\n📋  RESUME BRIEF' + (project ? ` — ${project}` : '') + '\n' + '─'.repeat(48));
    console.log(
      `\n🕒 Graph last synced: ${lastSync ? `${lastSync} (${age}h ago)` : 'unknown'}` +
        (age != null && age > 24 ? '  ⚠️  stale — consider graph-sync' : '')
    );

    // 2. Active goals + the projects that achieve them
    const goals = await run(
      driver,
      `MATCH (g:Goal {status:'active'})
       OPTIONAL MATCH (g)-[:ACHIEVED_BY]->(p:Project)
       RETURN g.name AS goal, g.timeframe AS tf, collect(p.name) AS projects
       ORDER BY g.name`
    );
    console.log('\n🎯 Active goals');
    for (const r of goals) {
      const projects = toPlain(r.get('projects')).filter(Boolean);
      console.log(`   • ${toPlain(r.get('goal'))} [${toPlain(r.get('tf')) || '—'}]` +
        (projects.length ? `  ← ${projects.join(', ')}` : ''));
    }

    // 3. Newest insights (optionally project-scoped)
    const insights = await run(
      driver,
      `MATCH (i:Insight)
       ${project ? 'MATCH (i)-[:ABOUT]->(p:Project) WHERE toLower(p.name) CONTAINS toLower($project)' : ''}
       RETURN i.summary AS summary, i.created_at AS created
       ORDER BY i.created_at DESC LIMIT 8`,
      { project }
    );
    console.log('\n🆕 Newest insights');
    for (const r of insights) {
      const c = toPlain(r.get('created'));
      const day = c ? String(c).slice(0, 10) : '????-??-??';
      const s = toPlain(r.get('summary')) || '';
      console.log(`   • [${day}] ${s.length > 130 ? s.slice(0, 130) + '…' : s}`);
    }

    // 4. Open threads — proposed ideas + anything blocked
    const ideas = await run(
      driver,
      `MATCH (i:Idea) WHERE coalesce(i.status,'proposed') = 'proposed'
       ${project ? 'MATCH (:Project)-[:CONTAINS]->(i)' : ''}
       RETURN i.name AS name ORDER BY i.created_at DESC LIMIT 10`
    );
    if (ideas.length) {
      console.log('\n💡 Open ideas (proposed)');
      for (const r of ideas) console.log(`   • ${toPlain(r.get('name'))}`);
    }

    const blocked = await run(
      driver,
      `MATCH (a)-[:BLOCKED_BY]->(b)
       RETURN coalesce(a.name,a.title) AS a, coalesce(b.name,b.title) AS b`
    );
    if (blocked.length) {
      console.log('\n🚧 Blocked');
      for (const r of blocked) console.log(`   • ${toPlain(r.get('a'))} ← blocked by ${toPlain(r.get('b'))}`);
    }

    console.log('\n' + '─'.repeat(48));
    console.log('Tip: `npm run lint:graph` to check integrity · `npm run insight` to capture a new conclusion.\n');
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('resume error:', err.message);
  process.exit(1);
});
