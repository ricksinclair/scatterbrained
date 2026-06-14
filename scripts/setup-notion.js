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

export function databases(modules) {
  const moduleOpts = modules.map((m, i) => [m, ['blue', 'green', 'purple', 'orange', 'gray'][i % 5]]);
  const suite = sel(['Unit', 'green'], ['Integration', 'blue'], ['E2E', 'purple'], ['Lint', 'orange']);
  return [
    { key: 'Development Tracker', purpose: 'Kanban board — tasks', props: {
      Name: TITLE,
      Stage: sel(['Backlog', 'gray'], ['To Do', 'blue'], ['In Progress', 'yellow'], ['Review', 'orange'], ['Done', 'green']),
      Priority: sel(['P0-Critical', 'red'], ['P1-High', 'orange'], ['P2-Medium', 'yellow'], ['P3-Low', 'gray']),
      Module: sel(...moduleOpts),
      Type: sel(['Feature', 'blue'], ['Bug', 'red'], ['Refactor', 'purple'], ['Test', 'yellow'], ['Docs', 'gray']),
      Effort: sel(['XS', 'gray'], ['S', 'green'], ['M', 'yellow'], ['L', 'orange'], ['XL', 'red']),
    } },
    { key: 'Documentation Index', purpose: 'All docs', props: {
      Name: TITLE,
      Category: sel(['Architecture', 'blue'], ['API Reference', 'purple'], ['Guides', 'green'], ['Status Reports', 'orange'], ['Testing', 'yellow'], ['Security', 'red']),
      Status: sel(['Draft', 'gray'], ['Current', 'green'], ['Needs Update', 'orange'], ['Archived', 'default']),
      Owner: TEXT, 'Last Updated': DATE,
    } },
    { key: 'Changelog', purpose: 'Release tracking', props: {
      Name: TITLE, Date: DATE,
      Type: sel(['feat', 'green'], ['fix', 'red'], ['docs', 'gray'], ['refactor', 'purple'], ['test', 'yellow'], ['chore', 'default'], ['perf', 'blue']),
      Version: TEXT, Description: TEXT,
    } },
    { key: 'Test Run Metrics', purpose: 'Pass/fail over time', props: {
      Name: TITLE, 'Run Date': DATE, Suite: suite,
      Passed: NUM, Failed: NUM, Skipped: NUM, Total: NUM, 'Pass Rate %': NUM, 'Duration (sec)': NUM,
      Branch: TEXT, Commit: TEXT,
      'Triggered By': sel(['Manual', 'gray'], ['CI/CD', 'blue'], ['Pre-commit', 'green'], ['Scheduled', 'purple']),
      Notes: TEXT,
    } },
    { key: 'Problem Tests', purpose: 'Flaky/failing tests', props: {
      'Test Name': TITLE, 'File Path': TEXT, Suite: suite,
      Status: sel(['Failing', 'red'], ['Flaky', 'orange'], ['Skipped', 'gray'], ['Fixed', 'green'], ["Won't Fix", 'default']),
      Priority: sel(['P0-Critical', 'red'], ['P1-High', 'orange'], ['P2-Medium', 'yellow'], ['P3-Low', 'gray']),
      'First Seen': DATE, 'Last Seen': DATE, 'Failure Count': NUM, 'Error Message': TEXT,
      'Root Cause': sel(['Timing/Race Condition', 'orange'], ['Test Data', 'yellow'], ['Environment', 'blue'], ['Code Bug', 'red'], ['Selector/Locator', 'purple'], ['API Mock', 'green'], ['Unknown', 'gray']),
      Notes: TEXT,
    } },
  ];
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
export async function createWorkspace({ name, goal, modules, dryRun = false, log = () => {} }) {
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
    children: [para(`Home for ${name}. Databases and status pages live here. Created by Engram's new-project.`)],
  };
  let workspaceId = '<workspace-page-id>';
  let workspaceUrl = '';
  if (dryRun) dryPayloads.push({ label: `page: ${name} — Workspace`, body: wsBody });
  else { const ws = await notion('pages', wsBody); workspaceId = ws.id; workspaceUrl = ws.url; log(`✓ workspace page`); }
  emit('Workspace', 'page', workspaceId, 'Workspace home');

  // 2. The five databases (parented to the workspace page).
  for (const def of databases(modules)) {
    const body = { parent: { type: 'page_id', page_id: workspaceId }, title: [{ text: { content: def.key } }], properties: def.props };
    if (dryRun) { dryPayloads.push({ label: `database: ${def.key}`, body }); emit(def.key, 'data_source', '<db-id>', def.purpose); }
    else { const db = await notion('databases', body); emit(def.key, 'data_source', db.id, def.purpose); log(`✓ database: ${def.key}`); }
  }

  // 3. Status pages.
  const pages = {
    'Implementation Progress': [para(goal), h2(today), para('Workspace created.')],
    Architecture: [h2('Overview'), h2('Components'), h2('Data Model'), h2('Decisions')],
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

  const { workspaceUrl, entries, dryPayloads } = await createWorkspace({ name, goal, modules, dryRun, log: (m) => console.error(m) });
  if (dryRun) for (const p of dryPayloads) console.log(`\n# would create ${p.label}\n` + JSON.stringify(p.body, null, 2));

  console.log(`\n${dryRun ? '# DRY RUN — nothing created. ' : ''}notion-ids.json block:\n`);
  console.log(JSON.stringify(manifestBlock(name, workspaceUrl, entries), null, 2));
  if (!dryRun) console.error('\nDone. Paste the block above into notion-ids.json, then `npm run check:notion`.');
}

// Run as a CLI only when invoked directly (so new-project.js can import the exports).
if (process.argv[1] && process.argv[1].endsWith('setup-notion.js')) {
  main().catch((err) => { console.error('setup-notion error:', err.message); process.exit(1); });
}
