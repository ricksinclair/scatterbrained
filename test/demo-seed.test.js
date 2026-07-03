import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CRITERION_STATES } from '../public/lib/criteria.js';

// Demo-graph guardrail (acceptance criterion 7): the seed ships ≥1 example acceptance
// criterion so the tour can show the verify loop. Text-shaped assertions over the seed
// file — no database needed, so it runs everywhere the unit suite runs.
const seed = readFileSync(fileURLToPath(new URL('../examples/seed-demo.cypher', import.meta.url)), 'utf8');

describe('demo seed — acceptance criteria (criterion 7)', () => {
  // [^;]*? keeps the scan inside one Cypher statement, so a non-criterion Note's MERGE
  // can never borrow a later statement's anchor_kind.
  const critIds = [...seed.matchAll(/MERGE \((\w+):Note \{id:'([^']+)'\}\)[^;]*?anchor_kind='criterion'/g)]
    .map((m) => ({ varName: m[1], id: m[2] }));

  it('seeds at least one criterion Note (anchor_kind criterion)', () => {
    expect(critIds.length).toBeGreaterThanOrEqual(1);
  });

  it('every seeded criterion carries a state from the closed vocab', () => {
    for (const { id } of critIds) {
      const block = seed.slice(seed.indexOf(`{id:'${id}'}`));
      const state = /state='([^']+)'/.exec(block);
      expect(state, id).toBeTruthy();
      expect(CRITERION_STATES, `${id} state '${state[1]}'`).toContain(state[1]);
    }
  });

  it('every seeded criterion is wired ABOUT a target (criteria never orphan)', () => {
    for (const { id } of critIds) {
      const about = new RegExp(`\\{id:'${id}'\\}\\)[^\\n]*MERGE \\(\\w+\\)-\\[:ABOUT\\]->`, 'm');
      expect(about.test(seed), `${id} has no ABOUT edge in the seed`).toBe(true);
    }
  });

  it('a verified criterion in the seed carries last_verified_at (the loop is demonstrable)', () => {
    expect(/anchor_kind='criterion'[\s\S]{0,200}last_verified_at=datetime\(/.test(seed)).toBe(true);
  });
});
