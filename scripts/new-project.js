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
  // List only the databases that were actually scaffolded (Problem Tests is opt-in),
  // driven off the real entries so the mirror never invents an id.
  const dbLine = (k) => (e[k] ? `- ${k}: data_source_id \`${e[k].id}\`` : null);
  const dbLines = ['Changelog', 'Documentation Index', 'Development Tracker', 'Test Run Metrics', 'Problem Tests']
    .map(dbLine).filter(Boolean).join('\n');
  return `# CLAUDE.md — ${name}

> Workspace created by Scatterbrained's new-project on ${today}. Graph + Notion, one system.

## Notion data sources (human digests for stakeholders)
> Canonical IDs live in notion-ids.json (validate with \`npm run check:notion\`). Mirror below.
- Workspace home: ${workspaceUrl || '<workspace-url>'}
${dbLines}

## Working rhythm — where each thing actually lives
The day-to-day **sources of truth** are your **code + git/GitHub** (issues/PRs) and the **Scatterbrained
graph** (decisions + recall). The Notion databases are **plain-language digests for non-technical
stakeholders, written at milestones** — not live mirrors you hand-maintain. Don't log every change
or every test run by hand; that rots. Write at milestones and let the graph + GitHub carry the rest:
- **Changelog** — the flagship. On each release, post the version's plain-English TL;DR (one row).
  \`npm run writeback -- --project ${JSON.stringify(name)}\` drafts it from the graph; \`--commit\` posts it.
- **Documentation Index** — link durable docs as you write them; keep Status honest.
- **Development Tracker** — optional; GitHub issues are the real tracker. Keep this only if a
  non-technical stakeholder is actually reading a Notion-native board.
- **Test Run Metrics** — a milestone *health* snapshot (latest pass rate / last green / version) on
  release or CI-on-main, not a row per local run.
- **Problem Tests** — opt-in (\`--with-problem-tests\`); only if a team is tracking flaky/failing tests.

## Acceptance criteria — behaviors MUST be expressed and validated
When you design or build a feature, log **3–8 testable acceptance criteria in the graph at
design time** — criterion Notes (\`anchor_kind: 'criterion'\`) \`ABOUT\` the feature's Idea
(Studio inspector → *Acceptance*, the ⌘K *Add acceptance criterion* command, or
\`POST /api/note\`). A behavior that isn't expressed as a criterion doesn't exist for QA.
Each criterion maps to ≥1 durable test where feasible; validate only via explicit
verification events (\`POST /api/criterion/verify\` — your test runner can post results).
QA reads the criteria back and reports **PASS/FAIL per criterion**; regressed or stale
criteria surface in the Studio's needs-review dock. **No criteria = not done.**

## Knowledge graph (Scatterbrained) — primary source of truth for recall
This project is a \`Project\` node in your Scatterbrained graph. **Query the graph FIRST** for any question
about work done, decisions made, or *why* something is the way it is — before answering from memory
or searching elsewhere (\`npm run resume\`, \`npm run context -- --project ${JSON.stringify(name)}\`,
\`npm run search\`). Treat **Notion as the secondary lane**: follow the \`Source\` references the graph
surfaces rather than searching it blind. Capture **decisions** as Insights — the test is
*"would a future session want to follow this rule or rationale?"* (a *policy* is a decision
even when the action that surfaced it is mundane housekeeping; a one-off mechanical act or
status update is not). **Dual-write every decision:** an Insight alone is machine-only — also
record it in a *human-readable* surface (the Notion **Changelog**/**Decisions** page and
\`CHANGELOG.md\`) so a person browsing Notion sees the *why*, not just a Cypher query. The graph
is canonical; the human window must not rot behind it. \`npm run review:decisions\` flags decisions
that landed in the graph but no human surface — write those up, then re-sync. (For \`CHANGELOG.md\`
to clear a flag it must be ingested as a \`Source\`: keep it inside a \`document-sources.json\` root
and out of \`excludeFiles\` — it ships ingested by default.) MERGE never CREATE;
invalidate-don't-delete; run \`npm run lint:graph\` after writes; sync the graph at the end of each
completed unit of work. **A "sync" is the full pass** — re-ingest changed docs
(\`npm run doc-index -- --stats\`), MERGE a \`Source\` for *every* new/updated artifact (incl. ones
the indexer can't see, like \`.html\`), then \`lint:graph\` to **0 errors before** backing up. Don't
call it synced until the change-gate is clean.

> **Enforced, not just asked:** \`.claude/\` ships two hooks that re-inject this graph-first
> rule each turn so it isn't relied on from memory — \`SessionStart\` (full rule, once) and a
> terse \`UserPromptSubmit\` nudge (~40 tokens/turn). Review or disable them via \`/hooks\`.

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

// ── Agent config: make "consult the graph first" a mechanism, not a hope. ──
// A CLAUDE.md instruction is read once and buried; these Claude Code hooks
// re-inject the rule deterministically. SessionStart carries the full rule
// (paid once); UserPromptSubmit carries a terse keyword+action nudge (paid
// every turn, so kept ~40 tokens — rationale stays in the once-per-session block).
function hookScript(eventName, additionalContext) {
  const payload = { hookSpecificOutput: { hookEventName: eventName, additionalContext } };
  if (eventName === 'UserPromptSubmit') payload.suppressOutput = true; // don't echo every turn
  return `#!/bin/sh
# Scatterbrained graph-first hook (${eventName}) — generated by new-project. Edit the text
# below to taste; keep it valid JSON on one line. See CLAUDE.md for the rule.
cat <<'EOF'
${JSON.stringify(payload)}
EOF
`;
}

export function agentConfigFiles(name) {
  const sessionText =
    `[Scatterbrained graph-first rule — project: ${name}] The Scatterbrained knowledge graph is the PRIMARY ` +
    `source of truth for recall. For ANY question about this project's work, decisions, rationale, ` +
    `history, or status, consult the graph FIRST and unprompted — before repo files or the web. ` +
    `Use \`npm run resume\`, \`npm run context\`, or \`npm run search\`, or query Neo4j directly via ` +
    `the neo4j MCP (read_neo4j_cypher). Notion is the secondary lane (follow the Source refs the ` +
    `graph surfaces). Skip only for trivial mechanical edits or general knowledge unrelated to this project.`;
  const promptText =
    `[graph-first] This project's work/decisions/rationale/history/status → consult the Scatterbrained ` +
    `graph FIRST (npm run resume / search, or neo4j MCP), before repo/web.`;
  const cmd = (f) => `sh "$CLAUDE_PROJECT_DIR/.claude/hooks/${f}"`;
  const settings = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: cmd('scatterbrained-graph-first-session.sh'), timeout: 5, statusMessage: 'Loading Scatterbrained graph-first rule' }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd('scatterbrained-graph-first-prompt.sh'), timeout: 5 }] }],
    },
  };
  return { settings, sessionHook: hookScript('SessionStart', sessionText), promptHook: hookScript('UserPromptSubmit', promptText) };
}

// Merge our hook entries into an existing settings object idempotently — never
// clobber a user's other settings or double-add our own command on a rerun.
export function mergeSettings(existing, additions) {
  const out = existing && typeof existing === 'object' ? existing : {};
  out.hooks = out.hooks && typeof out.hooks === 'object' ? out.hooks : {};
  for (const [event, entries] of Object.entries(additions.hooks)) {
    const cur = Array.isArray(out.hooks[event]) ? out.hooks[event] : [];
    const seen = new Set(cur.flatMap((g) => (g.hooks || []).map((h) => h.command)));
    for (const entry of entries) {
      if (!(entry.hooks || []).some((h) => seen.has(h.command))) cur.push(entry);
    }
    out.hooks[event] = cur;
  }
  return out;
}

export function writeAgentConfig(repoDir, name) {
  const hooksDir = path.join(repoDir, '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const { settings, sessionHook, promptHook } = agentConfigFiles(name);
  fs.writeFileSync(path.join(hooksDir, 'scatterbrained-graph-first-session.sh'), sessionHook);
  fs.writeFileSync(path.join(hooksDir, 'scatterbrained-graph-first-prompt.sh'), promptHook);
  const settingsPath = path.join(repoDir, '.claude', 'settings.json');
  let existing = null;
  if (fs.existsSync(settingsPath)) { try { existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { existing = null; } }
  fs.writeFileSync(settingsPath, JSON.stringify(mergeSettings(existing, settings), null, 2) + '\n');
  return settingsPath;
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
  const { workspaceId, workspaceUrl, entries, dryPayloads } = await createWorkspace({ name, goal, modules, problemTests: Boolean(args['with-problem-tests']), dryRun, log: (m) => console.error('  ' + m) });
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

  // 3. notion-ids.json + 4. repo CLAUDE.md + 5. .claude/ agent config (hooks).
  let manifestPath = '(dry run)';
  let claudePath = '(dry run)';
  let agentCfgPath = '(dry run)';
  if (!dryRun) {
    manifestPath = mergeManifest(name, block);
    const cm = path.join(repoDir, 'CLAUDE.md');
    if (fs.existsSync(cm) && !args.force) { claudePath = `${cm} (exists — left as-is; --force to overwrite)`; }
    else if (fs.existsSync(repoDir)) { fs.writeFileSync(cm, claudeMd(name, workspaceUrl, entries)); claudePath = cm; }
    else { claudePath = `(repo dir not found: ${repoDir})`; }
    // Hooks make "consult the graph first" deterministic instead of relying on
    // the agent to remember the CLAUDE.md rule. Idempotent: safe to re-run.
    if (fs.existsSync(repoDir)) { agentCfgPath = writeAgentConfig(repoDir, name); }
    else { agentCfgPath = `(repo dir not found: ${repoDir})`; }
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
    console.error(`  .claude/ hooks:   ${agentCfgPath} (graph-first; open /hooks or restart to load)`);
  }
}

// Run as a CLI only when invoked directly (so tests can import the exports).
if (process.argv[1] && process.argv[1].endsWith('new-project.js')) {
  main().catch((err) => { console.error('new-project error:', err.message); process.exit(1); });
}
