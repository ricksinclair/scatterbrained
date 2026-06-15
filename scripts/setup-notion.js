#!/usr/bin/env node
// ============================================================================
// setup-notion.js — stand up the operational Notion workspace via the Notion API.
//
// The "operations desk" half of the system: a Kanban tracker, Documentation
// Index, Changelog, Test Run Metrics, Problem Tests, plus a workspace home +
// Implementation Progress + Architecture pages. Project-agnostic defaults.
// Schemas mirror the standard project-operations stack.
//
// This file also EXPORTS `createWorkspace()` so `new-project.js` can stand up the
// graph + Notion + repo CLAUDE.md together as one cohesive system.
//
// One-time setup:
//   1. Create an internal integration at https://www.notion.so/my-integrations
//      and copy its token.
//   2. In Notion, open (or create) a page to hold the workspace, then ••• →
//      Connections → add your integration. Copy that page's id (32-hex in the URL).
//   3. In .env:  NOTION_TOKEN=ntn_xxx   NOTION_PARENT_PAGE_ID=xxxxxxxxxxxx
//
// Usage:
//   node scripts/setup-notion.js --name "My Project"
//   node scripts/setup-notion.js --name "My Project" --modules "Backend,Frontend,Docs"
//   node scripts/setup-notion.js --name "X" --dry-run     # print payloads, create nothing
//
// Prints a ready-to-paste notion-ids.json block (feed `check-notion`).
// ============================================================================
import { parseArgs, splitList } from './lib/db.js'; // (db.js also loads .env on import)

const API = 'https://api.notion.com/v1';

// --- property + block builders ---------------------------------------------
const optn = (o) => (Array.isArray(o) ? { name: o[0], color: o[1] } : { name: o, color: 'default' });
const sel = (...o) => ({ select: { options: o.map(optn) } });
const TITLE = { title: {} };
const TEXT = { rich_text: {} };
const DATE = { date: {} };
const NUM = { number: {} };
const para = (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: t } }] } });
const h2 = (t) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: t } }] } });

// The operational databases. These are HUMAN DIGESTS for non-technical
// stakeholders (partners, clients, funders, future-self) — written at milestones
// from the real sources of truth (code, git/GitHub, the graph), NOT live mirrors
// you hand-maintain. Each `description` is written onto the Notion database so an
// empty one explains what it's for and who keeps it, instead of implying activity
// that isn't there. `problemTests` is opt-in (team-scale flaky-test tracking).
export function databases(modules, { problemTests = false } = {}) {
  const moduleOpts = modules.map((m, i) => [m, ['blue', 'green', 'purple', 'orange', 'gray'][i % 5]]);
  const suite = sel(['Unit', 'green'], ['Integration', 'blue'], ['E2E', 'purple'], ['Lint', 'orange']);
  const dbs = [
    { key: 'Changelog', purpose: 'Release notes (flagship human surface)',
      description: 'Plain-English release notes — the flagship surface for non-technical stakeholders. One row per release: post the version\'s TL;DR (draft it from the graph with `writeback`, then `--commit`). This is the Notion DB most worth keeping current.',
      props: {
      Name: TITLE, Date: DATE,
      Type: sel(['feat', 'green'], ['fix', 'red'], ['docs', 'gray'], ['refactor', 'purple'], ['test', 'yellow'], ['chore', 'default'], ['perf', 'blue']),
      Version: TEXT, Description: TEXT,
    } },
    { key: 'Documentation Index', purpose: 'Index of durable docs',
      description: 'An index of durable docs (architecture, guides, status) for people who won\'t browse the repo. Link docs here as you write them and keep Status honest.',
      props: {
      Name: TITLE,
      Category: sel(['Architecture', 'blue'], ['API Reference', 'purple'], ['Guides', 'green'], ['Status Reports', 'orange'], ['Testing', 'yellow'], ['Security', 'red']),
      Status: sel(['Draft', 'gray'], ['Current', 'green'], ['Needs Update', 'orange'], ['Archived', 'default']),
      Owner: TEXT, 'Last Updated': DATE,
    } },
    { key: 'Development Tracker', purpose: 'Optional stakeholder task view',
      description: 'Optional Kanban for non-technical stakeholders who want a Notion-native view of what\'s in progress vs done. GitHub issues are the real tracker — only keep this in sync if someone is actually reading it.',
      props: {
      Name: TITLE,
      Stage: sel(['Backlog', 'gray'], ['To Do', 'blue'], ['In Progress', 'yellow'], ['Review', 'orange'], ['Done', 'green']),
      Priority: sel(['P0-Critical', 'red'], ['P1-High', 'orange'], ['P2-Medium', 'yellow'], ['P3-Low', 'gray']),
      Module: sel(...moduleOpts),
      Type: sel(['Feature', 'blue'], ['Bug', 'red'], ['Refactor', 'purple'], ['Test', 'yellow'], ['Docs', 'gray']),
      Effort: sel(['XS', 'gray'], ['S', 'green'], ['M', 'yellow'], ['L', 'orange'], ['XL', 'red']),
    } },
    { key: 'Test Run Metrics', purpose: 'Milestone health snapshot',
      description: 'A milestone health snapshot — latest pass rate, last green build, version — updated on release or CI-on-main, NOT a row per local test run. The signal a stakeholder wants is "is it healthy?", not run-by-run history.',
      props: {
      Name: TITLE, 'Run Date': DATE, Suite: suite,
      Passed: NUM, Failed: NUM, Skipped: NUM, Total: NUM, 'Pass Rate %': NUM, 'Duration (sec)': NUM,
      Branch: TEXT, Commit: TEXT,
      'Triggered By': sel(['Manual', 'gray'], ['CI/CD', 'blue'], ['Pre-commit', 'green'], ['Scheduled', 'purple']),
      Notes: TEXT,
    } },
  ];
  if (problemTests) {
    dbs.push({ key: 'Problem Tests', purpose: 'Flaky/failing tests (team, opt-in)',
      description: 'A flaky/failing-test tracker for teams. Opt-in (`--with-problem-tests`) — solo projects fix tests in place and don\'t need it.',
      props: {
      'Test Name': TITLE, 'File Path': TEXT, Suite: suite,
      Status: sel(['Failing', 'red'], ['Flaky', 'orange'], ['Skipped', 'gray'], ['Fixed', 'green'], ["Won't Fix", 'default']),
      Priority: sel(['P0-Critical', 'red'], ['P1-High', 'orange'], ['P2-Medium', 'yellow'], ['P3-Low', 'gray']),
      'First Seen': DATE, 'Last Seen': DATE, 'Failure Count': NUM, 'Error Message': TEXT,
      'Root Cause': sel(['Timing/Race Condition', 'orange'], ['Test Data', 'yellow'], ['Environment', 'blue'], ['Code Bug', 'red'], ['Selector/Locator', 'purple'], ['API Mock', 'green'], ['Unknown', 'gray']),
      Notes: TEXT,
    } });
  }
  return dbs;
}

async function notion(path, body) {
  const res = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

// Create the workspace home + 5 databases + 2 status pages. Returns
// { workspaceId, workspaceUrl, entries, dryPayloads }. Honors --dry-run (creates nothing).
export async function createWorkspace({ name, goal, modules, problemTests = false, dryRun = false, log = () => {} }) {
  const today = new Date().toISOString().slice(0, 10);
  const parentPage = process.env.NOTION_PARENT_PAGE_ID || '<NOTION_PARENT_PAGE_ID>';
  const entries = {};
  const dryPayloads = [];
  const emit = (label, kind, id, purpose) => { entries[label] = { kind, id, purpose }; };

  // 1. Workspace home page.
  const wsBody = {
    parent: { type: 'page_id', page_id: parentPage },
    icon: { type: 'emoji', emoji: '🚀' },
    properties: { title: { title: [{ text: { content: `${name} — Workspace` } }] } },
    children: [
      para(`Home for ${name}. Created by Engram's new-project.`),
      para('These databases are human digests for non-technical stakeholders, written at milestones — not live mirrors to hand-maintain. Your code, git/GitHub, and the Engram graph are the day-to-day sources of truth. Each database below describes what it is for and who keeps it current.'),
    ],
  };
  let workspaceId = '<workspace-page-id>';
  let workspaceUrl = '';
  if (dryRun) dryPayloads.push({ label: `page: ${name} — Workspace`, body: wsBody });
  else { const ws = await notion('pages', wsBody); workspaceId = ws.id; workspaceUrl = ws.url; log(`✓ workspace page`); }
  emit('Workspace', 'page', workspaceId, 'Workspace home');

  // 2. The operational databases (parented to the workspace page). The human-facing
  // `description` is written onto each DB so an empty one explains its purpose + audience.
  for (const def of databases(modules, { problemTests })) {
    const body = {
      parent: { type: 'page_id', page_id: workspaceId },
      title: [{ text: { content: def.key } }],
      description: [{ type: 'text', text: { content: def.description } }],
      properties: def.props,
    };
    if (dryRun) { dryPayloads.push({ label: `database: ${def.key}`, body }); emit(def.key, 'data_source', '<db-id>', def.purpose); }
    else { const db = await notion('databases', body); emit(def.key, 'data_source', db.id, def.purpose); log(`✓ database: ${def.key}`); }
  }

  // 3. Status + capture pages.
  const pages = {
    'Implementation Progress': [para(goal), h2(today), para('Workspace created.')],
    Architecture: [h2('Overview'), h2('Components'), h2('Data Model'), h2('Decisions')],
    Capture: [para('Drop notes, research, and decisions under this page. Anything nested here is reachable by your integration and can be ingested into the graph (the capture lane) — no extra page-sharing needed, because it inherits this workspace\'s access.')],
  };
  for (const [label, children] of Object.entries(pages)) {
    const body = { parent: { type: 'page_id', page_id: workspaceId }, properties: { title: { title: [{ text: { content: label } }] } }, children };
    if (dryRun) { dryPayloads.push({ label: `page: ${label}`, body }); emit(label, 'page', '<page-id>', label); }
    else { const p = await notion('pages', body); emit(label, 'page', p.id, label); log(`✓ page: ${label}`); }
  }

  return { workspaceId, workspaceUrl, entries, dryPayloads };
}

export function manifestBlock(name, workspaceUrl, entries) {
  return { projects: { [name]: { workspace_url: workspaceUrl || '<workspace-url>', entries } } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run']);
  const name = args.name && args.name !== true ? String(args.name) : 'My Project';
  const goal = args.goal && args.goal !== true ? String(args.goal) : `Build ${name}.`;
  const modules = splitList(args.modules).length ? splitList(args.modules) : ['Backend', 'Frontend', 'Infrastructure', 'Docs'];

  if (!dryRun && (!process.env.NOTION_TOKEN || !process.env.NOTION_PARENT_PAGE_ID)) {
    console.error('setup-notion: set NOTION_TOKEN and NOTION_PARENT_PAGE_ID in .env (see header), or pass --dry-run.');
    process.exit(2);
  }

  const { workspaceUrl, entries, dryPayloads } = await createWorkspace({ name, goal, modules, problemTests: Boolean(args['with-problem-tests']), dryRun, log: (m) => console.error(m) });
  if (dryRun) for (const p of dryPayloads) console.log(`\n# would create ${p.label}\n` + JSON.stringify(p.body, null, 2));

  console.log(`\n${dryRun ? '# DRY RUN — nothing created. ' : ''}notion-ids.json block:\n`);
  console.log(JSON.stringify(manifestBlock(name, workspaceUrl, entries), null, 2));
  if (!dryRun) console.error('\nDone. Paste the block above into notion-ids.json, then `npm run check:notion`.');
}

// Run as a CLI only when invoked directly (so new-project.js can import the exports).
if (process.argv[1] && process.argv[1].endsWith('setup-notion.js')) {
  main().catch((err) => { console.error('setup-notion error:', err.message); process.exit(1); });
}
