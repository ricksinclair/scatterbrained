#!/usr/bin/env bash
# summon-claude.sh — put a subscription-billed Claude session on the Scatterbrained
# voice loop with one command. Registers the MCP connection on first run (user scope,
# so it works from any directory), then launches Claude with the join prompt. The
# terminal that opens is just where the brain lives — the conversation happens in the
# Studio by voice. Say goodbye (voice_disconnect) or Ctrl-C here to dismiss it.
#
#   Usage: summon-claude.sh [model]        (default: claude-opus-4-8)
#          STUDIO_PORT=4321 summon-claude.sh claude-sonnet-5
#
# Folds into `sb summon` when the sb CLI ships (graph Idea: "sb bin").
set -euo pipefail

MODEL="${1:-claude-opus-4-8}"
PORT="${STUDIO_PORT:-4317}"
TOKEN_FILE="$HOME/.scatterbrained/mcp-token"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "No MCP token at $TOKEN_FILE — start the Studio once first (npm run studio)." >&2
  exit 1
fi
if ! curl -sf "http://127.0.0.1:${PORT}/api/health" > /dev/null; then
  echo "The Studio isn't answering on :${PORT} — start it first (npm run studio)." >&2
  exit 1
fi

# Idempotent registration: add the connection once, user-scoped.
if ! claude mcp get scatterbrained > /dev/null 2>&1; then
  claude mcp add --scope user --transport http scatterbrained \
    "http://127.0.0.1:${PORT}/mcp" \
    --header "Authorization: Bearer $(cat "$TOKEN_FILE")"
  echo "Registered the scatterbrained MCP connection (user scope)."
fi

echo "Summoning ${MODEL} onto the voice loop — talk to the orb; this terminal is just the brain's home."
# MCP_TOOL_TIMEOUT must exceed the 240s idle listens (budget-aware polling).
exec env MCP_TOOL_TIMEOUT=300000 claude --model "$MODEL" \
  "Join the Scatterbrained voice loop via the scatterbrained MCP server and STAY in it: call voice_connect with your exact model id, then loop voice_listen → (tools as needed) → voice_say until the user says goodbye — then voice_disconnect."
