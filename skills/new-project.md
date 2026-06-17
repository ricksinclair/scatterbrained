---
name: new-project
description: Stand up a new project in Scatterbrained via the Notion MCP — no token needed. Creates the operations workspace (Kanban, changelog, test tracking, docs index, Capture) under your one root, registers the project in the graph, and writes a repo CLAUDE.md.
---

# new-project (agent recipe — the MCP path)

The **no-token** path: an AI agent (Claude + the Notion + Neo4j MCPs) builds the same thing the
`scatterbrained new-project` *script* builds — but directly over your existing MCP connection, so there's
no integration token to create. End state: graph + Notion + repo, set up together.

> All Notion pieces nest under your single **portfolio root** (see "Notion setup: one root" in the
> README), so they inherit access automatically — no page-by-page sharing.

## 1 — Notion workspace (under the root)
Create, all parented to your root page:
- A page **`<Project> — Workspace`**.
- Under it, **5 databases** — **Development Tracker** (Kanban: Name / Stage / Priority / Module /
  Type / Effort), **Documentation Index**, **Changelog**, **Test Run Metrics**, **Problem Tests**.
  The exact schemas (select options, etc.) are in [`scripts/setup-notion.js`](../scripts/setup-notion.js) — mirror them.
- Under it, pages: **Implementation Progress**, **Architecture**, **Capture** (a home for notes
  you want ingested later).

> **Record the right ids.** When you create a database via the MCP, it returns its **data source**
> id (`collection://…`) — that's what page-creation targets. Save each id in `notion-ids.json`,
> then run `npm run check:notion` to validate. (The token/REST path stores the database id; the
> MCP path uses the data source id — they differ, so capture whichever your path returns.)

## 2 — Register in the graph
`MERGE` a `Project` node (+ a `Goal`, + a `Source` for the workspace), wired with edges
(`(Goal)-[:ACHIEVED_BY]->(Project)`, `(Source)-[:INFORMS]->(Project)`). `MERGE` never `CREATE`;
no orphans.

## 3 — Repo CLAUDE.md
Drop a `CLAUDE.md` in the repo pointing at the Notion IDs and the graph conventions. The template
is `claudeMd()` in [`scripts/new-project.js`](../scripts/new-project.js) — reuse its structure.

That's the whole system stood up from your MCP — identical to the token path, no token required.
