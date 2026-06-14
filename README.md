# Engram

**An agent-maintained, bi-temporal knowledge graph for AI memory.** Neo4j is the
canonical truth; Notion and your local files are capture lanes; an AI agent
ingests, maintains, and consults the graph across sessions.

> 📖 The full write-up — why this beats a Notion-only or Neo4j-only workflow, and
> where it differs from off-the-shelf agent-memory frameworks — lives at
> **[ulrictodman.com/engram](https://ulrictodman.com/engram)**.

MIT licensed. No vendor, no framework to outgrow — plain Neo4j + Node scripts +
git. You can read every line.

---

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
- **Agent-native.** Built so an LLM can resume exactly where it left off
  (`npm run resume`) and tend the graph itself, not as a bolt-on.

**Honest limitation:** retrieval here is structural (graph traversal + tags), not
semantic. Vector/keyword recall is the natural next step and isn't built in yet.

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
npm run review:supersession                # surface candidate stale facts
```

> The demo deliberately ships one **superseded** fact (a REST→GraphQL decision), so
> `lint:graph` reports a single `expired-fact-still-presented` **warning** — that's the
> bi-temporal check working, not an error. Warnings never fail the run.

To point it at your own knowledge: copy `examples/notion-ids.example.json` and
`examples/document-sources.example.json` up to the repo root (dropping `.example`),
edit them, and run the ingestion scripts. See
[ulrictodman.com/engram](https://ulrictodman.com/engram) for the full workflow.

## The toolkit

| Command | What it does |
|---------|--------------|
| `npm run lint:graph` | Integrity backstop — orphans, undated nodes, unlinked insights/sources, off-vocabulary `source_kind`. Exit 1 on any error. |
| `npm run resume` | Cross-session "where were we" brief. |
| `npm run context` | Assemble a pasteable context block (`--project`, `--domain`, `--tag`, …). |
| `npm run supersede` | Invalidate a fact bi-temporally (never deletes). |
| `npm run review:supersession` | Surface candidate stale facts for human review. |
| `npm run check:notion` | Validate the Notion ID manifest before IDs rot. |
| `npm run index` / `doc-index` | Deterministic "what changed?" probes (Notion / local files). |
| `npm run export` / `import` | Versioned JSON backups in git. |

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

## Credits

Built by [Ulric Todman](https://ulrictodman.com). Patterns informed by the 2026
agent-memory landscape (Graphiti/Zep, Mem0, Letta) — this is the transparent,
fully-owned, multi-modal take. PRs and ideas welcome.
