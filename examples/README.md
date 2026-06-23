# Demo graph — "Northwind Logistics"

[`seed-demo.cypher`](seed-demo.cypher) is a small, fictional engineering story (~33 nodes, no
personal data) that exercises every Studio feature: protected facts, a superseded decision, a
graph-native code review, captured links, and the calendar/intention clock.

It loads **automatically** the first time you run `npm start`. To load it by hand on a throwaway
Neo4j:

```sh
# 1) start a local Neo4j (or use the bundled docker-compose.yml)
docker compose up -d

# 2) apply the schema, then the demo data
cat ../scripts/seed-schema.cypher | docker exec -i scatterbrained-neo4j \
  cypher-shell -u neo4j -p scatterbrained-local
cat seed-demo.cypher | docker exec -i scatterbrained-neo4j \
  cypher-shell -u neo4j -p scatterbrained-local

# 3) launch the Studio against it
npm run studio
```

`SB_NO_DEMO=1 npm start` skips the auto-seed if you'd rather start from your own graph.

The other files here — [`document-sources.example.json`](document-sources.example.json) and
[`notion-ids.example.json`](notion-ids.example.json) — are templates for the optional
local-document and Notion capture lanes; copy them to the repo root (dropping `.example`) and
edit to your paths.
