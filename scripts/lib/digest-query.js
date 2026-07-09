// digest-query.js — the shared "what's on the intention clock" fetch (#25 P3). One Cypher
// query over the graph's intention dates (due_at / review_at / Goal.target_date) within the
// next 30 days (so all overdue + the coming month). Used by both `scripts/digest.js` (the
// standalone push) and `scripts/resume.js` (the session-start brief). Bucketing/formatting is
// the pure lib's job (public/lib/digest.js); this just returns rows.
import { run, toPlain } from './db.js';

const Q_DIGEST = `
  CALL {
    MATCH (n) WHERE n.valid_until IS NULL AND n.due_at IS NOT NULL AND date(n.due_at) <= date() + duration({days:30})
    RETURN n AS n, 'due' AS kind, toString(date(n.due_at)) AS d
    UNION
    MATCH (n) WHERE n.valid_until IS NULL AND n.review_at IS NOT NULL AND date(n.review_at) <= date() + duration({days:30})
    RETURN n AS n, 'review' AS kind, toString(date(n.review_at)) AS d
    UNION
    MATCH (n:Goal) WHERE n.valid_until IS NULL AND n.target_date IS NOT NULL AND date(n.target_date) <= date() + duration({days:30})
    RETURN n AS n, 'due' AS kind, toString(date(n.target_date)) AS d
  }
  RETURN elementId(n) AS id, coalesce(n.name, n.title, n.summary) AS name,
         head([l IN labels(n) WHERE l <> 'Embeddable'] + labels(n)) AS label,
         kind, d AS date,
         (CASE WHEN n:Project THEN [n.name] ELSE [] END) + [(n)--(p:Project) | p.name] AS projects
  ORDER BY d`;

// Returns [{ id, name, label, kind, date, projects[] }]. `project` (optional) keeps only items
// linked to a Project whose name contains it (case-insensitive).
export async function fetchDigestRows(driver, { project = null } = {}) {
  const recs = await run(driver, Q_DIGEST);
  let rows = recs.map((r) => ({
    id: toPlain(r.get('id')),
    name: toPlain(r.get('name')),
    label: toPlain(r.get('label')),
    kind: toPlain(r.get('kind')),
    date: toPlain(r.get('date')),
    projects: [...new Set((toPlain(r.get('projects')) || []).filter(Boolean))],
  }));
  if (project) {
    const q = String(project).toLowerCase();
    rows = rows.filter((x) => x.projects.some((p) => String(p).toLowerCase().includes(q)));
  }
  return rows;
}
