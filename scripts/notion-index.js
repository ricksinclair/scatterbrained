#!/usr/bin/env node
// ============================================================================
// notion-index.js — deterministic "what changed?" probe for Notion.
//
// Lists pages whose last_edited_time is newer than --since, newest first,
// short-circuiting as soon as it passes the cutoff. Pure metadata: no page
// bodies, no LLM, minimal payload. This is the cheap change-detection layer —
// the LLM/MCP only has to extract the pages this script flags.
//
// Two modes, picked automatically:
//   • One-root mode (DEFAULT — matches Scatterbrained's one-root Notion model):
//     POST /v1/search over everything shared with the integration, sorted by
//     last_edited_time. Because the integration is connected once at the single
//     parent ("one-root") page, that share inherits to every project subpage —
//     so search returns exactly that subtree. No KB database required, no
//     per-page fetch. Just set NOTION_TOKEN.
//   • Single-database mode (LEGACY — opt in by setting NOTION_KB_DATABASE_ID):
//     query one flat KB database. Kept for setups built around a single DB.
//
// No NOTION_TOKEN? Use the MCP connector path instead (the graph-sync skill's
// lower tier): the same one-root share lets the connector reach every subpage,
// but the connector can't filter by last-edited, so detection is less precise.
//
// Setup (token path):
//   1. Create an internal integration: https://www.notion.so/my-integrations
//   2. In Notion, open your one-root parent page → ••• → Connections → add it
//      (or, single-database mode, add it on the KB database).
//   3. Add to .env (gitignored):
//        NOTION_TOKEN=ntn_xxx
//        # NOTION_KB_DATABASE_ID=...   # optional — only for single-database mode
//
// Usage:
//   node scripts/notion-index.js                                  # all pages, newest first
//   node scripts/notion-index.js --since 2026-06-01T00:00:00Z     # only pages edited after
//
// Output: JSON array [{ id, title, last_edited_time }] on stdout. Empty array
// means nothing changed since --since. Exit 2 = not configured (caller should
// fall back to the MCP connector path).
// ============================================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TOKEN = process.env.NOTION_TOKEN;
const DB = process.env.NOTION_KB_DATABASE_ID; // optional — enables single-database mode

if (!TOKEN) {
  console.error('notion-index: NOTION_TOKEN not set — token path inactive (use the MCP connector path).');
  process.exit(2); // signal "not configured" so the skill falls back to the MCP connector
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

async function notion(endpoint, body) {
  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion API ${res.status}: ${await res.text()}`);
  return res.json();
}

// One page of results, newest-first by last_edited_time, for whichever mode is active.
function fetchPage(cursor) {
  if (DB) {
    return notion(`databases/${DB}/query`, {
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      ...(cursor ? { start_cursor: cursor } : {}),
    });
  }
  return notion('search', {
    page_size: 100,
    filter: { property: 'object', value: 'page' },
    sort: { timestamp: 'last_edited_time', direction: 'descending' },
    ...(cursor ? { start_cursor: cursor } : {}),
  });
}

async function main() {
  const changed = [];
  let cursor;
  // Rows arrive newest-first. Walk until we cross the --since cutoff, then stop:
  // everything after it is older, so there's nothing left to check.
  outer: while (true) {
    const data = await fetchPage(cursor);
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
