# Engram

**An agent-maintained, bi-temporal knowledge graph for AI memory.** Neo4j is the
canonical truth; Notion and your local files are capture lanes; an AI agent
ingests, maintains, and consults the graph across sessions.

> 📖 The full write-up — why this beats a Notion-only or Neo4j-only workflow, and
> where it differs from off-the-shelf agent-memory frameworks — lives at
> **[ulrictodman.com/engram](https://ulrictodman.com/engram)**.

MIT licensed. No vendor, no framework to outgrow — plain Neo4j + Node scripts +
git. You can read every line. New here? The [CHANGELOG](CHANGELOG.md) tells the
story in plain English.

**npm:** published as **[`engram-kg`](https://www.npmjs.com/package/engram-kg)** —
`npx engram-kg <command>` or `npm install -g engram-kg` (the bare `engram` was
taken). Full setup (docker-compose Neo4j, schema, demo) is clone-and-run; see
[Quickstart](#quickstart).

---

## Start here

**New to all this?** There's a friendly, plain-English walkthrough — no prior knowledge assumed —
at **[ulrictodman.com/engram/getting-started.html](https://ulrictodman.com/engram/getting-started.html)**.
It has two clearly-signposted tracks:

- **You use Notion + Claude (no terminal).** The friendliest path: connect Claude to Notion, make
  one home page, and *ask Claude* to set things up. No token, no code.
- **You're comfortable in a terminal.** The CLI path below — clone, `.env`, one `npm` command.

The rest of this README is the developer reference. If words like *knowledge graph* are new, start
with the walkthrough — it explains the *what* and *why* before the *how*.

## The problem

- **Notion** is a great capture surface and a poor reasoning surface — it can't
  traverse relationships or answer "what across all my work connects to X?"
- **A graph database** reasons beautifully but nobody journals into Cypher daily.
- **Most "AI memory"** is an opaque vector blob: you can't see *why* it believes
  something, and you can't correct it.

Engram keeps the strengths and drops the weaknesses: **capture where it's natural
(Notion, plain files), query where it's powerful (a graph), and let an agent keep
it honest.**

## What makes it different

- **Two capture lanes, one canonical graph.** A Notion lane and a filesystem lane
  (Markdown, text, PDF, Word, PowerPoint) both feed the same Neo4j graph. Capture
  anywhere; the facts converge.
- **Deterministic, LLM-free change-gating.** Hash/timestamp probes find only what
  actually changed, so the agent never re-reads unchanged content. Cheap and
  reproducible.
- **Provenance on every fact.** Every node ingested from a source gets a
  `Source → INFORMS` edge, so you can always trace *why* the graph believes
  something.
- **Invalidate, don't delete (bi-temporal).** Superseded facts get a `valid_until`
  and a `superseded_by` instead of being erased — history is kept and
  contradictions resolve by recency.
- **Lint-enforced integrity.** Rules become checks: `npm run lint:graph` fails on
  orphans, undated nodes, unlinked insights/sources, and off-vocabulary tags, so
  the graph can't silently rot.
- **Duplicate-resistant across sessions.** `MERGE` dedupes on an exact key, but two
  sessions can name the same entity differently — and then `MERGE` *creates* a parallel
  node instead of preventing one. Engram closes that gap from both ends: `add-node`
  warns before it writes when a new node shares an identity signal (`repo_url`, `url`,
  `file_path`, …) or closely resembles an existing one, and `lint:graph`'s
  `likely-duplicate-entity` check catches any that slip through. Alternate names live on
  the canonical node as searchable `aliases`.
- **Agent-native.** Built so an LLM can resume exactly where it left off
  (`npm run resume`) and tend the graph itself, not as a bolt-on. New projects ship
  `.claude/` hooks that re-inject the "consult the graph first" rule every turn — so it's
  *enforced*, not relied on from memory. **Honest cost:** ~40 tokens of context per turn
  (the full rule is paid once per session); review or disable via `/hooks`.
- **Decisions reach humans, not just the graph.** A captured decision is a graph fact a person
  can't casually read, so docs can rot *behind* a rich graph. `npm run review:decisions` flags any
  decision with no Notion page / README / site refreshed since — capture isn't done until it's in
  *both* the graph and a place a human reads.

- **Hybrid retrieval.** `search` fuses three lanes — keyword (BM25), **semantic**
  (local embeddings, no API), and the graph — into one ranked, explainable result.
  The semantic lane is opt-in and on-device (see below).

**Honest note:** the semantic lane runs a *small on-device model*
(`bge-small-en-v1.5`, 384-d) — excellent for personal-scale recall and fully
owned, but it's not a hosted, billion-param reranker. That's the deliberate
trade: transparency and zero lock-in over raw leaderboard score.

## Architecture

```
   ┌── Notion pages ──┐         ┌── Local files ──┐
   │  (notion-index)  │         │ (document-index)│   ← deterministic change-gates
   └────────┬─────────┘         └────────┬────────┘
            │  extract (agent)           │
            ▼                            ▼
        ┌──────────────────────────────────┐
        │      Neo4j — the canonical graph  │   Source ─INFORMS→ entities
        │  Person Org Project Idea Rule …   │   Insight ─ABOUT→ Project/Idea/Goal
        │  + bi-temporal valid_until        │   Insight ─DERIVED_FROM→ Source
        └──────────────┬───────────────────┘
                       │
   lint:graph · resume · supersede · export (git backups)
```

## Quickstart

```bash
git clone https://github.com/ricksinclair/engram.git && cd engram
npm install
cp .env.example .env                       # local-only Neo4j creds, fine as-is
docker compose up -d                       # Neo4j at http://localhost:7474

# create the schema + load the synthetic demo graph
cat scripts/seed-schema.cypher examples/seed-demo.cypher \
  | docker exec -i engram-neo4j cypher-shell -u neo4j -p engram-local

npm run lint:graph                         # 0 errors (1 warning is expected — see below)
npm run context -- --project Acme          # assemble a context block
npm run search -- "bi-temporal"            # ranked full-text search
npm run review:supersession                # surface candidate stale facts
```

> The demo deliberately ships one **superseded** fact (a REST→GraphQL decision), so
> `lint:graph` reports a single `expired-fact-still-presented` **warning** — that's the
> bi-temporal check working, not an error. Warnings never fail the run.

**Optional — turn on semantic search:** `search` is keyword-only until you embed.
To enable the hybrid (keyword + semantic) lane, install the local embedder and
backfill once:

```bash
npm install @xenova/transformers   # optional dep; downloads a small model on first run
npm run embed                      # local bge-small-en-v1.5, no API — writes vectors
npm run search -- "how do I make money from this"   # now hybrid; finds concepts, not just words
```

To point it at your own knowledge: copy `examples/notion-ids.example.json` and
`examples/document-sources.example.json` up to the repo root (dropping `.example`),
edit them, and run the ingestion scripts. See
[ulrictodman.com/engram](https://ulrictodman.com/engram) for the full workflow.

## Skills — what you can just *do*

Everything Engram does is a **skill you reach for in plain language**. If you use Claude with the
Notion connection, *just ask* — no token, no terminal (the agent follows the recipes in
[`skills/`](skills/) over the MCP). Prefer the keyboard? Every skill has a one-line command. Same
result; pick your lane.

| Skill | Just ask Claude… | …or run |
|-------|------------------|---------|
| **Stand up a project** — Notion workspace + graph + repo `CLAUDE.md`, in one move | *"Set up a new Engram project called Acme."* | `npm run new:project -- --name "Acme"` |
| **Refresh the whole graph** — re-ingest changed Notion + files, surface insights, check, back up | *"Run a graph-sync."* | `npm run resume` · `lint:graph` · `export` |
| **Find anything by meaning** — keyword + semantic, blended and ranked | *"Search Engram for how this makes money."* | `npm run search -- "how do I make money"` |
| **Pick up where you left off** — a "where were we" brief across every project | *"Where were we?"* | `npm run resume` |
| **Keep it honest** — retire a replaced fact (marked superseded, never deleted) | *"Retire the old pricing decision; it changed."* | `npm run review:supersession` · `supersede` |
| **Surface undocumented decisions** — decisions that live only in the graph, never written up for a human | *"Which decisions aren't written up yet?"* | `npm run review:decisions` |
| **Assemble context to paste** — a clean, scoped context block | *"Give me the context block for Acme."* | `npm run context -- --project Acme` |

The full command reference is just below. The "ask Claude" recipes live in
[`skills/`](skills/) ([`new-project`](skills/new-project.md), [`graph-sync`](skills/graph-sync.md)).

## The toolkit

| Command | What it does |
|---------|--------------|
| `npm run new:project -- --name "X"` | Stand up a whole project at once: the Notion operations workspace (Kanban + Documentation Index + Changelog + Test Run Metrics + Problem Tests + status pages), a `Project`+`Goal` in the graph, `notion-ids.json`, and a repo `CLAUDE.md`. Graph + operations, one command. Needs `NOTION_TOKEN` + `NOTION_PARENT_PAGE_ID`; `--dry-run` to preview. |
| `npm run setup:notion -- --name "X"` | Just the Notion operations workspace (no graph/CLAUDE.md). |
| `npm run lint:graph` | Integrity backstop — orphans, undated nodes, unlinked insights/sources, off-vocabulary `source_kind`, likely-duplicate entities. Exit 1 on any error. |
| `npm run add -- <type> --name "X" [--aliases "a,b"] [--force]` | MERGE-add any node. Guards against semantic duplicates before writing (shared identity signal or look-alike name); `--aliases` records alternate names; `--force` skips the guard. |
| `npm run search -- "<query>"` | **Hybrid search** — keyword (BM25) + semantic (local embeddings) fused via RRF, ranked, bi-temporal-aware, with provenance. Degrades to keyword-only if not embedded. |
| `npm run embed` | Backfill semantic embeddings (local `bge-small-en-v1.5`, no API). Needs the optional `@xenova/transformers` dep; run once, then `search` goes hybrid. |
| `npm run resume` | Cross-session "where were we" brief. |
| `npm run context` | Assemble a pasteable context block (`--project`, `--domain`, `--tag`, …). |
| `npm run supersede` | Invalidate a fact bi-temporally (never deletes). |
| `npm run review:supersession` | Surface candidate stale facts for human review. |
| `npm run review:decisions` | Surface decisions captured in the graph but not yet in any human-readable surface (Notion / README / site). Lists candidates to write up; never edits. |
| `npm run check:notion` | Validate the Notion ID manifest before IDs rot. |
| `npm run index` / `doc-index` | Deterministic "what changed?" probes (Notion / local files). |
| `npm run export` / `import` | Versioned JSON backups in git. Embeddings are excluded (they're large and regenerable) — re-run `embed` after a restore. |

## Two ways to set it up

Pick the path that matches how you work — both end up at the same [one-root structure](#notion-setup-one-root-authorize-once):

- **Claude + the Notion MCP (no token).** If you already use Claude with the Notion connection,
  just ask it to set things up — it builds the workspace, registers the project in the graph, and
  writes your `CLAUDE.md` directly over the MCP. **No integration token, no terminal.** Point it at
  the recipes in [`skills/`](skills/) — [`new-project`](skills/new-project.md) and
  [`graph-sync`](skills/graph-sync.md). *Best for non-technical users.*
- **Token / CLI (headless, CI, or no Claude).** Create a Notion integration token, set
  `NOTION_TOKEN` + `NOTION_PARENT_PAGE_ID` in `.env`, and run `npm run new:project -- --name "X"`.
  Deterministic and scriptable. *Best for developers and automation.*

## Notion setup: one root, authorize once

The Notion side follows a single rule: **one neutral root page is the home for _all_ your
projects**, and you authorize the integration on it exactly once.

1. Make one page in Notion — call it "Projects" or "Workspace" (not any single project's page).
2. Share it with your integration once (page ••• → **Connections**), and set
   `NOTION_PARENT_PAGE_ID` to its id.
3. Run `new-project` (or `setup-notion`) per project. Each project's workspace, its five
   databases, and a `Capture` page all nest **under** that root and **inherit access
   automatically** — you never share another page, however many projects you add.

Notes you want ingested go under the root (every project gets a `Capture` page for exactly
this), so the capture lane reads them with no extra setup. It mirrors the graph, which
already holds every project in one place.

> **Trade-off:** one root + one token = one authorization, but a leaked token reaches
> everything under the root. For sensitive or client projects, give them a *separate* root
> and token.

## Layout

```
scripts/        the toolkit (Node, dependency-light)
  lib/vocab.js  the closed source_kind vocabulary (single source of truth)
queries/        a Cypher playbook (orphans, provenance, goal gaps, …)
examples/       seed-demo.cypher + *.example.json configs
docs/           the explainer site (served at ulrictodman.com/engram)
seed-schema.cypher  uniqueness constraints
docker-compose.yml  local Neo4j
```

## Roadmap

**Landing in the next release:** a **doc-drift review** (`review:docs`) that flags
Engram's own describing pages when they fall behind what's shipped — the stale-doc
problem this project is, ironically, built to prevent. See the
[CHANGELOG](CHANGELOG.md).

The throughline of the recent work has been making this effortless for **non-technical Notion +
Claude users**: one root, no token required, a friendly front door. That arc is now complete —
see the [Getting Started walkthrough](https://ulrictodman.com/engram/getting-started.html).

*(Recently done: [#2 tests](https://github.com/ricksinclair/engram/issues/2), [#3 one root](https://github.com/ricksinclair/engram/issues/3), [#4 two setup paths](https://github.com/ricksinclair/engram/issues/4), [#6 agent recipes](https://github.com/ricksinclair/engram/issues/6), [#7 skills showcase](https://github.com/ricksinclair/engram/issues/7), [#5 welcoming onboarding](https://github.com/ricksinclair/engram/issues/5). New ideas welcome — [open an issue](https://github.com/ricksinclair/engram/issues).)*

## Credits

Built by [Ulric Todman](https://ulrictodman.com). Patterns informed by the 2026
agent-memory landscape (Graphiti/Zep, Mem0, Letta) — this is the transparent,
fully-owned, multi-modal take. PRs and ideas welcome.
