# MCP tools & voice

The Studio can be driven by an AI agent — including by voice — without any
cloud dependency. The design is deliberately **inverted**: the Studio doesn't
call out to a model; it exposes an MCP endpoint, and *your* agent connects in.

## The MCP endpoint

The server ships a Streamable-HTTP **MCP endpoint at `POST /mcp`** (zero extra
dependencies). Any MCP-capable agent — e.g. a Claude Code session you already
pay for — can connect and use the Studio's tools: query the graph, capture
notes, schedule dates, render panels, create diagrams.

Authentication is a bearer token the Studio writes to
`~/.scatterbrained/mcp-token` on first run. Connect an agent by registering
the endpoint with that token; requests without it get a 401.

## Voice mode

Voice is a rendezvous between three parties, all local:

1. **The browser** does speech-to-text and text-to-speech (Web Speech API,
   pluggable behind a provider seam).
2. **The Studio** relays: your utterances queue up; the agent long-polls for
   them.
3. **Your agent** runs the loop: `voice_connect` (reports its model — shown
   honestly in the UI badge) → `voice_listen` → think, use tools →
   `voice_say` → listen again.

Barge-in is first-class: start talking while the assistant speaks and it
stops, marks itself interrupted, and listens. The orb glyph (still / ripple /
pulse / waveform) mirrors idle / listening / thinking / speaking, with
karaoke-style subtitles.

## Built-in local mode

No agent connected? The Studio can talk to a **local model runtime**
(e.g. Ollama) directly: persona prompt plus injected project context, with
user-driven panels via chips. It's the degraded-but-honest path — no
tool-calling pretense, and the orb only ever wears a model name that is
actually loaded in memory.

## Panels, not HTML

When an agent renders something ("show my agenda"), it composes from a
**closed allowlist of registry components** — the model never sends raw HTML.
Saved charts become **lens** nodes storing the query and the chart spec, never
the data; they re-run live everywhere they render.
