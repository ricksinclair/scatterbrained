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
- **Reports & exports** — turn any node into a briefing, then export exactly what you see:
  Markdown, self-contained HTML, PDF, or JSON.
- **Ask for a chart** — the assistant answers countable questions with real charts (bar,
  histogram, line, scatter), and "save that" keeps one as a **living lens** that re-runs its
  query on every open.
- **Docs lens + live diagrams** — ingested markdown reads like a per-project doc site
  (grouped by audience), with PlantUML architecture diagrams rendered locally and re-themed
  live (optional `plantuml` binary; degrades gracefully without it).
- **A code map you can trust** — ranked hubs/orphans/cycles, per-file impact diagrams with
  function-level call sites (including calls inside template strings), a render-time stamp,
  and stale-tab self-healing.
- **An honest assistant** — the orb only wears a model's name when one is actually loaded;
  otherwise it says "no model" and offers a one-click load through your local runtime.

Take the **guided tour** (Help ▸ Take a tour, or add `/#tour`) — plus short per-surface tours
for each lens from the same menu.

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

### Talk to it — the local AI (Act) plane

Scatterbrained can **see** and **understand** your graph on its own. To **act** — talk to it,
ask it about what's due or stale, capture notes by voice — it uses a local model, served by a
bundled runtime called **Slipway** (in [`slipway/`](slipway/)). Two processes, one install:

1. **It starts itself.** `npm start` autostarts Slipway on `:8765` alongside the Studio. Models
   are **never loaded until you ask**, so an idle runtime costs almost nothing. Opt out with
   `SLIPWAY_AUTOSTART=0`; point `SLIPWAY_DIR` at your own checkout to override the bundled copy.
2. **First run: download one small model.** A fresh machine has no models on disk. Open Slipway
   (the **manage models in Slipway ↗** link in the voice panel, or <http://127.0.0.1:8765>) →
   **Browse** → pull a **small 4-bit MLX model** to start — search `mlx-community`, pick a ~3–4B
   build (~2–3 GB, quick to download, runs on a 16 GB Mac). Save the big
   `mlx-community/Qwen3.6-35B-A3B-6bit` (~28 GB) for when you want maximum quality.
3. **Talk.** Open the voice orb and **hold Space** to speak (release to send), or type. Voice uses
   the browser's built-in speech (Web Speech) by default — **zero setup**. For fully-offline voice,
   optional local Whisper (STT) and Kokoro (TTS) helpers ship in [`bin/`](bin/).
4. **Prefer your Claude subscription?** `bash bin/summon-claude.sh` puts a subscription-billed
   Claude session on the same voice loop over MCP — no API keys, no per-token cost.

Requires Apple Silicon for local MLX models. Ollama models work too if you run Ollama.

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
- **Local AI runtime (Act)** — `slipway/`: a bundled, zero-dependency Python control panel
  (**Slipway**) that serves local models (MLX via `vllm-mlx`, or Ollama) and launches agent CLIs.
  The Studio autostarts it and federates over `127.0.0.1:8765`, so everything — see, understand,
  and act — runs on your machine. Vendored from its own repo; self-contained.

## Develop

- **Studio tests:** `npm run test:studio` (vitest — the pure-function suite).
- **Toolkit tests:** `npm test` (node:test).
- **Graph integrity:** `npm run lint:graph`.

## License

MIT — see [LICENSE](LICENSE).
