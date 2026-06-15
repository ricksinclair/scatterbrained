# Changelog

The plain-English story of Engram. Each version starts with a **TL;DR** anyone
can follow, then the technical details underneath.

> **What is Engram, in one breath?** A memory for an AI assistant. It remembers
> your projects, notes, and decisions as connected facts it can search and reason
> over across conversations — and it keeps an *honest history* instead of quietly
> forgetting or overwriting things.

## [Unreleased] — Close the "set and forget" gaps: enforce both reading and writing

**TL;DR (explain-like-I'm-5):** Two fixes so an AI assistant can't quietly let things rot.
**(1) Reading:** Engram kept *telling* the AI "check the memory graph first" — but telling
isn't enforcing, and sometimes it forgot. Now `new-project` drops two tiny **hooks** into a
project that re-show that rule every turn, for ~40 extra words of context (switch off with
`/hooks`). **(2) Writing:** decisions the AI makes were landing only in the graph (which a
person can't casually read), so the human-readable docs could go stale behind a rich graph —
the *opposite* of the problem Engram set out to solve. A new check, `review:decisions`, now
catches any decision that never made it to a human-readable page, so you can write it up.

### Decisions recorded this cycle (dual-write — the human-readable half)
- **Notion change-detection follows the one-root model, not a flat KB database.** `notion-index.js`
  now defaults to `/v1/search` (everything shared with the integration), so connecting it *once* at
  your one-root parent page covers every project subpage — no `NOTION_KB_DATABASE_ID`, no per-page
  sharing. *Why:* the old token path required a single flat database, which fought the one-root +
  Capture-page design that lets non-technical adopters keep everything under one modal page reached
  through the connector. The KB-database mode is kept (set `NOTION_KB_DATABASE_ID`) for legacy
  single-DB setups; the no-token MCP **connector** path stays the default for non-technical users.
- **Enforce graph-first *recall* via hooks, not prose.** A CLAUDE.md line is read once and
  missed; a per-turn hook makes it a check. Cost bounded to ~40 tokens/turn by keeping the
  rationale in a once-per-session block. *Limit:* a hook can't force a tool call — it makes the
  rule hard to miss, not impossible to skip.
- **Enforce decision *documentation* by detection, not auto-prose.** Rather than auto-pushing
  generated text into Notion (boilerplate risk), ship a detector (`review:decisions`) that
  surfaces graph-only decisions for a human-quality write-up. Auto-writer + scheduled sync are
  deferred to a roadmap issue.
- **A decision isn't "captured" until it's in *both* the graph and a human-readable surface.**
  Codified in the generated CLAUDE.md template and the graph-sync skill.
- **The graph→Notion writer is hybrid (detect → draft → human-quality prose → post), not a raw dump.**
  A mechanical `summary`→Notion copy produces boilerplate; the writer instead seeds each entry with
  the Insight's `full_text` for the agent to rewrite as prose, then posts on `--commit`. *Alternatives
  rejected:* a fixed template (deterministic but robotic voice) and capture-time-only authoring (good
  prose but only fires during a sync and is silently skippable). The hybrid reuses the existing
  `review:decisions` detector and stays guarded — Notion is a published surface, so it never posts
  unattended (drafting is the default; posting needs `--commit` + `NOTION_TOKEN` + explicit entries).
- **Ingest `CHANGELOG.md` as a Source by default.** `review:decisions` only credits human
  surfaces tracked as graph Sources, but `CHANGELOG.md` was on the indexer's exclude list — so
  the very file the dual-write rule points you to could never clear a flag. Changelogs are now
  ingested (removed from `excludeFiles`); the requirement is documented in the template and the
  check's output. *Alternative rejected:* leave it excluded and only document the gotcha — too
  easy to trip over for the file dual-write recommends most.
- **Publish the context cost of any standing mechanism — transparency is unconditionally good.**
  A mechanism that injects into the context budget (a hook, a preamble) ships with its measured
  cost: when it's cheap the number is a selling point, when it's expensive it's an honest admission
  — either way the reader is better served. Embodied by the site's measured cost table (recall hooks
  ≈ 139 tokens once + ~40/turn; ~3% worst-case on a 128K window; negligible on 1M).

**Technical**
- **Graph-first hooks** — `new-project` now writes `.claude/settings.json` + two scripts
  under `.claude/hooks/`: a `SessionStart` hook that injects the full graph-first rule once
  (~141 tokens) and a deliberately terse `UserPromptSubmit` hook that re-injects a
  keyword+action nudge every turn (~40 tokens). This moves "consult the graph first" from a
  CLAUDE.md instruction (read once, easily missed) to a deterministic, harness-run check —
  the same *rules-become-checks* principle as `lint:graph`, applied to recall. Per-turn text
  is kept minimal on purpose; the rationale lives in the once-per-session block.
- **`review:decisions`** (`review-undocumented-decisions.js`) — decision-centric drift check:
  for each recent `Insight` ABOUT a project, is there *any* human-readable Source
  (Notion page/workspace, README, live site) refreshed at/after it? Flags both the **stale**
  case and the **absent** case (a decision with no human surface at all — which the doc-centric
  `review:docs` structurally can't see). Never edits; lists candidates. Wired into graph-sync's
  verify phase and the CLAUDE.md template's dual-write rule. Pure `formatReport` is unit-tested.
- **`CHANGELOG.md` ingested by default** — removed from `excludeFiles` in
  `examples/document-sources.example.json` so it lands as a `markdown` Source (already in
  `HUMAN_SURFACES`) and can actually clear a `review:decisions` flag. The requirement —
  the changelog must sit inside a `document-sources.json` root and out of `excludeFiles` — is
  spelled out in the example's `_comment`, the generated CLAUDE.md template, and the check's
  output footer. Closes part 3 of the graph→Notion write-back issue.
- **`writeback`** (`write-back-decisions.js`) — the WRITER half of the write-back gap. Two-step,
  guarded: the default DRAFT pass reuses the `review:decisions` query to emit undocumented decisions
  as candidate Changelog entries (JSON, each seeded with `full_text`); `--commit` reads finalized
  agent-authored entries (`--file` or stdin), appends each as a row to the project's Notion Changelog
  (id from `notion-ids.json`), and marks that Notion surface fresh in the graph so the flag clears.
  Pure `toCandidate` / `buildChangelogProperties` / `changelogId` are unit-tested (6 new tests).
  Wired into the graph-sync skill's verify phase. Closes part 1 of the graph→Notion write-back issue;
  the scheduled full-sync (part 2) is sequenced next, on top of this.

**Technical**
- **Graph-first hooks** — `new-project` now writes `.claude/settings.json` + two scripts
  under `.claude/hooks/`: a `SessionStart` hook that injects the full graph-first rule once
  (~141 tokens) and a deliberately terse `UserPromptSubmit` hook that re-injects a
  keyword+action nudge every turn (~40 tokens). This moves "consult the graph first" from a
  CLAUDE.md instruction (read once, easily missed) to a deterministic, harness-run check —
  the same *rules-become-checks* principle as `lint:graph`, applied to recall. Per-turn text
  is kept minimal on purpose; the rationale lives in the once-per-session block.
- New exports in `new-project.js` (`agentConfigFiles`, `mergeSettings`, `writeAgentConfig`),
  unit-tested: hook scripts emit valid JSON, settings-merge is idempotent and preserves
  unrelated keys, and the per-turn nudge has a size guard so it can't bloat back to the full rule.
- Hook commands use `$CLAUDE_PROJECT_DIR`, so they resolve from any subdirectory of the project.
- **Honest caveat in the docs** — the site (new differentiator *vii*, "Enforced recall — honestly
  costed") and README state the per-turn context cost up front (~40 tokens/turn; full rule once per
  session; disable via `/hooks`). The non-technical Getting Started is left untouched: that path is
  the Notion+MCP lane, which has no hook surface, so the caveat would only confuse it.

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
