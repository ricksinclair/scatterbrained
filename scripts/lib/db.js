// Shared Neo4j driver + small helpers for all scripts.
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const USER = process.env.NEO4J_USER || 'neo4j';
const PASSWORD = process.env.NEO4J_PASSWORD || 'rick-local';

export function getDriver() {
  return neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
}

// Run a single query in an auto-managed session and return the records.
export async function run(driver, cypher, params = {}) {
  const session = driver.session();
  try {
    const res = await session.run(cypher, params);
    return res.records;
  } finally {
    await session.close();
  }
}

// Parse `--flag value` and `--flag` (boolean) style args into an object.
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Split a comma-separated string into a trimmed, non-empty array.
export function splitList(v) {
  if (!v || v === true) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Convert Neo4j temporal/integer values to plain JS for printing/JSON.
export function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (neo4j.isInt(value)) return value.toNumber();
  if (
    neo4j.isDateTime?.(value) ||
    neo4j.isDate?.(value) ||
    (value && typeof value.toString === 'function' && value.year !== undefined)
  ) {
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = toPlain(v);
    return o;
  }
  return value;
}
