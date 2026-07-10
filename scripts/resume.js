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
import { execFileSync } from 'node:child_process';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';
import { fetchDigestRows } from './lib/digest-query.js';
import { groupDigest, relativeLabel } from '../public/lib/digest.js';
import { classifyStatus } from '../public/lib/roadmap.js';

function hoursSince(dt) {
  if (!dt) return null;
  const then = new Date(String(dt)).getTime();
  return Math.round((Date.now() - then) / 36e5);
}

// Parse "owner/repo" from a GitHub repo_url; null for non-GitHub or local paths.
function ghSlug(url) {
  if (!url) return null;
  const m = String(url).match(/github\.com[/:]([^/\s]+)\/([^/\s.]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Open issues + PRs for a repo via the gh CLI. Returns null if gh is missing
// or the repo is unreachable — resume must never fail on the GitHub lane.
function ghOpenWork(slug) {
  try {
    const issues = JSON.parse(
      execFileSync('gh', ['issue', 'list', '-R', slug, '--state', 'open', '--limit', '20', '--json', 'number,title'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    );
    const prs = JSON.parse(
      execFileSync('gh', ['pr', 'list', '-R', slug, '--state', 'open', '--limit', '20', '--json', 'number,title'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    );
    return { issues, prs };
  } catch {
    return null;
  }
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
    //    goals drift through 'open'/'in_progress'/'in progress' and an exact match
    //    silently hid them from the brief, so every goal you defined was invisible to
    //    the very loop goals exist to feed.
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
    // Nudge: a goal with no target_date never reaches the Due rail / digest. Surface
    // the gap here so defining the date has an obvious next step (Studio Schedule).
    if (undated.length) {
      console.log(`\n   ⏳ ${undated.length} goal${undated.length > 1 ? 's' : ''} with no target date` +
        ` — set one in the Studio (Inspector → Schedule) so it shows up due.`);
    }

    // 2.5 Due — the intention clock (#25 P3 push): overdue + this-week items, set via the
    //     Studio Schedule section. Best-effort; never fail the brief on the digest lane.
    try {
      const d = new Date();
      const nowISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dg = groupDigest(await fetchDigestRows(driver, { project }), nowISO);
      const near = [...dg.overdue, ...dg.today, ...dg.week];
      if (near.length) {
        console.log('\n⏰ Due (intention clock)');
        for (const it of near) {
          const verb = it.kind === 'review' ? 'review' : 'due';
          const name = it.name.length > 64 ? it.name.slice(0, 63) + '…' : it.name;
          console.log(`   • [${it.label}] ${name}  ·  ${verb} ${relativeLabel(it.date, nowISO)}`);
        }
        if (dg.soon.length) console.log(`   … +${dg.soon.length} more upcoming — \`npm run digest\``);
      }
    } catch { /* digest is best-effort */ }

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

    // 4.5 Notes awaiting curation — raw/cued notes jotted on nodes for a later pass to act on.
    //     Surfacing them here closes the loop (the Studio could write them but nothing read them).
    const notes = await run(
      driver,
      `MATCH (nt:Note)-[:ABOUT]->(n)
       WHERE nt.state IN ['raw','cued'] AND NOT (nt)-[:PART_OF]->(:Review)
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

    // 5. Open work — pending tasks the graph doesn't track (open GitHub issues/PRs).
    //    The graph is the source of truth for decisions, not a task tracker, so a clean
    //    working tree must not read as "nothing pending" — check GitHub before concluding.
    const repos = await run(
      driver,
      `MATCH (p:Project) WHERE p.repo_url IS NOT NULL
         AND coalesce(p.status,'active') IN ['active','in_progress']
         ${project ? 'AND toLower(p.name) CONTAINS toLower($project)' : ''}
       RETURN p.name AS name, p.repo_url AS repo ORDER BY p.name`,
      { project }
    );
    const openLines = [];
    for (const r of repos) {
      const slug = ghSlug(toPlain(r.get('repo')));
      if (!slug) continue;
      const work = ghOpenWork(slug);
      if (!work || (!work.issues.length && !work.prs.length)) continue;
      const name = toPlain(r.get('name'));
      for (const pr of work.prs) openLines.push(`   • [${name}] PR #${pr.number}: ${pr.title}`);
      for (const is of work.issues) openLines.push(`   • [${name}] #${is.number}: ${is.title}`);
    }
    if (openLines.length) {
      console.log('\n📌 Open work (GitHub)');
      for (const l of openLines) console.log(l);
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
