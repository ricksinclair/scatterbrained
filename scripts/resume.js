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
import { classifyStatus } from '../public/lib/roadmap.js';

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

    // 2. Live goals + the projects that achieve them. Filter on classifyStatus (the
    //    same classifier the Studio uses) instead of an exact status:'active' match —
    //    goals drift through 'open'/'in_progress', and an exact match silently hid them
    //    from the brief, so every goal you defined was invisible to the very loop goals
    //    exist to feed.
    const goals = (await run(
      driver,
      `MATCH (g:Goal) WHERE g.valid_until IS NULL
       OPTIONAL MATCH (g)-[:ACHIEVED_BY]->(p:Project)
       RETURN g.name AS goal, g.status AS status, g.timeframe AS tf,
              toString(g.target_date) AS targetDate, collect(p.name) AS projects
       ORDER BY g.name`
    )).filter((r) => classifyStatus(toPlain(r.get('status'))) !== 'done');
    console.log('\n🎯 Live goals');
    const undated = [];
    for (const r of goals) {
      const goal = toPlain(r.get('goal'));
      const projects = toPlain(r.get('projects')).filter(Boolean);
      const date = toPlain(r.get('targetDate'));
      console.log(`   • ${goal} [${toPlain(r.get('tf')) || '—'}]` +
        (date ? `  ·  🎯 ${date}` : '') +
        (projects.length ? `  ← ${projects.join(', ')}` : ''));
      if (!date) undated.push(goal);
    }
    if (undated.length) {
      console.log(`\n   ⏳ ${undated.length} goal${undated.length > 1 ? 's' : ''} with no target date` +
        ` — set one in the Studio (Inspector → Schedule) so it shows up due.`);
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

    // Notes awaiting curation — raw/cued notes jotted on nodes for a later pass to act on.
    // Surfacing them here closes the loop (the Studio could write them but nothing read them).
    const notes = await run(
      driver,
      `MATCH (nt:Note)-[:ABOUT]->(n) WHERE nt.state IN ['raw','cued']
       RETURN nt.text AS text, nt.state AS state, coalesce(n.name,n.title,n.summary,n.id) AS anchor
       ORDER BY nt.created_at DESC LIMIT 12`
    );
    if (notes.length) {
      console.log('\n🗒️  Notes awaiting review');
      for (const r of notes) {
        const t = toPlain(r.get('text')) || '';
        console.log(`   • [${toPlain(r.get('state'))}] ${toPlain(r.get('anchor'))} — ${t.length > 70 ? t.slice(0, 69) + '…' : t}`);
      }
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
