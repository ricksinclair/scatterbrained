#!/usr/bin/env node
// engram — thin CLI dispatcher over the toolkit scripts, so the published
// package is usable via `npx engram-kg <command>` (or globally as `engram`).
// For the full setup (docker-compose Neo4j, schema, demo graph), clone the repo:
// https://github.com/ricksinclair/engram
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// subcommand -> script under scripts/
const COMMANDS = {
  lint: 'lint-graph.js',
  search: 'search.js',
  embed: 'embed.js',
  context: 'build-context.js',
  resume: 'resume.js',
  supersede: 'supersede.js',
  review: 'review-supersession.js',
  'check-notion': 'check-notion.js',
  add: 'add-node.js',
  insight: 'write-insight.js',
  index: 'notion-index.js',
  'doc-index': 'document-index.js',
  export: 'export-graph.js',
  import: 'import-graph.js',
};

const HELP = `engram — an agent-maintained, bi-temporal knowledge graph for AI memory

Usage:  engram <command> [args]

Commands:
  lint            graph integrity check (orphans, undated, unlinked, vocab)
  search          hybrid search — keyword + semantic (if embedded), bi-temporal aware
  embed           backfill semantic embeddings (needs: npm i @xenova/transformers)
  context         assemble a context block (--project/--domain/--tag/--recent)
  resume          cross-session "where were we" brief
  supersede       invalidate a fact bi-temporally (never deletes)
  review          surface candidate stale facts for review
  check-notion    validate the Notion ID manifest
  add             MERGE a single node
  insight         record a synthesized Insight (reads stdin)
  index           Notion "what changed?" probe
  doc-index       local-document "what changed?" probe
  export | import versioned JSON graph backups

Connection (env, with sane local defaults):
  NEO4J_URI (bolt://localhost:7687)  NEO4J_USER (neo4j)  NEO4J_PASSWORD

Full setup — docker-compose Neo4j, schema, and a demo graph — is in the repo:
  https://github.com/ricksinclair/engram   ·   https://ulrictodman.com/engram
`;

const [cmd, ...rest] = process.argv.slice(2);

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  process.stdout.write(HELP);
  process.exit(cmd ? 0 : 1);
}

const script = COMMANDS[cmd];
if (!script) {
  console.error(`engram: unknown command "${cmd}". Run \`engram help\`.`);
  process.exit(1);
}

const res = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...rest], { stdio: 'inherit' });
process.exit(res.status ?? 1);
