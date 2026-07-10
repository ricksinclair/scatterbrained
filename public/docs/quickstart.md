# Quickstart

Get from zero to a living constellation in about two minutes.

## Requirements

- **Node 18+**
- **Docker** (the Studio auto-starts a Neo4j for you) — or your own **Neo4j 5**

## Run it

```sh
npm install
npm start          # → http://localhost:4317
```

`npm start` finds a Neo4j at `NEO4J_URI` — or spins one up in Docker — applies the
schema, loads the demo graph on first run, and launches the Studio.

To connect **your own** graph instead, set the environment and it leaves its demo
data untouched:

```sh
NEO4J_URI=bolt://localhost:7687 NEO4J_PASSWORD=your-password npm start
```

## First five minutes

1. **Take the tour** — Help ▸ *Take a tour* (or open `http://localhost:4317/#tour`).
   Short per-surface tours for each lens live in the same menu.
2. **Press ⌘K** — the command palette reaches every surface, node, and action.
3. **Click any node** — the inspector builds itself from what the node is: sources,
   typed relations, body, history.
4. **Open the Docs rail** (press `d`) — you are reading it right now. Once you ingest
   your own markdown, every project gets this same doc site for free.
5. **Capture something** — drop a link or jot a note on any node; it becomes a
   first-class, connected card.

## Where things live

- Your graph stays in **your Neo4j**; your files stay on **your disk**. Nothing
  leaves the machine — the optional AI layer talks only to a local runtime.
- The Studio is one small Node server + a vanilla-JS frontend: no build step,
  no framework, one real dependency (`neo4j-driver`).

Next: [What Scatterbrained is](overview.md) for the concepts,
[One workspace — the loop](guides/one-workspace.md) for how the surfaces fit
together, or the [guides](guides/document-roots.md) for granting folders,
themes, and the assistant.
