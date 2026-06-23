// Pure helpers for the markdown save endpoint. No IO here — the endpoint does fs/git;
// these functions make path-sandboxing, kind-gating, content-hashing and the git argv
// shapes unit-testable exactly as shipped (mirrors lib/source.js / lib/filelock.js).
import crypto from 'node:crypto';
import { detectKind, isWithinRoots } from './source.js';

// sha256 over the exact UTF-8 bytes — MUST match scripts/document-index.js
// (sha256(fs.readFileSync(path)) over raw bytes) so a save doesn't make the next graph
// sync see spurious churn. Do not add/strip newlines; preserve the text verbatim.
export function hashText(text) {
  return crypto.createHash('sha256').update(Buffer.from(String(text == null ? '' : text), 'utf8')).digest('hex');
}

// Validate a save request purely. roots = SOURCE_ROOTS, maxBytes = SOURCE_MAX_BYTES.
// Markdown only (Rick's scope): the editor never touches text/csv/xlsx/pdf/binaries.
export function validateSave({ path: fp, text, roots = [], maxBytes = Infinity } = {}) {
  if (!fp) return { ok: false, error: 'path required' };
  if (!isWithinRoots(fp, roots)) return { ok: false, error: 'outside the read sandbox' };
  if (detectKind(fp) !== 'markdown') return { ok: false, error: 'only markdown files are editable' };
  if (typeof text !== 'string') return { ok: false, error: 'text required' };
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, error: 'file too large' };
  return { ok: true };
}

// git argv builders (the endpoint runs execFileSync). Commits are scoped to the single
// file (pathspec `-- <fp>`) so a save never sweeps unrelated WIP into history, and
// --no-verify so a formatter pre-commit hook can't rewrite bytes and desync the hash.
export const gitArgs = {
  repoRoot: (dir) => ['-C', dir, 'rev-parse', '--show-toplevel'],
  // porcelain status of one path → non-empty output means uncommitted (modified/untracked).
  status: (repo, fp) => ['-C', repo, 'status', '--porcelain', '--', fp],
  add: (repo, fp) => ['-C', repo, 'add', '--', fp],
  commit: (repo, msg, fp) => ['-C', repo, 'commit', '--no-verify', '-m', msg, '--', fp],
  headRev: (repo, fp) => ['-C', repo, 'log', '-1', '--format=%H', '--', fp],
  // %x1f = unit separator, keeps subjects with spaces parseable; %cI = committer ISO date.
  log: (repo, fp, max = 50) => ['-C', repo, 'log', `--max-count=${max}`, '--format=%H%x1f%cI%x1f%s', '--', fp],
  show: (repo, relpath, rev) => ['-C', repo, 'show', `${rev}:${relpath}`],
};

// Parse `git log --format=%H%x1f%cI%x1f%s` output into [{ rev, date, subject }].
export function parseLog(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [rev, date, ...rest] = l.split('\x1f');
      return { rev, date, subject: rest.join('\x1f') };
    })
    .filter((e) => e.rev);
}

export function commitMessage(relpath, kind = 'edit', shortRev = '') {
  return kind === 'restore'
    ? `studio: restore ${relpath} to ${shortRev}`
    : `studio: edit ${relpath}`;
}
