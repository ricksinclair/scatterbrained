# What Scatterbrained is

Scatterbrained is a **local-first knowledge observatory**: point it at a Neo4j
graph and *see* your knowledge — a living constellation you can explore,
interrogate, and act on. Everything runs on your own machine; nothing goes to
a cloud.

## The mental model

Your knowledge is **one graph, viewed at many altitudes**:

- **Nodes** are the durable things — projects, ideas, insights, people, goals,
  sources. Each carries a natural key, timestamps, and tags.
- **Sources** are provenance. Every fact ingested from a document or page gets
  a `Source` node with an `INFORMS` edge to what it taught the graph — so you
  can always answer "where did this come from?".
- **Lenses** are ways of looking: the constellation (spatial), the Docs rail
  (reading), the [Time lens](guides/time-and-calendar.md) (agenda, calendar,
  quarters), the [Code lens](guides/code-lens.md) (repositories and reviews),
  the [Agents lens](guides/agents-and-slipway.md) (in-browser terminals),
  saved chart lenses (live queries). Same graph, different zoom.
- **Bi-temporal honesty.** Facts are never silently deleted. A superseded fact
  gets `valid_until` and `superseded_by` — history is kept, and current views
  simply skip what's expired. Protected facts go further: a pinned number,
  date, or citation can't be rewritten without your explicit approval.

## The loop

**See → Understand → Act.**

1. **See** — the constellation shows the whole graph; search, focus, filter,
   time-travel.
2. **Understand** — click any node and the inspector *builds itself* from what
   the node is: sources, typed relations, body, history. Promote it to a full
   report and export exactly what you see.
3. **Act** — capture links and notes, wire nodes together by typing, schedule
   what's due, review code frozen at a commit, launch an agent session in an
   in-browser terminal, ask the assistant for a chart.

How it all fits together as one system — and why you never have to leave the
window — is the [one workspace guide](guides/one-workspace.md).

## What stays on your machine

Everything. Your graph lives in **your Neo4j** (Docker or your own install),
your files stay on **your disk** behind an explicit folder allowlist (see
[Document roots & privacy](guides/document-roots.md)), and the optional AI
layer talks only to a **local** model runtime. Diagrams render through a local
PlantUML binary — never a web service.

## The architecture in one paragraph

The Studio is a single small Node server (`server.js`) plus a vanilla-JS
frontend — **no build step, no framework, one real dependency**
(`neo4j-driver`). UI modules live in `public/lib/`, vendored libraries in
`public/vendor/`, and pure logic is extracted into testable modules. The
server exposes a compact JSON API (`/api/...`), a static file server, and an
optional MCP endpoint for agents (see [MCP tools & voice](guides/mcp-and-voice.md)).
That smallness is deliberate: you can read the whole thing, and customizing it
is editing a file, not fighting a toolchain.
