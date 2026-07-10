# The Code lens

Software projects live in the graph next to everything else — so the Code
lens exists to answer two questions without leaving the workspace: **what is
this codebase?** and **what did the agent just do to it?**

## The code map

Point the lens at a repository and it builds a live map:

- **Ranked hubs, orphans, and cycles** — where the load-bearing files are,
  what nothing imports, and what imports itself back.
- **Per-file impact diagrams** — a UML-style view of what a file touches and
  what touches it, down to **function-level call sites** (including calls
  inside template strings, which plain grep misses).
- Every diagram renders locally and re-themes live with the app.

The map is computed fresh from the working tree — code files are read live,
never ingested into the graph. What *is* durable is what you conclude about
them.

## Graph-native code review

Reviewing AI-assisted changes in a chat window throws the review away.
Here, a review is a **first-class graph artifact**:

- Open a repo **frozen at a commit** in a clean read-only viewer.
- Line comments are graph notes attached to a Review node — they survive the
  session, link to the project they're about, and show up in the project's
  relations.
- The dock's *Needs review* rail flags **unreviewed commits** since the last
  review, so triage finds you instead of the reverse.

The point isn't to replace your forge's PR flow — it's that the *conclusions*
of a review ("this pattern is wrong, we decided X instead") belong in the same
memory the next agent session will read.

## Acceptance criteria

Features carry **testable acceptance criteria** in the graph (an Acceptance
section on the feature's node). Criteria have state — unverified / pass /
fail — changed only by explicit verification events, which a test runner can
POST. A regressed or stale criterion surfaces in *Needs review*. It's the
behavior-side twin of protected facts: expectations that must survive change.

## The loop tie-in

Code lens findings are ABOUT the same project nodes your goals and dates point
at. "12 unreviewed commits" sits in the same dock as "goal due Friday" —
which is the whole argument for [one workspace](one-workspace.md).
