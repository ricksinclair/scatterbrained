# Scatterbrained

**A personal, agent-maintained knowledge graph you can *see*.** For the
scatterbrained — a second brain that actually remembers, so every working session
starts where the last one left off. Neo4j as canonical truth; Notion and local files
as capture lanes; an AI agent that ingests and maintains the graph across sessions;
and a visual "observatory" for exploring it.

> 🚧 **In development.** The name and public packaging are being set up; the polished
> release isn't here yet. The code below works today.

---

### A note on the previous name, and prior art

This project was briefly drafted under the name *Engram*. After publishing, I learned
about [**ly-wang19/engram**](https://github.com/ly-wang19/engram) — an open-source
bi-temporal memory engine for LLM agents, published **before** mine and backed by a
paper ([arXiv:2606.09900](https://arxiv.org/abs/2606.09900)). The overlap was real
(the name, the bi-temporal framing, keeping history instead of overwriting it). As
best I can tell it was honest convergence — but they were there first and did the
rigorous, benchmarked work, so I retired the name. If you want a reproducible,
paper-backed memory *engine*, read **theirs** first. Credit where it's due.

This is a different animal: less a benchmarked retrieval engine, more a personal,
*visible*, agent-tended knowledge graph. Hence — **Scatterbrained**.
