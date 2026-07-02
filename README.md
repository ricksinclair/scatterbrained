# Scatterbrained

**A local-first knowledge observatory.** Point it at a Neo4j graph and *see* your
knowledge — a living constellation you can explore, interrogate, and act on.
See → Understand → Act, all on your own machine, no cloud.

> **Alpha.** It runs and demos today. Local-first by design: your graph stays in your
> Neo4j, your files stay on your disk. The Studio is a single small Node server + a
> vanilla-JS frontend — no build step, no framework, one real dependency
> (`neo4j-driver`). The optional AI layer talks only to a local [Ollama](https://ollama.com).

![Scatterbrained Studio — the constellation overview](docs/screenshots/01-overview.png)

## What it does

- **Constellation** — your whole graph as a force-directed map; focus, search, filter, time-travel.
- **Composable inspector** — click any node and the panel *builds itself* from what the node is:
  sources (provenance), typed relations, body/excerpt, and history.
- **Protected facts** — pin a verified number, amount, date, or citation; a later rewrite can't
  silently change it — the change is queued for your approval, bi-temporally (history kept;
  removals are reversible from a "retired" list).
- **Graph-native code review** — review a repo frozen at a commit; line comments live in the graph.
- **A sense of time** — a calendar + intention clock: what's due, what's worth revisiting.
- **Capture** — drop a web link or video and it becomes a first-class, connected card; jot notes
  on any node.
- **File viewers** — Markdown, CSV/sheets, PDF, Word, PowerPoint, rendered in place.
- **Writable graph** — wire two nodes together by typing; edit and save Markdown to disk
  (git-recoverable).
- **Reports** — turn any node into a shareable briefing.

Take the **guided tour** (the ▶ Tour button, top-right, or add `/#tour`) for a ~60-second walk
through all of it.

## Run it

One command. Requires Node 18+ and either Docker (to auto-start Neo4j) or your own Neo4j 5.

```sh
npm install
npm start          # → http://localhost:4317   (add /#tour for the auto-tour)
```

`npm start` finds a Neo4j at `NEO4J_URI` — or spins one up in Docker — applies the schema, loads
the demo graph on first run, and launches the Studio. To use **your own** graph, set
`NEO4J_PASSWORD` (and `NEO4J_URI`) and it connects there instead, leaving its data untouched.

Or install the CLI globally and launch from anywhere:

```sh
npm i -g scatterbrained
scatterbrained studio                 # launch the Studio (auto-Neo4j + demo graph)
scatterbrained capture "a thought"    # drop a note or a URL into the running Studio
scatterbrained status                 # is it up? what's in the graph?
```

The published CLI is intentionally these three commands — what a new user needs.
The full graph toolkit (lint, resume, search, context, new-project, embed,
supersede, …) ships with the repo; clone it and run `npm run <command>`.

Config via env (see [`.env.example`](.env.example)): `NEO4J_URI` (default `bolt://localhost:7687`),
`NEO4J_USER` (`neo4j`), `NEO4J_PASSWORD`, `STUDIO_PORT` (`4317`), `SB_NO_DEMO=1` to skip the demo
seed. To let the file viewers read your documents, list the allowed roots in
`document-sources.json` — the Studio never reads outside them.

## Try the demo

[`examples/`](examples/) is a small, fictional engineering story ("Northwind Logistics") that
exercises every feature — protected facts, a superseded decision, a code review, links, the
calendar. It loads automatically on first `npm start`; see [`examples/README.md`](examples/README.md)
to run it on a throwaway Neo4j by hand.

## What's in the box

- **Studio** — the visual app: `server.js` (a `node:http` BFF over the Neo4j driver) + `public/`
  (a vanilla-JS SPA with a vendored `force-graph`). The inspector is **composable**: a tested
  resolver picks which components a node gets from its content-signals, and a registry renders
  them — the pure logic is the shipped logic.
- **Graph toolkit** — `scripts/`: an agent-maintained, bi-temporal knowledge-graph methodology
  (lint, search, context-assembly, Notion + local-document capture lanes, bi-temporal supersede).
  Clone the repo and run any of it via the `npm run` scripts (`npm run lint:graph`,
  `npm run resume`, `npm run search`, …).

## Develop

- **Studio tests:** `npm run test:studio` (vitest — the pure-function suite).
- **Toolkit tests:** `npm test` (node:test).
- **Graph integrity:** `npm run lint:graph`.

## License

MIT — see [LICENSE](LICENSE).
