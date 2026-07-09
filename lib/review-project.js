// review-project.js — resolve a code-review's repo path to the graph Project it reviews,
// so createReview can materialize (Review)-[:ABOUT]->(Project) and "all reviews for X"
// becomes a plain traversal. Pure — the server owns IO and queries (same discipline as
// lib/agent-sessions.js): takes Review.repo (an absolute local path) plus the graph's
// [{name, repo_url}] Project rows and returns the matching project name, or null.
//
// Resolution tiers (first tier with EXACTLY ONE hit wins; >1 hit at a tier → null,
// because a wrong edge is worse than no edge — no-match just logs softly upstream):
//   1. repo_url IS the same local path (normalized: trailing slash, .git, case).
//   2. repo basename == repo_url's repo name — handles https://github.com/u/name(.git),
//      git@host:u/name(.git), and local-path repo_url forms.
//   3. repo basename == Project.name (case-insensitive) — covers projects whose
//      repo_url is unset or points elsewhere (e.g. the knowledge repo itself).

const norm = (s) => String(s || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '');
const basename = (p) => { const n = norm(p); return n.slice(n.lastIndexOf('/') + 1); };

// Repo name from a repo_url in any of its live forms (https URL, git@ SSH, local path).
// SSH form has no scheme — take everything after the last ':' before basenaming.
function repoNameOf(url) {
  const n = norm(url);
  if (!n) return '';
  const tail = n.includes(':') && !n.startsWith('/') ? n.slice(n.lastIndexOf(':') + 1) : n;
  return basename(tail);
}

export function resolveReviewProject(repoPath, projects = []) {
  const path = norm(repoPath);
  if (!path) return null;
  const base = basename(path).toLowerCase();
  const tiers = [
    (p) => p.repo_url && norm(p.repo_url).toLowerCase() === path.toLowerCase(),
    (p) => p.repo_url && repoNameOf(p.repo_url).toLowerCase() === base,
    (p) => String(p.name || '').trim().toLowerCase() === base,
  ];
  for (const matches of tiers) {
    const hits = projects.filter((p) => p && matches(p));
    if (hits.length === 1) return hits[0].name;
    if (hits.length > 1) return null;   // ambiguous — never guess a wrong project
  }
  return null;
}
