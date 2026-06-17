#!/usr/bin/env node
// ============================================================================
// write-back-decisions.js — the graph→Notion WRITER half of the write-back gap.
//
// `review:decisions` (review-undocumented-decisions.js) DETECTS decisions that
// live only in the graph. This script helps close them — without producing the
// boilerplate a raw `summary`→Notion dump would. It is deliberately a TWO-STEP,
// hybrid flow so the human-readable entry stays *agent-authored prose*, not a
// mechanical field copy:
//
//   1. DRAFT (default, read-only): emit the undocumented decisions as candidate
//      entries, each seeded with the Insight's full_text. The agent rewrites
//      `description` into a crisp human paragraph (the "why", not a Cypher dump).
//
//   2. COMMIT (--commit, guarded): read the finalized, agent-authored entries
//      (a JSON array via --file <path> or stdin) and append each as a row to the
//      project's Notion Changelog. After a successful post, mark that Notion
//      surface fresh in the graph so `review:decisions` stops flagging it.
//
// Notion is a PUBLISHED surface, so this never posts on its own: drafting is the
// default; posting requires --commit AND a NOTION_TOKEN AND explicit entries.
//
// Usage:
//   node scripts/write-back-decisions.js --project Scatterbrained            # draft (JSON candidates)
//   node scripts/write-back-decisions.js --project Scatterbrained --days 30
//   node scripts/write-back-decisions.js --commit --file entries.json
//   cat entries.json | node scripts/write-back-decisions.js --commit
// ============================================================================
import { readFileSync } from 'node:fs';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';
import { HUMAN_SURFACES } from './review-undocumented-decisions.js';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Detection: same shape as review:decisions, but returns each undocumented
// Insight's id + full_text so a candidate can be seeded for prose authoring.
export const CYPHER = `
  MATCH (p:Project)<-[:ABOUT]-(i:Insight)
  WHERE ($project IS NULL OR p.name = $project)
    AND i.created_at >= datetime() - duration({days: $days})
  OPTIONAL MATCH (p)<-[:INFORMS]-(s:Source) WHERE s.source_kind IN $kinds
  WITH p, i, max(coalesce(s.last_synced_at, s.created_at)) AS freshestHuman
  WHERE freshestHuman IS NULL OR i.created_at > freshestHuman
  RETURN p.name AS project,
         coalesce(i.id, toString(id(i))) AS insight_id,
         coalesce(i.summary, '(Insight has no summary)') AS summary,
         coalesce(i.full_text, i.summary, '') AS full_text,
         toString(i.created_at) AS created_at
  ORDER BY project, created_at DESC`;

// Pure: shape a detection row into a draft Changelog candidate. `description`
// is SEEDED with full_text — the agent is expected to rewrite it as prose before
// committing. Kept side-effect-free so it's unit-testable.
export function toCandidate(row, today) {
  return {
    insight_id: row.insight_id,
    project: row.project,
    name: row.summary.length > 80 ? row.summary.slice(0, 79) + '…' : row.summary,
    type: 'docs',
    version: 'Unreleased',
    date: today,
    // Prose seed — REWRITE THIS into a human paragraph (the why), don't ship raw.
    description: row.full_text,
    _decided_at: row.created_at,
  };
}

// Pure: map a finalized entry to the Notion "create page in DB" properties for
// the Changelog schema (Name, Date, Type, Version, Description). Unit-testable.
export function buildChangelogProperties(entry) {
  if (!entry || !entry.name || !entry.description) {
    throw new Error('entry requires at least { name, description }');
  }
  const props = {
    Name: { title: [{ text: { content: String(entry.name) } }] },
    Description: { rich_text: [{ text: { content: String(entry.description) } }] },
  };
  if (entry.date) props.Date = { date: { start: String(entry.date) } };
  if (entry.type) props.Type = { select: { name: String(entry.type) } };
  if (entry.version) props.Version = { rich_text: [{ text: { content: String(entry.version) } }] };
  return props;
}

// Resolve a project's Changelog data-source id from the Notion id manifest.
export function changelogId(manifest, project) {
  const entry = manifest?.projects?.[project]?.entries?.Changelog;
  if (!entry?.id) throw new Error(`No Changelog id for project "${project}" in notion-ids.json`);
  return entry.id;
}

async function notionPost(path, body) {
  const res = await fetch(`${NOTION_API}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

function readManifest() {
  const url = new URL('../notion-ids.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

function readEntries(args) {
  const raw = args.file && args.file !== true
    ? readFileSync(String(args.file), 'utf8')
    : readFileSync(0, 'utf8'); // stdin
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('--commit expects a JSON array of entries');
  return parsed;
}

// ---- DRAFT (default, read-only) ----
async function draft(args) {
  const params = {
    project: args.project && args.project !== true ? String(args.project) : null,
    days: args.days ? Number(args.days) : 14,
    kinds: HUMAN_SURFACES,
  };
  const today = new Date().toISOString().slice(0, 10);
  const driver = getDriver();
  let candidates = [];
  try {
    const recs = await run(driver, CYPHER, params);
    candidates = recs.map((r) => toCandidate({
      project: toPlain(r.get('project')),
      insight_id: toPlain(r.get('insight_id')),
      summary: toPlain(r.get('summary')),
      full_text: toPlain(r.get('full_text')),
      created_at: toPlain(r.get('created_at')),
    }, today));
  } finally {
    await driver.close();
  }
  console.error(
    candidates.length
      ? `\n${candidates.length} undocumented decision(s). REWRITE each "description" into prose, then:\n` +
        `  node scripts/write-back-decisions.js --commit --file <edited.json>\n`
      : '\nNo undocumented decisions to write back.\n'
  );
  console.log(JSON.stringify(candidates, null, 2));
}

// ---- COMMIT (--commit, guarded) ----
async function commit(args) {
  if (!process.env.NOTION_TOKEN) throw new Error('--commit requires NOTION_TOKEN in the environment');
  const entries = readEntries(args);
  const manifest = readManifest();
  const today = new Date().toISOString().slice(0, 10);

  const posted = [];
  for (const e of entries) {
    const project = e.project;
    if (!project) throw new Error('each entry needs a "project"');
    const dbId = changelogId(manifest, project);
    await notionPost('pages', {
      parent: { database_id: dbId },
      properties: buildChangelogProperties(e),
    });
    posted.push({ project, name: e.name });
    console.error(`  ✓ posted to ${project} Changelog: ${e.name}`);
  }

  // Mark each touched project's Notion Changelog surface fresh so review:decisions
  // clears immediately, rather than waiting for the next full Notion re-ingest.
  const driver = getDriver();
  try {
    for (const project of [...new Set(posted.map((p) => p.project))]) {
      const dbId = changelogId(manifest, project);
      await run(
        driver,
        `MATCH (p:Project {name:$project})
         MERGE (s:Source {notion_id:$dbId})
           ON CREATE SET s.title = $project + ' — Changelog', s.source_kind = 'notion_page', s.created_at = datetime()
         SET s.last_synced_at = datetime($now)
         MERGE (s)-[:INFORMS]->(p)`,
        { project, dbId, now: today + 'T00:00:00Z' }
      );
    }
  } finally {
    await driver.close();
  }
  console.error(`\nDone — ${posted.length} entr(y/ies) posted. Re-run review:decisions to confirm the flag cleared.\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.commit) return commit(args);
  return draft(args);
}

if (process.argv[1] && process.argv[1].endsWith('write-back-decisions.js')) {
  main().catch((err) => { console.error('write-back-decisions error:', err.message); process.exit(1); });
}
