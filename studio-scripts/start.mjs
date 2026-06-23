#!/usr/bin/env node
// start.mjs — one command to run Scatterbrained. `npm start` and you're in the Studio.
//
// It does the whole dance for you:
//   1. Find a Neo4j — connect to NEO4J_URI if it's up; otherwise spin a local one in Docker.
//   2. Apply the schema (idempotent).
//   3. First run on our own fresh container → load the demo graph so there's something to see.
//      (Never touches an existing graph's data.)
//   4. Launch the Studio and print the URL.
//
// Config (all optional): NEO4J_URI (bolt://localhost:7687), NEO4J_USER (neo4j),
// NEO4J_PASSWORD (defaults to "scatterbrained" for the auto-spun container), STUDIO_PORT (4317),
// SB_NO_DEMO=1 to skip the demo seed.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import neo4j from 'neo4j-driver';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Resolve a file across both layouts: the public repo (server.js + scripts/ + examples/ at one
// root) and the private monorepo (the studio one level below scripts/ + examples/).
function resolve(rel) {
  for (const base of [path.join(HERE, '..'), path.join(HERE, '..', '..'), HERE]) {
    const p = path.join(base, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const SERVER = resolve('server.js') || resolve('scatterbrained-studio/server.js');
const SCHEMA = resolve('scripts/seed-schema.cypher');
const DEMO = resolve('examples/seed-demo.cypher');

const URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const USER = process.env.NEO4J_USER || 'neo4j';
const PASSWORD = process.env.NEO4J_PASSWORD || 'scatterbrained';
const CONTAINER = 'scatterbrained-neo4j';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`  ${m}`);

async function canConnect(timeoutMs = 2500) {
  const d = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD), { connectionTimeout: timeoutMs });
  try { await d.verifyConnectivity(); return true; } catch { return false; } finally { await d.close(); }
}
const have = (cmd) => { try { return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
const dockerUp = () => { try { return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0; } catch { return false; } };

// Platform-aware setup guidance: a missing or stopped Docker should tell people
// exactly what to do, not just fail. macOS (Homebrew) is the supported path.
function dockerHelp(kind) {
  const p = process.platform;
  const own = `    Already running a Neo4j 5? Set NEO4J_PASSWORD (and NEO4J_URI if it's not local)\n    and re-run \`npm start\` — Scatterbrained will use that instead.`;
  if (kind === 'missing') {
    const inst = p === 'darwin'
      ? `    brew install --cask docker        # or, no GUI:  brew install colima docker && colima start`
      : p === 'win32'
      ? `    winget install Docker.DockerDesktop   (and OpenJS.NodeJS for Node), then launch Docker Desktop`
      : `    Install Docker Engine — https://docs.docker.com/engine/install/`;
    return `  ✗ No Neo4j at ${URI}, and Docker isn't installed to host one.\n\n` +
      `    Install Docker, then re-run \`npm start\`:\n${inst}\n\n${own}\n`;
  }
  const start = p === 'darwin'
    ? `    Open Docker from Applications (or run: colima start), then re-run \`npm start\`.`
    : p === 'win32'
    ? `    Launch Docker Desktop, then re-run \`npm start\`.`
    : `    Start it — sudo systemctl start docker — then re-run \`npm start\`.`;
  return `  ✗ Docker is installed but isn't running.\n\n${start}\n\n${own}\n`;
}

async function ensureNeo4j() {
  if (await canConnect()) { say(`✓ Neo4j is up at ${URI}`); return { spun: false }; }
  if (!have('docker')) { console.error('\n' + dockerHelp('missing')); process.exit(1); }
  if (!dockerUp()) { console.error('\n' + dockerHelp('not-running')); process.exit(1); }
  const exists = spawnSync('docker', ['ps', '-aq', '-f', `name=^${CONTAINER}$`], { encoding: 'utf8' }).stdout.trim();
  if (exists) { say('starting the local Neo4j container…'); spawnSync('docker', ['start', CONTAINER], { stdio: 'ignore' }); }
  else {
    say('no Neo4j found — spinning a local one in Docker…');
    const r = spawnSync('docker', ['run', '-d', '--name', CONTAINER, '-p', '7687:7687', '-p', '7474:7474',
      '-e', `NEO4J_AUTH=${USER}/${PASSWORD}`, 'neo4j:5-community'], { stdio: 'ignore' });
    if (r.status !== 0) { console.error('  ✗ could not start the Neo4j container (is Docker running? try: docker info).'); process.exit(1); }
  }
  process.stdout.write('  waiting for Neo4j');
  for (let i = 0; i < 45; i++) { if (await canConnect(1500)) { console.log(' ✓'); return { spun: !exists }; } process.stdout.write('.'); await sleep(1000); }
  console.error('\n  ✗ Neo4j did not come up in time.'); process.exit(1);
}

// Run a .cypher file statement-by-statement (strip // line comments, split on ;).
async function runCypherFile(driver, file) {
  if (!file) return;
  const body = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  const stmts = body.split(';').map((s) => s.trim()).filter(Boolean);
  const session = driver.session();
  try { for (const s of stmts) await session.run(s); } finally { await session.close(); }
}
async function nodeCount(driver) {
  const session = driver.session();
  try { const r = await session.run('MATCH (n) RETURN count(n) AS n'); return r.records[0].get('n').toNumber(); }
  finally { await session.close(); }
}

async function main() {
  if (!SERVER) { console.error('  ✗ could not locate server.js'); process.exit(1); }
  console.log('\n  ▸ Scatterbrained\n');
  const { spun } = await ensureNeo4j();
  const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
  try {
    say('applying schema…');
    await runCypherFile(driver, SCHEMA);
    if (spun && process.env.SB_NO_DEMO !== '1' && DEMO && (await nodeCount(driver)) === 0) {
      say('loading the demo graph (first run)…');
      await runCypherFile(driver, DEMO);
    }
  } finally { await driver.close(); }

  const port = process.env.STUDIO_PORT || '4317';
  say(`starting the Studio → http://localhost:${port}\n`);
  const child = spawn(process.execPath, [SERVER],
    { stdio: 'inherit', env: { ...process.env, NEO4J_URI: URI, NEO4J_USER: USER, NEO4J_PASSWORD: PASSWORD, STUDIO_PORT: port } });
  child.on('exit', (code) => process.exit(code || 0));
}

main().catch((e) => { console.error('  ✗', e.message); process.exit(1); });
