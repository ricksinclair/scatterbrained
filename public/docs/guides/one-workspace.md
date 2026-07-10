---
order: 1
---

# One workspace — the loop

Every surface in Scatterbrained is a different **altitude over the same graph**,
not a separate app. The point of the design is that you never leave: seeing,
understanding, scheduling, reading, reviewing code, running an agent, and
capturing what you learned all happen in one window, and every one of them
reads and writes the same memory.

## The spine: See → Understand → Act

```
Constellation  (framed to what you touched last session)
   → Resume card   ("where was I": freshness, goals, due, blocked)
      → Dock rails  (What's new · Needs review · Due/Overdue · Goals)
         → Inspector  (read: facts, relations, provenance · curate: pin, note, schedule)
            → Report   (deep read + live relations map + export)
               → Code lens  (review the changes an agent made, as graph memory)
                  → Agents   (launch the next session with the graph as its brief)
   ↺ the next session's Resume card starts exactly here
```

## A day in the loop

1. **Re-enter.** Open the Studio. The constellation frames what you touched
   last, and the Resume card answers "where was I" — sync freshness, active
   goals, what's due, what's blocked.
2. **Triage.** Scan the dock: *What's new* (did the last session record the
   right conclusions?), *Needs review* (pending protected-fact changes, notes
   waiting for action, unreviewed commits), *Due/Overdue* (the intention
   clock — see [Time & the intention clock](time-and-calendar.md)).
3. **Understand.** Click anything. The inspector composes itself from what the
   node *is* — key facts, typed relations, provenance, body, history — and
   every file it references opens **in place** in the right
   [viewer](viewers.md). Promote to a full report for a deep read with a live
   relations map, then export it.
4. **Curate.** Pin a fact that must survive rewrites, jot a
   [note](notes-and-capture.md), set a date, wire a missing edge by typing.
   This is you tending the memory the next session will resume from.
5. **Act.** Open the [Code lens](code-lens.md) to review what an agent
   changed — comments become graph memory, not chat scroll. Or launch the next
   agent session from the [Agents lens](agents-and-slipway.md): it starts with
   a brief compiled *from the graph*, works in an in-browser terminal, and its
   session can be captured back as provenance.
6. **Close the loop.** Capture conclusions, and next time the Resume card
   picks up exactly here.

## Why one workspace

Context-switching is where knowledge dies. A calendar app doesn't know your
goals; a code-review tool doesn't know the decision that motivated the change;
a chat log doesn't know which of its conclusions you kept. Because every
Scatterbrained surface is a lens over one graph:

- a due date set in the inspector shows up in the agenda, the Daily Brief, and
  the out-of-band digest — one write, every reader;
- a code-review comment is ABOUT the same project node your goals point at;
- the assistant ([voice or MCP](mcp-and-voice.md)) answers from the same nodes
  you're looking at — and its saved charts re-run live, everywhere.

You can leave — everything is exportable, and the graph is your own Neo4j —
but you shouldn't have to.
