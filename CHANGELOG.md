# Changelog

The plain-English story of Engram. Each version starts with a **TL;DR** anyone
can follow, then the technical details underneath.

> **What is Engram, in one breath?** A memory for an AI assistant. It remembers
> your projects, notes, and decisions as connected facts it can search and reason
> over across conversations — and it keeps an *honest history* instead of quietly
> forgetting or overwriting things.

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
