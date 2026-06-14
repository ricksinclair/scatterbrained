#!/usr/bin/env node
// ============================================================================
// notion-index.js — deterministic "what changed?" probe for the KB database.
//
// Lists pages whose last_edited_time is newer than --since, newest first,
// short-circuiting as soon as it passes the cutoff. Pure metadata: no page
// bodies, no LLM, minimal payload. This is the cheap change-detection layer —
// the LLM/MCP only has to extract the pages this script flags.
//
// OPTIONAL upgrade over the MCP path. Requires a Notion integration token:
//   1. Create an internal integration: https://www.notion.so/my-integrations
//   2. In Notion, open the KB database → ••• → Connections → add the integration.
//   3. Add to .env (gitignored):
//        NOTION_TOKEN=ntn_xxx
//        NOTION_KB_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//
// Usage:
//   node scripts/notion-index.js                                  # all rows, newest first
//   node scripts/notion-index.js --since 2026-06-01T00:00:00Z     # only rows edited after
//
// Output: JSON array [{ id, title, last_edited_time }] on stdout. Empty array
// means nothing changed since --since. Exit 2 = not configured (caller should
// fall back to the MCP path).
// ============================================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_KB_DATABASE_ID;

if (!TOKEN || !DB) {
  console.error('notion-index: NOTION_TOKEN and NOTION_KB_DATABASE_ID not set — token path inactive.');
  process.exit(2); // signal "not configured" so the skill falls back to the MCP query
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const since = getArg('--since');
const sinceMs = since ? Date.parse(since) : -Infinity;
if (since && Number.isNaN(sinceMs)) {
  console.error(`notion-index: --since "${since}" is not a valid ISO timestamp.`);
  process.exit(1);
}

function titleOf(page) {
  for (const v of Object.values(page.properties || {})) {
    if (v.type === 'title') return v.title.map((t) => t.plain_text).join('') || '(untitled)';
  }
  return '(untitled)';
}

async function queryPage(cursor) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Notion API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const changed = [];
  let cursor;
  // Rows arrive newest-first. Walk until we cross the --since cutoff, then stop:
  // everything after it is older, so there's nothing left to check.
  outer: while (true) {
    const data = await queryPage(cursor);
    for (const page of data.results) {
      if (Date.parse(page.last_edited_time) <= sinceMs) break outer;
      changed.push({ id: page.id, title: titleOf(page), last_edited_time: page.last_edited_time });
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  console.log(JSON.stringify(changed, null, 2));
}

main().catch((err) => {
  console.error('notion-index error:', err.message);
  process.exit(1);
});
