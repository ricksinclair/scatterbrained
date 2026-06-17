#!/bin/bash
# ============================================================================
# Automated graph backup — designed to run from cron (no LLM, no interaction).
#
#   1. Ensures the Neo4j container is up (starts it if needed).
#   2. Exports the graph to backups/graph-YYYY-MM-DD.json.
#   3. Commits + pushes ONLY if the export changed.
#
# All output is appended to logs/backup.log. Exits non-zero on failure so a
# cron MAILTO (if configured) surfaces the error.
#
# Install (daily at 03:17 — off the :00 mark on purpose):
#   crontab -e
#   17 3 * * * /absolute/path/to/scatterbrained/scripts/backup.sh
# ============================================================================
set -uo pipefail

# --- PATH (cron runs with a minimal PATH) -----------------------------------
# Add wherever `node` and `docker` live on your machine. If cron reports
# "node: command not found", prepend your Node bin dir here, e.g.
#   export PATH="$HOME/.nvm/versions/node/<ver>/bin:$PATH"
export PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"
# Docker Desktop's credential helper, needed if compose has to pull (macOS):
[ -d /Applications/Docker.app/Contents/Resources/bin ] && export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"

# Derive the repo root from this script's location — no hardcoded paths.
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="scatterbrained-neo4j"
LOG="$REPO/logs/backup.log"

mkdir -p "$REPO/logs"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

cd "$REPO" || { log "FATAL: cannot cd to $REPO"; exit 1; }

log "=== backup run start ==="

# --- 1. Ensure Neo4j is running ---------------------------------------------
if ! docker ps --filter "name=$CONTAINER" --filter "status=running" --format '{{.Names}}' | grep -q "$CONTAINER"; then
  log "container not running — attempting 'docker compose up -d'"
  if ! docker compose up -d >> "$LOG" 2>&1; then
    log "FATAL: could not start Neo4j container"; exit 1
  fi
  # Give Bolt a moment to accept connections
  sleep 15
fi

# --- 2. Export --------------------------------------------------------------
if ! node scripts/export-graph.js >> "$LOG" 2>&1; then
  log "FATAL: export-graph.js failed"; exit 1
fi

# --- 3. Commit + push only if something changed -----------------------------
git add backups/ >> "$LOG" 2>&1
if git diff --cached --quiet; then
  log "no changes since last backup — skipping commit"
  log "=== backup run end (no-op) ==="
  exit 0
fi

if ! git commit -m "backup: graph export $(date +%F)" >> "$LOG" 2>&1; then
  log "FATAL: git commit failed"; exit 1
fi

if git push >> "$LOG" 2>&1; then
  log "committed + pushed"
else
  # Local commit succeeded, so data is safe; push (likely auth) failed.
  log "WARN: committed locally but git push failed — backlog will push next run"
fi

log "=== backup run end (committed) ==="
