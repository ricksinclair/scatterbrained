#!/usr/bin/env node
// ============================================================================
// new-project.js — stand up a whole project in one command: the graph AND the
// Notion side, set up together as one cohesive system.
//
// It:
//   1. creates the operational Notion workspace (Kanban + Documentation Index +
//      Changelog + Test Run Metrics + Problem Tests + status pages),
//   2. registers the project in the Neo4j graph (Project + Goal + a Source for
//      the workspace, wired with edges — MERGE, no orphans),
//   3. writes/updates notion-ids.json with the new IDs,
//   4. drops a repo CLAUDE.md wired to the conventions.
//
// Needs NOTION_TOKEN + NOTION_PARENT_PAGE_ID (see setup-notion.js header) and a
// reachable Neo4j (docker compose up). Use --dry-run to preview without writing.
//
// Usage:
//   node scripts/new-project.js --name "My Project" --goal "Ship v1"
//   node scripts/new-project.js --name "X" --domain "software" --modules "API,Web,Docs"
//   node scripts/new-project.js --name "X" --repo ~/Projects/x   # where CLAUDE.md goes
//   node scripts/new-project.js --name "X" --dry-run
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getDriver, run, parseArgs, splitList, toPlain } from './lib/db.js';
import { createWorkspace, manifestBlock } from './setup-notion.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const today = new Date().toISOString().slice(0, 10);

const GRAPH = `
  MERGE (p:Project {name:$name}) ON CREATE SET p.created_at = datetime()
  SET p.status='active', p.domain=$domain, p.description=$goal,
      p.repo_url=$repoUrl, p.notion_url=$workspaceUrl, p.tags=$tags
  MERGE (g:Goal {name:$goalName}) ON CREATE SET g.created_at = datetime()
  SET g.status='active', g.timeframe=$timeframe, g.description=$goal
  MERGE (g)-[:ACHIEVED_BY]->(p)
  MERGE (s:Source {title:$name + ' — Workspace'}) ON CREATE SET s.created_at = datetime()
  SET s.source_kind='notion_workspace', s.notion_id=$workspaceId, s.status='active',
      s.url=$workspaceUrl, s.last_synced_at=datetime(), s.tags=$tags
  MERGE (s)-[:INFORMS]->(p)
  RETURN p.name AS project, g.name AS goal`;

export function claudeMd(name, workspaceUrl, e) {
  const ds = (k) => (e[k] ? e[k].id : '<id>');
  return `# CLAUDE.md — ${name}

> Workspace created by Engram's new-project on ${today}. Graph + Notion, one system.

## Notion (source of truth for tasks/status)
> Canonical IDs live in notion-ids.json (validate with \`npm run check:notion\`). Mirror below.
- Workspace home: ${workspaceUrl || '<workspace-url>'}
- Development Tracker (Kanban): data_source_id \`${ds('Development Tracker')}\`
- Documentation Index: data_source_id \`${ds('Documentation Index')}\`
- Changelog: data_source_id \`${ds('Changelog')}\`
- Test Run Metrics: data_source_id \`${ds('Test Run Metrics')}\`
- Problem Tests: data_source_id \`${ds('Problem Tests')}\`

## Workflow
- Log tasks to the Kanban (Stage / Priority / Module / Type / Effort).
- Document in /docs AND the Documentation Index (keep both in sync).
- Log every change to CHANGELOG.md and the Changelog DB.
- Log test runs to Test Run Metrics; track flaky/failing in Problem Tests.

## Knowledge graph (Engram)
This project is a \`Project\` node in your Engram graph. Consult it before substantive work
(\`npm run context -- --project ${JSON.stringify(name)}\`, \`npm run search\`); capture decisions
as Insights; MERGE never CREATE; invalidate-don't-delete; run \`npm run lint:graph\` after writes.

## Git
Branch from main; conventional commits; PR before merge.
`;
}

export function mergeManifest(name, block, file = path.join(REPO_ROOT, 'notion-ids.json')) {
  let manifest = { projects: {} };
  if (fs.existsSync(file)) {
    try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* start fresh */ }
  }
  manifest.projects = manifest.projects || {};
  manifest.projects[name] = block.projects[name];
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run']);
  const name = args.name && args.name !== true ? String(args.name) : null;
  if (!name) { console.error('new-project: --name "<Project>" is required.'); process.exit(1); }
  const goal = args.goal && args.goal !== true ? String(args.goal) : `Ship ${name} v1.`;
  const domain = args.domain && args.domain !== true ? String(args.domain) : 'software';
  const modules = splitList(args.modules).length ? splitList(args.modules) : ['Backend', 'Frontend', 'Infrastructure', 'Docs'];
  const timeframe = args.timeframe && args.timeframe !== true ? String(args.timeframe) : '90_days';
  const repoUrl = args['repo-url'] && args['repo-url'] !== true ? String(args['repo-url']) : '';
  const repoDir = args.repo && args.repo !== true
    ? String(args.repo).replace(/^~(?=$|\/)/, os.homedir())
    : process.cwd();
  const tags = [name.toLowerCase().replace(/\s+/g, '-'), domain];

  if (!dryRun && (!process.env.NOTION_TOKEN || !process.env.NOTION_PARENT_PAGE_ID)) {
    console.error('new-project: set NOTION_TOKEN and NOTION_PARENT_PAGE_ID in .env (see setup-notion.js header), or pass --dry-run.');
    process.exit(2);
  }

  console.error(`\n▶ new-project: ${name}${dryRun ? '  (dry run)' : ''}\n`);

  // 1. Notion workspace.
  const { workspaceId, workspaceUrl, entries, dryPayloads } = await createWorkspace({ name, goal, modules, dryRun, log: (m) => console.error('  ' + m) });
  const block = manifestBlock(name, workspaceUrl, entries);

  // 2. Graph registration.
  let graphResult = '(skipped — dry run)';
  if (!dryRun) {
    const driver = getDriver();
    try {
      const recs = await run(driver, GRAPH, { name, domain, goal, repoUrl, workspaceUrl, workspaceId, tags, goalName: goal, timeframe });
      graphResult = recs.length ? `Project "${toPlain(recs[0].get('project'))}" + Goal registered` : 'no rows';
    } finally { await driver.close(); }
    console.error('  ✓ graph: ' + graphResult);
  }

  // 3. notion-ids.json + 4. repo CLAUDE.md.
  let manifestPath = '(dry run)';
  let claudePath = '(dry run)';
  if (!dryRun) {
    manifestPath = mergeManifest(name, block);
    const cm = path.join(repoDir, 'CLAUDE.md');
    if (fs.existsSync(cm) && !args.force) { claudePath = `${cm} (exists — left as-is; --force to overwrite)`; }
    else if (fs.existsSync(repoDir)) { fs.writeFileSync(cm, claudeMd(name, workspaceUrl, entries)); claudePath = cm; }
    else { claudePath = `(repo dir not found: ${repoDir})`; }
  }

  // 5. Report.
  if (dryRun) {
    for (const p of dryPayloads) console.log(`\n# would create ${p.label}\n` + JSON.stringify(p.body, null, 2));
    console.log('\n# DRY RUN — nothing created. notion-ids.json block would be:\n');
    console.log(JSON.stringify(block, null, 2));
  } else {
    console.error('\n─── done ───');
    console.error(`  Notion workspace: ${workspaceUrl}`);
    console.error(`  Graph:            ${graphResult}`);
    console.error(`  notion-ids.json:  ${manifestPath} (run \`npm run check:notion\`)`);
    console.error(`  repo CLAUDE.md:   ${claudePath}`);
  }
}

// Run as a CLI only when invoked directly (so tests can import the exports).
if (process.argv[1] && process.argv[1].endsWith('new-project.js')) {
  main().catch((err) => { console.error('new-project error:', err.message); process.exit(1); });
}
