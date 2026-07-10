# Agents & in-browser terminals

The Agents lens is where the workspace stops being a mirror of past work and
starts **doing** work — launching real agent sessions, in real terminals, in
the browser, with the graph as their memory.

## Slipway: the runtime deck

The Studio embeds **Slipway**, a local runtime manager, as a native panel:
start and stop local model runtimes, watch what's actually loaded in memory,
and open **terminal sessions in the browser**. The embed recomposes into the
Studio's own design language and follows the live theme — it reads as one
app, because it is one workspace.

The honesty rule applies here too: the UI only ever names a model that is
**actually resident**. No runtime running means "no model" and a one-click
load — never a pretend badge.

## The Act loop: launch with the graph as the brief

From any project node: **open an agent here**. The Studio compiles a brief
*from the graph* — the project's context, decisions, and conventions — writes
it into the repo sandbox, and launches your coding agent with that brief
loaded into its system prompt. The terminal opens right in the Agents lens,
deep-linked to the session.

That's the payoff of curating memory: the next session doesn't start cold, it
starts from what the graph knows.

## Capture the session back

When a session is worth keeping, capture it: the transcript stays **on
disk**, and the graph gets a session source node — what it was about, where
the transcript lives, which nodes it informed. Summarizing a captured session
into a durable insight is a **separate, user-triggered** step (local
inference lane) — never automatic, so the graph only learns what you decided
it should.

## The full circle

1. Curate memory in the inspector (facts, notes, dates).
2. Launch an agent with that memory as its brief.
3. Watch it work in the in-browser terminal.
4. Review its changes in the [Code lens](code-lens.md) — comments become
   graph memory.
5. Capture the session; summarize the keepers into insights.
6. The next Resume card — and the next agent — starts from everything above.

One workspace, and the agent is inside it, not beside it. See also
[MCP tools & voice](mcp-and-voice.md) for the assistant that drives the
Studio itself.
