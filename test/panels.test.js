import { describe, it, expect } from 'vitest';
import { validatePanel, PANEL_KINDS, PANEL_COMPONENTS } from '../lib/panels.js';
import { SETS } from '../public/lib/sets.js';
import { REGISTRY } from '../public/lib/registry.js';
import { VIEWS } from '../public/lib/views.js';

describe('the closed vocabularies (§10.7 guards)', () => {
  it('every voice-panel component exists in the registry', () => {
    for (const id of SETS['voice-panel']) expect(REGISTRY[id], id).toBeTruthy();
  });
  it('panel is a first-class view', () => {
    expect(VIEWS).toContain('panel');
  });
  it('nothing form-bearing or capability-gated leaked into the set', () => {
    for (const banned of ['ai-summary', 'ai-qa', 'notes', 'flashcard', 'chart', 'excerpt']) {
      expect(SETS['voice-panel']).not.toContain(banned);
    }
  });
});

describe('validatePanel', () => {
  it('accepts each kind with its own fields, normalized', () => {
    expect(validatePanel({ kind: 'agenda' })).toEqual({ spec: { kind: 'agenda' } });
    expect(validatePanel({ kind: 'agenda', project: 'Scatterbrained' }).spec.project).toBe('Scatterbrained');
    expect(validatePanel({ kind: 'search', q: '  voice  ' }).spec.q).toBe('voice');
    const node = validatePanel({ kind: 'node', node_id: 'abc', components: ['markdown', 'relations', 'markdown'] });
    expect(node.spec.components).toEqual(['markdown', 'relations']);   // deduped
  });
  it('unknown kind → unknown_kind with the allowed kinds echoed', () => {
    const r = validatePanel({ kind: 'dashboard' });
    expect(r.error).toMatchObject({ code: 'unknown_kind', allowed: PANEL_KINDS });
  });
  it('unknown component → unknown_component with the full set echoed (agent self-correction)', () => {
    const r = validatePanel({ kind: 'node', node_id: 'x', components: ['relations', 'bogus'] });
    expect(r.error).toMatchObject({ code: 'unknown_component', allowed: PANEL_COMPONENTS });
    expect(r.error.message).toContain('bogus');
  });
  it('missing per-kind requirements and stray fields → bad_params', () => {
    expect(validatePanel({ kind: 'node' }).error.code).toBe('bad_params');
    expect(validatePanel({ kind: 'search' }).error.code).toBe('bad_params');
    expect(validatePanel({ kind: 'node', node_id: 'x', components: [] }).error.code).toBe('bad_params');
    expect(validatePanel({ kind: 'agenda', html: '<b>x</b>' }).error.code).toBe('bad_params');
  });
  it('caps title/q/project lengths', () => {
    expect(validatePanel({ kind: 'agenda', title: 'x'.repeat(200) }).spec.title).toHaveLength(80);
    expect(validatePanel({ kind: 'search', q: 'y'.repeat(500) }).spec.q).toHaveLength(200);
  });

  describe('kind:viz', () => {
    it('accepts a cypher-backed viz (server runs it later)', () => {
      const r = validatePanel({ kind: 'viz', title: 'by status', cypher: 'MATCH (p:Project) RETURN p.status, count(*)' });
      expect(r.spec).toMatchObject({ kind: 'viz', title: 'by status' });
      expect(r.spec.cypher).toContain('MATCH');
    });
    it('accepts rows-in-hand and validates an explicit spec through chart-spec', () => {
      const r = validatePanel({ kind: 'viz', rows: [{ s: 'a', n: 1 }], spec: { kind: 'bar', bars: [{ label: 'a', value: 1 }] } });
      expect(r.spec.rows).toHaveLength(1);
      expect(r.spec.spec.kind).toBe('bar');
    });
    it('requires either cypher or rows', () => {
      expect(validatePanel({ kind: 'viz', title: 't' }).error.code).toBe('bad_params');
    });
    it('rejects a bad chart spec, echoing the chart-kind vocabulary', () => {
      const r = validatePanel({ kind: 'viz', rows: [{ a: 1 }], spec: { kind: 'pie', bars: [] } });
      expect(r.error.code).toBe('unknown_kind');
      expect(r.error.allowed).toContain('scatter');
    });
    it('viz is a first-class panel kind', () => {
      expect(PANEL_KINDS).toContain('viz');
    });
  });
});
