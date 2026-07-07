import { describe, it, expect } from 'vitest';
import { REL_TYPES, REL_TYPES_LEGACY, REL_TYPES_KNOWN, isValidRelType, isKnownRelType, isValidRelShape, REL_SHAPE_LIST, PROVENANCE_REL_TYPES, isProvenanceRelType } from '../../scripts/lib/vocab.js';

// The inline associate control (#29) writes edges; this guards that the closed
// relationship-type vocab the UI offers stays exactly the schema's set — no ad-hoc
// edge types can sneak in (same discipline as source_kind).
describe('vocab — relationship types (closed set)', () => {
  it('accepts every schema relationship type', () => {
    for (const t of ['WORKS_AT', 'ABOUT', 'INFORMS', 'ACHIEVED_BY', 'REQUIRES', 'BLOCKED_BY', 'PART_OF', 'USED_IN', 'DERIVED_FROM']) {
      expect(isValidRelType(t)).toBe(true);
    }
  });

  it('rejects invented / malformed / non-string types', () => {
    expect(isValidRelType('RELATES_TO')).toBe(false);   // a real Neo4j type in the graph, but NOT in the curated set
    expect(isValidRelType('about')).toBe(false);         // case-sensitive
    expect(isValidRelType('')).toBe(false);
    expect(isValidRelType(null)).toBe(false);
    expect(isValidRelType(42)).toBe(false);
  });

  it('has no duplicates and is non-empty', () => {
    expect(REL_TYPES.length).toBeGreaterThan(0);
    expect(new Set(REL_TYPES).size).toBe(REL_TYPES.length);
  });
});

describe('vocab — known (canonical + legacy grandfathered) types', () => {
  it('KNOWN = canonical ∪ legacy, with no overlap', () => {
    expect(REL_TYPES_KNOWN).toEqual([...REL_TYPES, ...REL_TYPES_LEGACY]);
    expect(REL_TYPES.some((t) => REL_TYPES_LEGACY.includes(t))).toBe(false);
  });
  it('grandfathers pre-existing drift types so lint stays green, but the picker (isValidRelType) still rejects them', () => {
    for (const t of REL_TYPES_LEGACY) {
      expect(isKnownRelType(t)).toBe(true);     // lint tolerates
      expect(isValidRelType(t)).toBe(false);    // picker / new edges do NOT
    }
  });
  it('rejects a truly unknown type everywhere', () => {
    expect(isKnownRelType('WAT')).toBe(false);
    expect(isValidRelType('WAT')).toBe(false);
  });
});

describe('vocab — edge shapes', () => {
  it('accepts documented shapes and rejects backwards / mistyped ones', () => {
    expect(isValidRelShape('Person', 'WORKS_AT', 'Organization')).toBe(true);
    expect(isValidRelShape('Organization', 'WORKS_AT', 'Person')).toBe(false);   // backwards
    expect(isValidRelShape('Skill', 'USED_IN', 'Project')).toBe(true);
    expect(isValidRelShape('Project', 'USED_IN', 'Skill')).toBe(false);          // reversed
    expect(isValidRelShape('Insight', 'INFORMS', 'Project')).toBe(false);        // INFORMS is Source->X
    expect(isValidRelShape('Source', 'INFORMS', 'Project')).toBe(true);
  });
  it('does not shape-constrain legacy types (returns true)', () => {
    expect(isValidRelShape('Idea', 'RELATES_TO', 'Idea')).toBe(true);
  });
  it('exempts annotation/meta labels (Note, Review) from shape checks', () => {
    expect(isValidRelShape('Note', 'PART_OF', 'Review')).toBe(true);   // a review comment
    expect(isValidRelShape('Note', 'ABOUT', 'Project')).toBe(true);    // a node-note on anything
    expect(isValidRelShape('Review', 'ABOUT', 'Project')).toBe(true);  // a review about its project
  });
  it('enumerates the Review>Project ABOUT shape (code-review → its project)', () => {
    // Belt AND suspenders: Review is exempt today, but the shape is also enumerated so
    // it stays legal (and documented) if RELSHAPE_EXEMPT_LABELS ever narrows.
    expect(REL_SHAPE_LIST).toContain('ABOUT|Review>Project');
  });
  it('REL_SHAPE_LIST encodes TYPE|Src>Tgt entries', () => {
    expect(REL_SHAPE_LIST).toContain('WORKS_AT|Person>Organization');
    expect(REL_SHAPE_LIST.every((s) => /^[A-Z_]+\|\w+>\w+$/.test(s))).toBe(true);
  });
});

// The remove-edge affordance (#29) must refuse PROVENANCE edges — they're earned at
// ingest and retired by superseding the source, never hand-pruned (server unrelate()
// + the inspector hide the × for these).
describe('vocab — provenance edges (remove-edge guard)', () => {
  it('treats INFORMS and DERIVED_FROM as provenance', () => {
    expect(isProvenanceRelType('INFORMS')).toBe(true);
    expect(isProvenanceRelType('DERIVED_FROM')).toBe(true);
    expect(PROVENANCE_REL_TYPES).toEqual(['INFORMS', 'DERIVED_FROM']);
  });
  it('does not treat structural association types as provenance', () => {
    for (const t of ['ABOUT', 'PART_OF', 'ACHIEVED_BY', 'REQUIRES', 'WORKS_AT']) {
      expect(isProvenanceRelType(t)).toBe(false);
    }
    expect(isProvenanceRelType('')).toBe(false);
    expect(isProvenanceRelType(null)).toBe(false);
  });
  it('every provenance type is a valid relationship type', () => {
    for (const t of PROVENANCE_REL_TYPES) expect(isValidRelType(t)).toBe(true);
  });
});
