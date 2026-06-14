# Query Playbook

Saved, known-good Cypher for the questions we ask the graph every session. Paste any of
these into **Neo4j Browser** (http://localhost:7474 · `neo4j` / `engram-local`) or run them
via the scripts. They also serve as few-shot examples for an NL→Cypher (Text2Cypher) layer later.

| File | Answers |
|------|---------|
| `whats-new.cypher` | What conclusions were reached most recently? |
| `goal-status.cypher` | What are my goals and what's working toward them? |
| `rules-for-project.cypher` | Which law Rules constrain a given project/idea? |
| `project-neighborhood.cypher` | Show everything connected to a project (the visual map). |
| `orphans.cypher` | What's disconnected / invisible to traversal? (also in `lint:graph`) |
| `provenance.cypher` | Where did a given Insight come from, and what informs it? |

Convention: keep these parameter-free or use `$param` with a comment showing a sample value,
so they're copy-paste runnable.
