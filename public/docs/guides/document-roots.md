---
order: 2
---

# Document roots & privacy

The Studio reads files from your disk — markdown it renders, PDFs it previews,
repos it maps. All of that goes through **one explicit allowlist**: the
document roots.

## The sandbox rule

A file is readable only if it lives under a **granted root folder**. Grants
have hard guardrails:

- Folders must be **inside your home directory** — the app can never be
  pointed at `/`, `/etc`, or anywhere outside your own files.
- Symlinks are resolved before every check, so a link inside a granted folder
  can't smuggle a path outside it.
- Reads are capped (512 KB per file) — the inspector never slurps a giant file.

Docs outside the granted roots still *appear* in the Docs lens (nothing is
hidden from navigation) — they show a 🔒 lock and a one-click **grant access**
on-ramp instead of content.

## Granting and revoking folders

- **In the app**: the folder-permissions panel (the lock icon, or the grant
  on-ramp on any blocked doc). Grants take effect live — no restart.
- **On disk**: grants persist in `document-sources.json` at the repo root, as
  a `roots` array of `{ path, tags }` entries (`~` is fine). Edit it by hand
  if you prefer; the same file drives the document-ingestion lane
  (`scripts/document-index.js`), so a granted folder is also an ingestible one.

## What never leaves the machine

- **Your graph** stays in your Neo4j.
- **Your files** are read locally, on demand, from the allowlist — never
  uploaded, never indexed by content into anything external.
- **Diagrams** render through a local `plantuml` binary in a restricted
  process; remote include directives are rejected before rendering.
- **The AI layer** (optional) talks only to a local model runtime. If nothing
  is running locally, the assistant honestly says "no model" rather than
  quietly calling out.
