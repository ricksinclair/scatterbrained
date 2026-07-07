import { describe, it, expect } from 'vitest';
import { FIELDS, fieldRowsFor, membersForField, relateArgs } from '../public/lib/fields.js';
import { isValidRelShape } from '../scripts/lib/vocab.js';

// Per-field association rows (#29). The curated FIELDS table must never describe an edge
// shape the server would reject — so every field is validated against REL_SHAPES here.
describe('fields — per-field association rows', () => {
  it('every field describes a VALID schema edge shape (drift guard vs REL_SHAPES)', () => {
    for (const f of FIELDS) {
      // dir 'out' → (for)-[:relType]->(targetLabel); 'in' → (targetLabel)-[:relType]->(for)
      const [src, tgt] = f.dir === 'out' ? [f.for, f.targetLabel] : [f.targetLabel, f.for];
      expect(isValidRelShape(src, f.relType, tgt), `${f.key}: (${src})-[:${f.relType}]->(${tgt})`).toBe(true);
    }
  });

  it('field keys are unique', () => {
    const keys = FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('fieldRowsFor returns only the fields for that label', () => {
    const rows = fieldRowsFor('Project');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((f) => f.for === 'Project')).toBe(true);
    expect(rows.map((f) => f.label)).toContain('People');
    expect(fieldRowsFor('Source')).toEqual([]);   // no nonsensical rows for a Source
    expect(fieldRowsFor(undefined)).toEqual([]);
  });

  it('membersForField filters edges by type + dir + target label', () => {
    const field = { relType: 'COLLABORATES_ON', dir: 'in', targetLabel: 'Person' };
    const edges = [
      { type: 'COLLABORATES_ON', dir: 'in', label: 'Person', name: 'Priya', id: 'p1', rel_id: 'r1' },
      { type: 'COLLABORATES_ON', dir: 'out', label: 'Person', name: 'wrong-dir', id: 'p2' },   // out, not in
      { type: 'REQUIRES', dir: 'out', label: 'Skill', name: 'Java', id: 's1' },                  // wrong type
      { type: 'COLLABORATES_ON', dir: 'in', label: 'Project', name: 'wrong-label', id: 'x1' },   // wrong label
    ];
    const m = membersForField(edges, field);
    expect(m.map((e) => e.name)).toEqual(['Priya']);
    expect(membersForField([], field)).toEqual([]);
    expect(membersForField(edges, null)).toEqual([]);
  });

  it('relateArgs orients the edge per the field direction', () => {
    const outF = { relType: 'REQUIRES', dir: 'out', targetLabel: 'Skill' };
    expect(relateArgs(outF, 'NODE', 'PICK')).toEqual({ sourceId: 'NODE', targetId: 'PICK', type: 'REQUIRES' });
    const inF = { relType: 'COLLABORATES_ON', dir: 'in', targetLabel: 'Person' };
    expect(relateArgs(inF, 'NODE', 'PICK')).toEqual({ sourceId: 'PICK', targetId: 'NODE', type: 'COLLABORATES_ON' });
  });
});
