# Changelog

The plain-English story of Engram. Each version starts with a **TL;DR** anyone
can follow, then the technical details underneath.

> **What is Engram, in one breath?** A memory for an AI assistant. It remembers
> your projects, notes, and decisions as connected facts it can search and reason
> over across conversations — and it keeps an *honest history* instead of quietly
> forgetting or overwriting things.

## [1.4.0] — Recipes you can just ask for, and a graph that keeps itself honest

**TL;DR (explain-like-I'm-5):** A big bundle. Engram now (1) lets you **just ask
Claude** to do things — no terminal — right alongside every command; (2) **notices
when its own notes and pages fall behind** what actually shipped; (3) keeps **all
your projects under one Notion home** you set up once; (4) ships a **welcoming,
plain-English Getting Started**; and (5) hands the AI sharper habits — check the
graph *first* for memory, treat it as the source of truth, and keep it *fully* in
sync, not half.

**Technical**
- `review:docs` (`review-doc-staleness.js`) — surfaces, per project, the *describing*
  artifacts (its Notion page, README, the live site) that predate a recent conclusion
  (a new `Insight` about that project). Scoped to one project it's a short, actionable
  re-read list; the global run is a broad audit. Wired into the graph-sync workflow
  (re-read + fix any drift, per worked project).
- **Unit-test suite** (`node --test`, zero new deps) — covers the load-bearing pure
  functions: Notion payload builders, RRF search fusion, the CLAUDE.md template +
  manifest merge, the `source_kind` vocabulary, Notion-ID validation, and CLI dispatch.
  Externals are mocked via `--dry-run`; runs in CI on every push. (#2)
- **One-root Notion model** — documented as the happy path (README + site): one neutral
  root page hosts *every* project, authorized once; each project nests under it and inherits
  access. `setup-notion`/`new-project` now also create a `Capture` page under each workspace
  as a home for ingestible notes. (#3)
- **Two setup paths, documented** — README + site now present the choice: **Claude + Notion
  MCP (no token)** vs the **token / CLI** path. (#4)
- **Agent recipes** (`skills/`) — `graph-sync` and `new-project` as MCP recipes an agent
  follows directly (no token), the no-terminal counterpart to the scripts. Shipped in the
  package. (#6)
- **Skills showcase** — a benefit-led "what you can just *do*" section (README + site §05):
  each skill paired as *"just ask Claude…"* (MCP path) alongside its one-line command (CLI path),
  the no-terminal/terminal split made scannable for non-technical Notion + Claude users. (#7)
- **graph-sync: run-at-end-of-work trigger** — the `graph-sync` recipe now says explicitly to run
  not only on request but **proactively, at the end of completing any meaningful unit of work**, so a
  finished task's durable conclusions are captured before the session ends (the graph is the
  cross-session resume mechanism). A clarification to the recipe's "when to run," not a behavior
  change to the scripts.
- **Welcoming onboarding** — a dedicated, plain-English **Getting Started** page
  (`docs/getting-started.html`) that takes a brand-new user from nothing to a working setup. Two
  signposted tracks (Notion + Claude / no-terminal *first*, then developer / CLI), a plain-English
  glossary (knowledge graph, capture lane, operations workspace, the one root), numbered steps per
  track, and an honest note about the one-time Neo4j install. README gains a "Start here" on-ramp;
  the site hero + CTA now lead with **Get started →**. (#5)
- **Graph-first recall in the generated `CLAUDE.md`** — `new-project`'s repo template now tells the
  agent the graph is the **primary source of truth for recall**: query it *first* (`resume` /
  `context` / `search`) for any question about work done or decisions made, with **Notion as the
  secondary lane** reached via the `Source` references the graph surfaces — instead of answering
  from memory or searching blind. Makes the agent consult the graph unprompted, not only when asked.
- **"A sync is the full pass" guard in the generated `CLAUDE.md`** — the template now spells out that
  syncing the graph means re-ingesting changed docs + MERGEing a `Source` for *every* new/updated
  artifact (incl. ones the indexer can't see, like `.html`) + `lint:graph` to 0 errors *before*
  backup — not just writing one Insight. Guards against calling a partial sync "done."
- **Housekeeping-vs-decision test in the generated `CLAUDE.md`** — the template now gives the test for
  *what* to capture: "would a future session want to follow this rule or rationale?" If yes it's a
  decision worth an Insight, even when the action that surfaced it is mundane housekeeping; a one-off
  mechanical act or status update is not. Guards against under-capturing real decisions.

## [1.3.0] — Set up a whole project in one command (graph *and* Notion)

**TL;DR (explain-like-I'm-5):** Engram used to give you the AI's *memory* (the graph).
Now it also sets up the place *you* work. Run one command and you get a Notion
workspace ready to go: a to-do board (Kanban), a changelog, a place to track tests,
and a docs index — plus the project is registered in the graph and a settings file
(`CLAUDE.md`) is dropped in your repo. The memory half and the working half, set up
**together**, as one system. (Before, you had to wire all that up yourself.)

**Technical**
- `new-project` (`engram new-project --name "X"`) — orchestrates it end to end:
  creates the Notion operations workspace, MERGEs a `Project` + `Goal` (+ a `Source`
  for the workspace) in the graph, writes/updates `notion-ids.json`, and drops a wired
  repo `CLAUDE.md`. `--dry-run` previews without creating anything.
- `setup-notion` — the Notion-only path: workspace home + 5 databases (Kanban tracker,
  Documentation Index, Changelog, Test Run Metrics, Problem Tests) + Implementation
  Progress & Architecture pages, via the Notion API. Project-agnostic defaults.
- Needs `NOTION_TOKEN` + `NOTION_PARENT_PAGE_ID`.

## [1.2.0] — Hybrid search: it understands *meaning*, not just words

**TL;DR (explain-like-I'm-5):** Picture a giant box of your notes.
- **Before:** you could only find a note by typing the *exact words* on it. Type
  "car" and you'd miss the note that says "automobile."
- **Now:** Engram also understands *what you mean*. Ask *"how do I make money from
  this?"* and it finds your notes about revenue and pricing — even if they never
  say "make money." It groups notes by the *idea*, not just the words.
- **The neat part:** it does this with a small AI brain that runs **on your own
  computer** — nothing is sent to any company, no sign-up, no internet service.
  You choose to turn it on; the system works fine without it.
- The old exact-word search still works — the new "by meaning" search stacks on
  top, and the two are blended so you get the best of both.

**Technical**
- `embed` — backfills 384-dim embeddings (local `bge-small-en-v1.5` via the
  optional `@xenova/transformers`) into a Neo4j `knowledge_vec` vector index. No
  API, no key, no server.
- `search` — now **hybrid**: keyword (BM25) + semantic (vector k-NN) fused with
  Reciprocal Rank Fusion. Ranked, bi-temporal-aware, explainable (shows which
  lane found each hit + its provenance). Degrades to keyword-only if not embedded.
- The embedder is an *optional dependency* — the core stays lightweight.

## [1.1.0] — Keyword search

**TL;DR:** Gave Engram a fast "Find." Type some words, get your most relevant
notes back in ranked order, each with a breadcrumb trail to where the fact came
from. Like Ctrl-F, but ranked and across everything you've stored.

**Technical**
- `search` over a Neo4j full-text (BM25/Lucene) index; ranked, bi-temporal-aware,
  carries provenance (which sources informed each hit).

## [1.0.0] — First public release

**TL;DR:** The foundation. A memory system where an AI assistant writes down what
it learns as *connected* facts ("this project → needs → this skill"), always
remembers *where* each fact came from, and **never silently deletes** — when
something changes, the old fact is marked "replaced" so the history survives.
It even checks itself for mistakes. You capture in Notion or plain files; it all
flows into one graph the assistant can reason over.

**Technical**
- Two capture lanes (Notion + filesystem) → one Neo4j graph; deterministic
  change-gating; provenance edges; bi-temporal invalidation ("invalidate, don't
  delete"); lint-enforced integrity; a dependency-light CLI toolkit. MIT licensed.

---

*Format loosely follows [Keep a Changelog](https://keepachangelog.com); versions
match the [`engram-kg`](https://www.npmjs.com/package/engram-kg) npm releases.*
