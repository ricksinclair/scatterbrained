# Notes, capture & protected facts

The write side of the workspace: getting things *into* the graph with as
little ceremony as possible, and making sure what matters survives.

## Notes on anything

Any node takes a freeform note. Notes carry a lifecycle — **raw → cued →
addressed / skipped** — so a note isn't just a sticky: it's an instruction
waiting for a reader. Unresolved notes surface in the *Needs review* dock
rail, and a future session (human or agent) can work the queue and mark each
one addressed.

Notes also **anchor to content**, not just nodes: a line in a text or code
file, a cell / row / column in a spreadsheet, a section of a document, a page
of a PDF. Each viewer shows a gutter affordance; the anchor keeps a snippet of
what it pointed at, so drift is detectable.

## Capture

- **Links & videos** — drop a URL and it becomes a first-class, connected
  card with its provenance recorded; fuzzy-associate it to a project or goal
  by typing.
- **Voice conversations** — a voice session is saved **only when you say so**,
  as a transcript on disk plus a source node linking to what the conversation
  touched.
- **Agent sessions** — a terminal session from the
  [Agents lens](agents-and-slipway.md) can be captured the same way: metadata
  in the graph, transcript on disk, summarize-to-insight as a separate,
  user-triggered step. Nothing is captured automatically.

The common shape: **the artifact stays on your disk; the graph records that
it exists, where it lives, and what it informed.**

## Protected facts

A verified number, date, amount, or citation can be **pinned** to a node.
After that, no rewrite — an LLM polish, a sync pass, a hand edit — can
silently change it: the change is queued in *Needs review* for your explicit
approval, and history is kept either way. Pin the things you'd be angry to
discover quietly altered.

## Writing the graph by typing

Every association field is a fuzzy typeahead over the live graph: type a few
letters, pick the node (or create it), and the edge is wired. Growing the
graph never requires a query — the read side ("the graph draws its own UI")
is matched by a write side that works the same everywhere.
