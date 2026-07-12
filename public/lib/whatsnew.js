// whatsnew.js — pure logic for the one-time "what's new" announcement (upgrades P2).
//
// Zero network by design: the CHANGELOG ships inside the published package and the
// last-seen version lives in localStorage, so the announcement never phones home.

// The newest RELEASED section's plain-English TL;DR from CHANGELOG.md ([Unreleased]
// is skipped — it describes what hasn't shipped). Returns null when the changelog is
// missing or unparseable — callers degrade to no announcement, never throw.
export function parseChangelogTldr(md) {
  if (!md || typeof md !== 'string') return null;
  const head = md.match(/^## \[(?!Unreleased)[^\]]+\][^\n]*\n/m);
  if (!head) return null;
  // The section runs from the header to the next `## [` header (or the end).
  const section = md.slice(head.index + head[0].length).split(/\n## \[/)[0];
  const t = section.match(/\*\*TL;DR[^:*]*:?\*\*:?\s*([\s\S]*?)(?=\n\n|$)/);
  if (!t) return null;
  const text = t[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return text || null;
}

// Announce only on a version CHANGE. First contact (no stored version) records
// silently — a brand-new user has no "previous version" to be updated from.
export function shouldAnnounce(lastSeen, current) {
  return Boolean(lastSeen && current && lastSeen !== current);
}

// One-line toast copy: version + a bounded slice of the TL;DR (word boundary, ~max
// chars). tldr may be null → version-only copy.
export function announceCopy(version, tldr, max = 150) {
  const head = `Updated to ${version}.`;
  if (!tldr) return head;
  if (tldr.length <= max) return `${head} ${tldr}`;
  const cut = tldr.slice(0, max).replace(/\s+\S*$/, '');
  return `${head} ${cut}…`;
}
