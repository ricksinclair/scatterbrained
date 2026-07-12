#!/usr/bin/env node
// ============================================================================
// export-memory.js — the human-readable half of the double-accounting backup.
//
// The graph is the PRIMARY memory; this renders its major authored knowledge —
// current decisions with their rationale, goals, pinned facts, open ideas,
// rules — as ONE plain-markdown file a human or any assistant can read with no
// graph database and no particular AI tool. The exit guarantee: drop the app
// and you still have your memory; switch assistants and it reads your memory.
//
// Deliberately NOT a full copy (that's the JSON export's job): sources and
// documents are already the user's own files on disk, and machine plumbing
// (embeddings, sync markers, reviews) isn't memory. Bi-temporally honest:
// anything superseded (valid_until set) is excluded.
//
// Usage:
//   node scripts/export-memory.js                     # → backups/memory.md
//   node scripts/export-memory.js --output my-memory.md
// ============================================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Idea statuses that mean "no longer open" — everything else is worth keeping.
const CLOSED_IDEA = new Set(['implemented', 'done', 'shipped', 'rejected', 'abandoned']);

const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ── pure renderer (unit-tested; no database) ────────────────────────────────
// data: { projects: [{name, description, status}], insights: [{summary, full_text,
// created, about: []}], goals, facts: [{value, note, about}], ideas: [{name,
// description, status, project}], rules } — all plain values.
export function renderMemoryMarkdown(data, { date = null } = {}) {
  const out = [];
  const projects = data.projects || [];
  const insights = data.insights || [];
  const facts = data.facts || [];
  const ideas = (data.ideas || []).filter((i) => !CLOSED_IDEA.has(String(i.status || '').toLowerCase()));

  out.push(`# Your knowledge${date ? ` — exported ${date}` : ''}`);
  out.push('');
  out.push('> The human-readable companion to the JSON graph backup: your current');
  out.push('> decisions (with the why), goals, pinned facts, and open ideas. Plain');
  out.push('> markdown — no database or particular tool needed to read it. Superseded');
  out.push('> knowledge is not shown; the JSON backup keeps full history.');
  out.push('');

  const claimed = new Set();
  for (const p of projects) {
    const mine = (list, key) => list.filter((x) => (x[key] || []).includes(p.name) || x.project === p.name);
    const pIns = mine(insights, 'about');
    const pIdeas = ideas.filter((i) => i.project === p.name);
    const ideaNames = new Set(pIdeas.map((i) => i.name));
    const pFacts = facts.filter((f) => f.about === p.name || ideaNames.has(f.about));
    if (!pIns.length && !pIdeas.length && !pFacts.length && !p.description) continue;

    out.push(`## ${p.name}${p.status ? ` · ${p.status}` : ''}`);
    if (p.description) out.push('', clean(p.description));
    if (pIns.length) {
      out.push('', '### Decisions & lessons', '');
      for (const i of pIns) { claimed.add(i); out.push(`- **${day(i.created) || 'undated'}** — ${clean(i.full_text || i.summary)}`); }
    }
    if (pFacts.length) {
      out.push('', '### Pinned facts', '');
      for (const f of pFacts) { claimed.add(f); out.push(`- \`${clean(f.value)}\`${f.note ? ` — ${clean(f.note)}` : ''}${f.about !== p.name ? ` (on: ${f.about})` : ''}`); }
    }
    if (pIdeas.length) {
      out.push('', '### Open ideas', '');
      for (const i of pIdeas) out.push(`- **${i.name}**${i.status ? ` (${i.status})` : ''}${i.description ? ` — ${clean(i.description)}` : ''}`);
    }
    out.push('');
  }

  if ((data.goals || []).length) {
    out.push('## Goals', '');
    for (const g of data.goals) {
      const bits = [g.timeframe, g.status, g.target_date ? `target ${day(g.target_date)}` : null].filter(Boolean);
      out.push(`- **${g.name}**${bits.length ? ` (${bits.join(' · ')})` : ''}${g.description ? ` — ${clean(g.description)}` : ''}`);
    }
    out.push('');
  }

  if ((data.rules || []).length) {
    out.push('## Rules & constraints', '');
    for (const r of data.rules) {
      const cite = [r.citation, r.jurisdiction].filter(Boolean).join(', ');
      out.push(`- **${r.name}**${r.summary ? ` — ${clean(r.summary)}` : ''}${cite ? ` [${cite}]` : ''}`);
    }
    out.push('');
  }

  const loose = { ins: insights.filter((i) => !claimed.has(i)), facts: facts.filter((f) => !claimed.has(f)) };
  if (loose.ins.length || loose.facts.length) {
    out.push('## Everything else', '');
    for (const i of loose.ins) out.push(`- **${day(i.created) || 'undated'}**${i.about?.length ? ` (${i.about.join(', ')})` : ''} — ${clean(i.full_text || i.summary)}`);
    for (const f of loose.facts) out.push(`- \`${clean(f.value)}\`${f.note ? ` — ${clean(f.note)}` : ''}${f.about ? ` (on: ${f.about})` : ''}`);
    out.push('');
  }

  return out.join('\n');
}

// ── graph → plain data ───────────────────────────────────────────────────────
export async function gatherMemory(driver) {
  const rows = async (q, params = {}) => (await run(driver, q, params)).map((r) => toPlain(r.toObject()));
  const CURRENT = 'n.valid_until IS NULL';
  const [projects, insights, goals, facts, ideas, rules] = await Promise.all([
    rows(`MATCH (n:Project) WHERE ${CURRENT} RETURN n.name AS name, n.description AS description, n.status AS status ORDER BY name`),
    rows(`MATCH (n:Insight) WHERE ${CURRENT} OPTIONAL MATCH (n)-[:ABOUT]->(t)
          RETURN n.summary AS summary, n.full_text AS full_text, toString(n.created_at) AS created,
                 [x IN collect(DISTINCT coalesce(t.name, t.title)) WHERE x IS NOT NULL] AS about
          ORDER BY created DESC`),
    rows(`MATCH (n:Goal) WHERE ${CURRENT} RETURN n.name AS name, n.timeframe AS timeframe, n.status AS status, n.description AS description, toString(n.target_date) AS target_date ORDER BY name`),
    rows(`MATCH (n:ProtectedFact)-[:ABOUT]->(t) WHERE ${CURRENT} RETURN n.value AS value, n.note AS note, coalesce(t.name, t.title) AS about`),
    rows(`MATCH (p:Project)-[:CONTAINS]->(n:Idea) WHERE ${CURRENT} RETURN n.name AS name, n.description AS description, n.status AS status, p.name AS project ORDER BY name`),
    rows(`MATCH (n:Rule) WHERE ${CURRENT} RETURN n.name AS name, n.summary AS summary, n.citation AS citation, n.jurisdiction AS jurisdiction ORDER BY name`),
  ]);
  return { projects, insights, goals, facts, ideas, rules };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.output && args.output !== true
    ? path.resolve(ROOT, args.output)
    : path.resolve(ROOT, 'backups', 'memory.md');
  const driver = getDriver();
  try {
    const data = await gatherMemory(driver);
    const md = renderMemoryMarkdown(data, { date: new Date().toISOString().slice(0, 10) });
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, md + '\n');
    const counts = `${data.insights.length} decisions · ${data.goals.length} goals · ${data.facts.length} pinned facts · ${data.ideas.length} ideas · ${data.rules.length} rules`;
    console.log(`Memory written: ${outPath}\n  ${counts}`);
  } finally {
    await driver.close();
  }
}
