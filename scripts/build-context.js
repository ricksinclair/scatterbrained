#!/usr/bin/env node
// Build a formatted personal-knowledge context block from Neo4j, ready to
// paste into any Claude prompt.
//
// Usage:
//   node scripts/build-context.js --project acme
//   node scripts/build-context.js --domain legal
//   node scripts/build-context.js --domain software
//   node scripts/build-context.js --tag nc
//   node scripts/build-context.js --tag beekeeping
//   node scripts/build-context.js --person "Jane Doe"
//   node scripts/build-context.js --goal 30_days
//   node scripts/build-context.js --recent 7
import { getDriver, run, parseArgs, toPlain } from './lib/db.js';

const SUPPORTED = ['project', 'domain', 'tag', 'person', 'goal', 'recent'];

function pickFlag(args) {
  for (const f of SUPPORTED) {
    if (args[f] !== undefined) return { flag: f, value: args[f] };
  }
  return null;
}

// Resolve the set of in-scope node elementIds for the given flag.
// Anchors are matched directly; their 1-hop neighbours are included so the
// context block is relationship-rich rather than a flat list.
async function collectScope(driver, flag, value) {
  let anchorMatch;
  const params = { value };
  switch (flag) {
    case 'project':
      anchorMatch = 'MATCH (a:Project) WHERE toLower(a.name) CONTAINS toLower($value)';
      break;
    case 'person':
      anchorMatch = 'MATCH (a:Person) WHERE toLower(a.name) CONTAINS toLower($value)';
      break;
    case 'domain':
      anchorMatch = 'MATCH (a) WHERE a.domain = $value';
      break;
    case 'tag':
      anchorMatch = 'MATCH (a) WHERE a.tags IS NOT NULL AND $value IN a.tags';
      break;
    case 'goal':
      anchorMatch = 'MATCH (a:Goal) WHERE a.timeframe = $value';
      break;
    case 'recent': {
      const days = Number(value) || 7;
      params.days = days;
      anchorMatch =
        'MATCH (a) WHERE a.created_at IS NOT NULL AND a.created_at >= datetime() - duration({days: $days})';
      break;
    }
    default:
      throw new Error(`Unsupported flag: ${flag}`);
  }

  const cypher = `
    ${anchorMatch}
    WITH collect(distinct a) AS anchors
    UNWIND anchors AS a
    OPTIONAL MATCH (a)--(b)
    WITH anchors, collect(distinct b) AS neighbours
    WITH [x IN anchors | elementId(x)] + [x IN neighbours WHERE x IS NOT NULL | elementId(x)] AS ids
    RETURN ids AS ids
  `;
  const recs = await run(driver, cypher, params);
  if (!recs.length) return [];
  return recs[0].get('ids');
}

async function section(driver, ids, label, returnClause, extra = '') {
  const cypher = `
    MATCH (n:${label}) WHERE elementId(n) IN $ids
    ${extra}
    RETURN ${returnClause}
  `;
  const recs = await run(driver, cypher, { ids });
  return recs;
}

function fmtTags(tags) {
  const t = toPlain(tags);
  return Array.isArray(t) && t.length ? t.join(', ') : '(none)';
}

function v(x, fallback = '') {
  const p = toPlain(x);
  return p === null || p === undefined || p === '' ? fallback : p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const picked = pickFlag(args);
  if (!picked) {
    console.error('Usage: build-context.js --<project|domain|tag|person|goal|recent> <value>');
    process.exit(1);
  }
  const { flag, value } = picked;
  const driver = getDriver();
  const lines = [];

  try {
    const ids = await collectScope(driver, flag, value);

    lines.push('=== PERSONAL KNOWLEDGE CONTEXT ===');
    lines.push(`Query: --${flag} ${value}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    if (!ids.length) {
      lines.push('(no matching nodes found)');
      lines.push('');
      lines.push('=== END CONTEXT ===');
      console.log(lines.join('\n'));
      return;
    }

    // PROJECTS
    const projects = await section(
      driver,
      ids,
      'Project',
      'n.name AS name, n.status AS status, n.description AS description, n.tags AS tags ORDER BY name'
    );
    lines.push('PROJECTS:');
    if (!projects.length) lines.push('  (none)');
    for (const r of projects) {
      lines.push(
        `* ${v(r.get('name'))} (${v(r.get('status'), 'unknown')}): ${v(r.get('description'), '—')}`
      );
      lines.push(`  Tags: ${fmtTags(r.get('tags'))}`);
    }
    lines.push('');

    // IDEAS
    const ideas = await section(
      driver,
      ids,
      'Idea',
      'n.name AS name, n.domain AS domain, n.status AS status, n.description AS description ORDER BY name'
    );
    lines.push('IDEAS:');
    if (!ideas.length) lines.push('  (none)');
    for (const r of ideas) {
      lines.push(
        `* ${v(r.get('name'))} (${v(r.get('domain'), 'general')}, ${v(r.get('status'), 'open')}): ${v(r.get('description'), '—')}`
      );
    }
    lines.push('');

    // RULES & CONSTRAINTS
    const rules = await section(
      driver,
      ids,
      'Rule',
      'n.name AS name, n.type AS type, n.jurisdiction AS jurisdiction, n.summary AS summary, n.confidence AS confidence ORDER BY name'
    );
    lines.push('RULES & CONSTRAINTS:');
    if (!rules.length) lines.push('  (none)');
    for (const r of rules) {
      lines.push(
        `* ${v(r.get('name'))} (${v(r.get('type'), 'rule')}, ${v(r.get('jurisdiction'), 'n/a')}): ${v(r.get('summary'), '—')}`
      );
      lines.push(`  Confidence: ${v(r.get('confidence'), 'unknown')}`);
    }
    lines.push('');

    // PEOPLE
    const people = await section(
      driver,
      ids,
      'Person',
      'n.name AS name, n.role AS role, n.organization AS organization, n.contact_info AS contact, advised',
      'OPTIONAL MATCH (n)-[:ADVISED_ON]->(t) WITH n, collect(t.name) AS advised'
    );
    lines.push('PEOPLE:');
    if (!people.length) lines.push('  (none)');
    for (const r of people) {
      const advised = toPlain(r.get('advised')) || [];
      lines.push(
        `* ${v(r.get('name'))} (${v(r.get('role'), 'contact')} at ${v(r.get('organization'), 'n/a')}): ${v(r.get('contact'), '—')}`
      );
      lines.push(`  Advised on: ${advised.length ? advised.join(', ') : '(none recorded)'}`);
    }
    lines.push('');

    // ORGANIZATIONS
    const orgs = await section(
      driver,
      ids,
      'Organization',
      'n.name AS name, n.type AS type, n.purpose AS purpose ORDER BY name'
    );
    lines.push('ORGANIZATIONS:');
    if (!orgs.length) lines.push('  (none)');
    for (const r of orgs) {
      lines.push(`* ${v(r.get('name'))} (${v(r.get('type'), 'org')}): ${v(r.get('purpose'), '—')}`);
    }
    lines.push('');

    // RESOURCES
    const resources = await section(
      driver,
      ids,
      'Resource',
      'n.title AS title, n.type AS type, n.summary AS summary, n.url AS url ORDER BY title'
    );
    lines.push('RESOURCES:');
    if (!resources.length) lines.push('  (none)');
    for (const r of resources) {
      lines.push(
        `* ${v(r.get('title'))} (${v(r.get('type'), 'resource')}): ${v(r.get('summary'), '—')} — ${v(r.get('url'), 'no url')}`
      );
    }
    lines.push('');

    // SOURCES & PROVENANCE (the INFORMS lane — files, repos, Notion pages)
    const sources = await section(
      driver,
      ids,
      'Source',
      'n.title AS title, n.source_kind AS kind, n.url AS url, n.file_path AS file_path ORDER BY title'
    );
    lines.push('SOURCES & PROVENANCE:');
    if (!sources.length) lines.push('  (none)');
    for (const r of sources) {
      const loc = v(r.get('url'), '') || v(r.get('file_path'), '') || 'no location';
      lines.push(`* ${v(r.get('title'))} (${v(r.get('kind'), 'source')}): ${loc}`);
    }
    lines.push('');

    // RECENT INSIGHTS
    const insights = await section(
      driver,
      ids,
      'Insight',
      'n.summary AS summary, n.session_id AS session_id, n.created_at AS created_at ORDER BY created_at DESC'
    );
    lines.push('RECENT INSIGHTS:');
    if (!insights.length) lines.push('  (none)');
    for (const r of insights) {
      lines.push(
        `* ${v(r.get('summary'), '—')} (session: ${v(r.get('session_id'), 'n/a')}, ${v(r.get('created_at'), 'n/a')})`
      );
    }
    lines.push('');

    // SKILLS
    const skills = await section(
      driver,
      ids,
      'Skill',
      'n.name AS name, n.category AS category, n.proficiency AS proficiency ORDER BY name'
    );
    lines.push('SKILLS:');
    if (!skills.length) lines.push('  (none)');
    for (const r of skills) {
      lines.push(
        `* ${v(r.get('name'))} (${v(r.get('category'), 'general')}): ${v(r.get('proficiency'), 'unknown')}`
      );
    }
    lines.push('');

    lines.push('=== END CONTEXT ===');
    console.log(lines.join('\n'));
  } finally {
    await driver.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
