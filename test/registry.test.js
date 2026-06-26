import { describe, it, expect } from 'vitest';
import { composeInspector, composeView, keyFacts, rankEdges, resurfaceState, REGISTRY, miniMarkdown,
  relationShape, relationGroups, isActionType, dueLabel } from '../public/lib/registry.js';

describe('resurfaceState — importance × staleness (Cepeda horizon)', () => {
  const DAY = 86400000;
  it('is due when aged past the importance-scaled horizon', () => {
    const now = 100 * DAY;
    const fresh = resurfaceState(new Date(now - 2 * DAY).toISOString(), 0, { now });
    expect(fresh.due).toBe(false);                       // 2d < horizon
    const aged = resurfaceState(new Date(now - 40 * DAY).toISOString(), 0, { now });
    expect(aged.due).toBe(true);
  });
  it('important (high-degree) nodes resurface sooner (shorter horizon)', () => {
    const now = 100 * DAY;
    const at = new Date(now - 5 * DAY).toISOString();
    expect(resurfaceState(at, 0, { now }).due).toBe(false);    // horizon 30
    expect(resurfaceState(at, 90, { now }).due).toBe(true);    // horizon 3 → due at 5d
  });
  it('snoozed in the future is never due', () => {
    const now = 100 * DAY;
    const s = resurfaceState(new Date(now - 40 * DAY).toISOString(), 90, { now, snoozedUntil: now + DAY });
    expect(s.snoozed).toBe(true);
    expect(s.due).toBe(false);
  });
  it('a superseded node is never due (look at its replacement, not revisit it)', () => {
    const now = 100 * DAY;
    const s = resurfaceState(new Date(now - 40 * DAY).toISOString(), 90, { now, superseded: true });
    expect(s.due).toBe(false);
  });
});

describe('flashcard component (M-H study)', () => {
  const cards = [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }];
  it('shows the cue + reveal button before reveal, hides the answer', () => {
    const html = REGISTRY.flashcard.render({}, { cards, study: { idx: 0, revealed: false } }, { esc });
    expect(html).toContain('Q1');
    expect(html).toContain('data-card="reveal"');
    expect(html).not.toContain('A1');          // answer hidden until revealed (testing effect)
    expect(html).toContain('card 1 / 2');
  });
  it('shows the answer + grade buttons after reveal', () => {
    const html = REGISTRY.flashcard.render({}, { cards, study: { idx: 0, revealed: true } }, { esc });
    expect(html).toContain('A1');
    expect(html).toContain('data-card="grade:good"');
    expect(html).toContain('data-card="grade:again"');
  });
  it('shows a done state past the last card', () => {
    const html = REGISTRY.flashcard.render({}, { cards, study: { idx: 2, reviewed: 2 } }, { esc });
    expect(html).toContain('reviewed 2');
    expect(html).toContain('data-card="restart"');
  });
});

describe('resurface component', () => {
  it('renders a due nudge with snooze + pin, self-suppresses when not due', () => {
    const due = REGISTRY.resurface.render({}, { resurface: { due: true, ageDays: 12 } }, { esc });
    expect(due).toContain('revisit?');
    expect(due).toContain('data-resurface="snooze"');
    expect(REGISTRY.resurface.render({}, { resurface: { due: false } }, { esc })).toBe('');
    expect(REGISTRY.resurface.render({}, {}, { esc })).toBe('');
  });
  it('shows an unsnooze affordance while snoozed', () => {
    const html = REGISTRY.resurface.render({}, { resurface: { snoozed: true, snoozedUntil: Date.parse('2026-07-01') } }, { esc });
    expect(html).toContain('snoozed until 2026-07-01');
    expect(html).toContain('data-resurface="unsnooze"');
  });
  it('is resolved for durable nodes (Insight/Goal/Project/Idea)', () => {
    const ids = composeView({ label: 'Insight' }, { resurface: { due: true, ageDays: 9 } }, {}, 'inspector').map((c) => c.id);
    expect(ids).toContain('resurface');
  });
});

describe('rankEdges — actionable relations before generic references', () => {
  it('orders REQUIRES/ACHIEVED_BY/BLOCKED_BY ahead of incoming ABOUT', () => {
    const ranked = rankEdges([
      { type: 'ABOUT', dir: 'in', name: 'insight1' },
      { type: 'REQUIRES', dir: 'out', name: 'funding' },
      { type: 'ABOUT', dir: 'in', name: 'insight2' },
      { type: 'BLOCKED_BY', dir: 'out', name: 'dep' },
    ]).map((e) => e.type);
    expect(ranked[0]).toBe('BLOCKED_BY');
    expect(ranked[1]).toBe('REQUIRES');
    expect(ranked.slice(2)).toEqual(['ABOUT', 'ABOUT']);
  });
  it('prefers outgoing over incoming at equal type', () => {
    const r = rankEdges([{ type: 'SUPPORTS', dir: 'in' }, { type: 'SUPPORTS', dir: 'out' }]);
    expect(r[0].dir).toBe('out');
  });
});

describe('view-aware composition', () => {
  const node = { label: 'Project', name: 'Northwind', edgeCount: 2 };
  const data = { edges: [
    { type: 'CONTAINS', dir: 'out', name: 'Governance', label: 'Idea' },
    { type: 'ACHIEVED_BY', dir: 'in', name: 'Ship MVP', label: 'Goal' },
  ] };
  it('renders relations as a flat list in inspector, an SVG subgraph in report', () => {
    const insp = composeView(node, data, {}, 'inspector').find((c) => c.id === 'relations');
    const rep = composeView(node, data, {}, 'report').find((c) => c.id === 'relations');
    expect(insp.html).not.toContain('<svg');
    expect(rep.html).toContain('<svg');
    expect(rep.html).toContain('CONTAINS');
  });
  it('coerces an unknown view to inspector', () => {
    const rel = composeView(node, data, {}, 'bogus').find((c) => c.id === 'relations');
    expect(rel.html).not.toContain('<svg');
  });
  it('composeInspector still works (back-compat)', () => {
    expect(composeInspector(node, data).find((c) => c.id === 'relations')).toBeTruthy();
  });
});

describe('keyFacts — the above-the-fold metric row', () => {
  it('pulls confidence + sources + connections, capped at 4', () => {
    const facts = keyFacts({ label: 'Rule', confidence: 'high', jurisdiction: 'NC' },
      { edges: [{ label: 'Source', dir: 'in' }, { type: 'CONSTRAINS', dir: 'out' }] });
    const labels = facts.map((f) => f.label);
    expect(labels).toContain('confidence');
    expect(labels).toContain('sources');
    expect(facts.length).toBeLessThanOrEqual(4);
  });
  it('prefers real uncapped counts (degree/source_count) over the capped edge list', () => {
    // edge list is truncated to 2, but the node reports the true degree/sources.
    const facts = keyFacts({ label: 'Project', degree: 93, source_count: 23 },
      { edges: [{ label: 'Source', dir: 'in' }, { type: 'CONTAINS', dir: 'out' }] });
    expect(facts.find((f) => f.label === 'sources').value).toBe(23);
    expect(facts.find((f) => f.label === 'connections').value).toBe(70);   // 93 − 23, not 1
  });
  it('computes goal progress as a fact from milestone-Ideas (matching the goal-progress panel)', () => {
    const facts = keyFacts({ label: 'Goal' }, { goal_milestones: [
      { status: 'validated' }, { status: 'exploring' }, { valid_until: '2026-01-01', status: '' }, { status: 'proposed' },
    ] });
    expect(facts.find((f) => f.label === 'progress').value).toBe('50%');   // 2 done (validated + valid_until) of 4
  });
});

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

describe('composeInspector — resolver order → registered renderers', () => {
  it('dispatches in resolver order and skips unbuilt component ids', () => {
    // A tabular node with sources + edges: resolver emits chart (unbuilt), provenance, relations.
    const node = { label: 'Insight', name: 'Metrics', isTabular: true, sourceCount: 1, edgeCount: 1 };
    const data = {
      sources: [{ name: 'Plan.md', file_path: '/plan.md' }],
      edges: [{ type: 'DERIVED_FROM', dir: 'out', name: 'Funding', label: 'Source' }],
    };
    const out = composeInspector(node, data);
    const ids = out.map((c) => c.id);
    expect(ids).toContain('provenance');
    expect(ids).toContain('relations');
    expect(ids).not.toContain('chart');                  // resolved but no renderer → skipped, no throw
    expect(ids.indexOf('provenance')).toBeLessThan(ids.indexOf('relations'));
  });

  it('omits components that produce empty output', () => {
    // edgeCount triggers relations in the resolver, but no real edges → empty → dropped.
    const out = composeInspector({ name: 'X', edgeCount: 1 }, { edges: [] });
    expect(out.map((c) => c.id)).not.toContain('relations');
  });

  it('renders protected-facts: value, editable note, pending approve/reject, add affordance', () => {
    const ctx = { esc: (s) => String(s), trunc: (s) => String(s) };
    const data = { id: 'e1', protectedFacts: [
      { id: 'k1', value: '17 U.S.C. §107', note: 'the controlling IRS section' },
      { id: 'k2', value: '$4,200', pending_status: 'altered', pending_new: '$4,500' },
    ] };
    const html = REGISTRY['protected-facts'].render({ id: 'e1' }, data, ctx);
    expect(html).toContain('17 U.S.C. §107');
    expect(html).toContain('$4,200');
    // value is shown plainly — NO kind badge/picker, NO tags
    expect(html).not.toContain('pf-kind');
    expect(html).not.toContain('pf-tag');
    expect(html).not.toContain('__setFactKind');
    // the editable note (pre-filled, saves on change)
    expect(html).toContain('pf-note-input');
    expect(html).toContain('the controlling IRS section');
    expect(html).toContain('__setFactNote(this)');
    // approval banner
    expect(html).toContain("__resolveFact('k2','approve')");
    expect(html).toContain("__resolveFact('k2','reject')");
    expect(html).toContain('$4,500');                 // the proposed replacement is shown
    expect(html).toContain('__suggestFacts');         // suggest-from-text affordance
    expect(html).toContain("__pinFact");              // manual pin form
    expect(html).toContain('name="note"');            // pin form has an optional note field
    expect(html).toContain('__unpinFact(this)');      // remove (×) is a two-step inline confirm
  });
  it('protected-facts shows a retired list with restore when facts were unpinned', () => {
    const ctx = { esc: (s) => String(s), trunc: (s) => String(s) };
    const data = { id: 'e1', protectedFacts: [{ id: 'k1', value: '$4,200' }],
      retiredFacts: [{ id: 'r1', value: '17 U.S.C. §107', note: 'old citation', retired_at: '2026-06-19' }] };
    const html = REGISTRY['protected-facts'].render({ id: 'e1' }, data, ctx);
    expect(html).toContain('retired · 1');
    expect(html).toContain('pf-retired-val');
    expect(html).toContain('__restoreFact(this)');
    expect(html).toContain('data-fid="r1"');
  });
  it('protected-facts omits the retired list when nothing is retired', () => {
    const ctx = { esc: (s) => String(s), trunc: (s) => String(s) };
    const html = REGISTRY['protected-facts'].render({ id: 'e1' }, { id: 'e1', protectedFacts: [{ id: 'k1', value: '$4,200' }] }, ctx);
    expect(html).not.toContain('pf-retired');
  });
  it('protected-facts renders an empty-state prompt when nothing is pinned', () => {
    const ctx = { esc: (s) => String(s), trunc: (s) => String(s) };
    const html = REGISTRY['protected-facts'].render({ id: 'e1' }, { id: 'e1', protectedFacts: [] }, ctx);
    expect(html).toContain('No protected facts');
    expect(html).toContain('__suggestFacts');
  });

  it('falls back to keyvalue when nothing else renders (+ always-on governance/inbox)', () => {
    const out = composeInspector({ name: 'Bare', label: 'Person', role: 'founder' });
    expect(out.map((c) => c.id)).toEqual(['keyvalue', 'protected-facts', 'notes']);
    expect(out[0].html).toContain('founder');
  });

  it('renders markdown body, not plain text, for a markdown source', () => {
    const node = { label: 'Source', sourceKind: 'markdown', hasText: true, desc: '# Title\n- a\n- b' };
    const ids = composeInspector(node, {}).map((c) => c.id);
    expect(ids).toContain('markdown');
    expect(ids).not.toContain('text');
  });
});

describe('ai components (M-E, capability-gated)', () => {
  it('are emitted only when caps.llm is set', () => {
    const node = { label: 'Insight', hasText: true };
    expect(composeView(node, {}, { llm: false }, 'inspector').map((c) => c.id)).not.toContain('ai-summary');
    const withLlm = composeView(node, { ai: {} }, { llm: true }, 'inspector').map((c) => c.id);
    expect(withLlm).toContain('ai-summary');
    expect(withLlm).toContain('ai-qa');
  });
  it('ai-summary shows a trigger, then loading, then the result', () => {
    expect(REGISTRY['ai-summary'].render({}, {}, { esc })).toContain('summarize with local model');
    expect(REGISTRY['ai-summary'].render({}, { ai: { summary: { loading: true } } }, { esc })).toContain('summarizing');
    const done = REGISTRY['ai-summary'].render({}, { ai: { summary: { text: 'A grounded summary', model: 'llama' } } }, { esc });
    expect(done).toContain('A grounded summary');
    expect(done).toContain('local model');
  });
  it('ai-qa renders an ask form and echoes the last answer', () => {
    expect(REGISTRY['ai-qa'].render({}, {}, { esc })).toContain('data-ai="ask"');
    const answered = REGISTRY['ai-qa'].render({}, { ai: { qa: { question: 'why?', answer: 'because' } } }, { esc });
    expect(answered).toContain('why?');
    expect(answered).toContain('because');
  });
});

describe('component renderers are pure and escape input', () => {
  it('keyvalue skips internal sim fields and escapes values', () => {
    const html = REGISTRY.keyvalue.render({ name: '<b>x</b>', x: 1, fx: 2, role: 'a&b' }, {}, { esc, trunc: (s) => s });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a&amp;b');
    expect(html).not.toContain('class="kk">x<');          // x (sim coord) excluded
    expect(html).not.toContain('>fx<');
  });

  it('provenance opens web externally, loads files in-app, plain span otherwise', () => {
    const data = { sources: [{ name: 'web', url: 'https://e.x' }, { name: 'doc', file_path: '/d.md' }, { name: 'bare' }] };
    const html = REGISTRY.provenance.render({}, data, { esc, trunc: (s) => s });
    expect(html).toContain('href="https://e.x"');
    expect(html).toContain('__openFile(&quot;/d.md&quot;)');   // file-backed → in-app loader, not a dead file:// link
    expect(html).not.toContain('file://');
    expect(html).toContain('<span class="src">bare</span>');
    expect(html).toContain('informed by 3 sources');
  });

  it('provenance renders ALL sources (no 6-cap) with scroll + filter + kind badges when long', () => {
    const sources = Array.from({ length: 12 }, (_, i) => ({ name: `source number ${i}`, source_kind: i % 2 ? 'pdf' : 'notion_page', url: `https://e.x/${i}` }));
    const html = REGISTRY.provenance.render({}, { sources }, { esc, trunc: (s) => s });
    expect(html).toContain('informed by 12 sources');
    expect(html).toContain('source number 11');                  // the 12th item is present (old code capped at 6)
    expect((html.match(/prov-row/g) || []).length).toBe(12);     // every source rendered
    expect(html).toContain('prov-scroll');                       // >6 → scroll container
    expect(html).toContain('__provFilter(this)');                // >8 → filter input
    expect(html).toContain('class="src-kind">pdf');              // source_kind badge shown
    expect(html).toContain('data-f="source number 0 notion_page"'); // lowercased filter key (name + kind)
  });

  it('provenance stays compact (no scroll/filter) for a small list', () => {
    const sources = Array.from({ length: 4 }, (_, i) => ({ name: `s${i}`, url: `https://e.x/${i}` }));
    const html = REGISTRY.provenance.render({}, { sources }, { esc, trunc: (s) => s });
    expect((html.match(/prov-row/g) || []).length).toBe(4);
    expect(html).not.toContain('prov-scroll');
    expect(html).not.toContain('__provFilter');
  });

  it('provenance refuses a javascript: source url — inert span, never an href (stored XSS)', () => {
    const data = { sources: [{ name: 'evil', url: 'javascript:alert(document.cookie)' }, { name: 'ok', url: 'https://e.x' }] };
    const html = REGISTRY.provenance.render({}, data, { esc, trunc: (s) => s });
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<span class="src">evil</span>');   // non-web scheme → inert
    expect(html).toContain('href="https://e.x"');              // a real web url still links
  });

  it('miniMarkdown only links real http(s) urls — a javascript: link becomes plain text', () => {
    expect(miniMarkdown('see [x](https://e.x)', esc)).toContain('<a href="https://e.x"');
    const evil = miniMarkdown('[click](javascript:alert(1))', esc);
    expect(evil).not.toContain('<a ');
    expect(evil).not.toContain('javascript:alert');            // url never emitted
    expect(evil).toContain('click');                           // link text preserved as text
  });

  it('notes renders each note with a state pill + anchor, plus an add form wired to the target', () => {
    const data = { id: '4:x:1', notes: [
      { id: 'n1', text: 'research the competitor pricing', state: 'raw', created_at: '2026-06-17T00:00:00Z' },
      { id: 'n2', text: 'reconcile with the spec', state: 'addressed', anchor_kind: 'line', locator: 12, created_at: '2026-06-16T00:00:00Z' },
    ] };
    const html = REGISTRY.notes.render({ id: '4:x:1' }, data, { esc, trunc: (s) => s });
    expect(html).toContain('research the competitor pricing');
    expect(html).toContain('reconcile with the spec');
    expect(html).toContain('data-id="n2"');
    expect(html).toContain('data-state="addressed"');       // state carried for cycling
    expect(html).toContain('note-anchor');                  // anchored note shows its locus
    expect(html).toContain('line 12');
    expect(html).toContain('__addNote(this)');              // add affordance
    expect(html).toContain('value="4:x:1"');                // target id wired into the form
    expect(html).toContain('notes · 2');
  });

  it('notes shows an empty state but still offers the add form', () => {
    const html = REGISTRY.notes.render({ id: 'z' }, { id: 'z', notes: [] }, { esc, trunc: (s) => s });
    expect(html).toContain('No notes yet');
    expect(html).toContain('__addNote(this)');
    expect(html).not.toContain('note-row');
  });

  it('video embeds a YouTube link via a sandboxed nocookie iframe', () => {
    const html = REGISTRY.video.render({ url: 'https://youtu.be/dQw4w9WgXcQ' }, {}, { esc, trunc: (s) => s });
    expect(html).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(html).toContain('<iframe');
    expect(html).toContain('sandbox=');
    expect(html).not.toContain('<video');
  });

  it('video uses a <video> element for a direct mp4, and nothing for a non-video', () => {
    const mp4 = REGISTRY.video.render({ url: 'https://cdn.x/clip.mp4' }, {}, { esc, trunc: (s) => s });
    expect(mp4).toContain('<video');
    expect(mp4).toContain('clip.mp4');
    expect(REGISTRY.video.render({ url: 'https://example.com/a' }, {}, { esc, trunc: (s) => s })).toBe('');
  });

  it('link renders a card with title + domain + external link (no favicon fetch)', () => {
    const html = REGISTRY.link.render({ name: 'Great article', url: 'https://www.nytimes.com/x' }, {}, { esc, trunc: (s) => s });
    expect(html).toContain('href="https://www.nytimes.com/x"');
    expect(html).toContain('Great article');
    expect(html).toContain('nytimes.com');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('favicon');                   // local-first: no external favicon call
  });

  it('timeline marks invalidated nodes', () => {
    const html = REGISTRY.timeline.render({}, { created_at: '2026-01-02T00:00:00Z', valid_until: '2026-06-01T00:00:00Z', superseded_by: 'abc123' }, { esc, trunc: (s, n) => s });
    expect(html).toContain('created 2026-01-02');
    expect(html).toContain('valid_until 2026-06-01');
    expect(html).toContain('superseded by abc123');
  });
  it('timeline links supersession to the resolving node when resolved', () => {
    const resolved = REGISTRY.timeline.render({}, { superseded_by: 'slug-x', superseded_by_id: '4:abc:9', superseded_by_name: 'The corrected claim' }, { esc, trunc: (s) => s });
    expect(resolved).toContain('class="nav-node"');
    expect(resolved).toContain('data-id="4:abc:9"');
    expect(resolved).toContain('The corrected claim');
    // unresolved → plain text, no link
    const plain = REGISTRY.timeline.render({}, { superseded_by: 'slug-x' }, { esc, trunc: (s) => s });
    expect(plain).not.toContain('nav-node');
  });
});

describe('chart component', () => {
  it('renders scaled bars from data.chart, self-suppresses when empty', () => {
    const html = REGISTRY.chart.render({}, { chart: { title: 'by type', bars: [{ label: 'ABOUT', value: 10 }, { label: 'REQUIRES', value: 5 }] } }, { esc });
    expect(html).toContain('by type');
    expect(html).toContain('ABOUT');
    expect(html).toContain('width:100%');   // max bar
    expect(html).toContain('width:50%');     // half
    expect(REGISTRY.chart.render({}, {}, { esc })).toBe('');
    expect(REGISTRY.chart.render({}, { chart: { bars: [] } }, { esc })).toBe('');
  });
  it('a well-connected node uses `relations` (NOT a duplicate connections-by-type chart)', () => {
    const data = { chart: { bars: [{ label: 'X', value: 8 }] }, edges: [{ type: 'ABOUT', dir: 'out', name: 'n', label: 'Project' }] };
    const ids = composeView({ label: 'Project', edgeCount: 8 }, data, {}, 'inspector').map((c) => c.id);
    expect(ids).not.toContain('chart');   // by-type info lives only in `relations` now (dedup)
    expect(ids).toContain('relations');
  });
  it('chart is still offered for a node with its own tabular data', () => {
    const ids = composeView({ label: 'Insight', isTabular: true }, { chart: { bars: [{ label: 'X', value: 8 }] } }, {}, 'inspector').map((c) => c.id);
    expect(ids).toContain('chart');
  });
});

describe('confidence component', () => {
  it('maps level to meter fill + tone, shows citation', () => {
    const html = REGISTRY.confidence.render({ confidence: 'high', citation: 'USC' }, {}, { esc, trunc: (s) => s });
    expect(html).toContain('width:100%');
    expect(html).toContain('conf-ok');
    expect(html).toContain('USC');
  });
  it('renders medium at 66% with mid tone', () => {
    expect(REGISTRY.confidence.render({ confidence: 'medium' }, {}, { esc, trunc: (s) => s })).toContain('width:66%');
  });
  it('renders nothing for an unknown/absent confidence', () => {
    expect(REGISTRY.confidence.render({ confidence: 'bogus' }, {}, { esc, trunc: (s) => s })).toBe('');
    expect(REGISTRY.confidence.render({}, {}, { esc, trunc: (s) => s })).toBe('');
  });
  it('is dispatched for a Rule with confidence', () => {
    const ids = composeInspector({ label: 'Rule', confidence: 'medium' }, {}).map((c) => c.id);
    expect(ids).toContain('confidence');
  });
});

describe('goal-progress component', () => {
  it('computes percent from the delivering project milestone-Ideas (NOT REQUIRES), with clickable chips', () => {
    const data = { goal_milestones: [
      { id: 'm1', name: 'A', status: 'validated' },   // done
      { id: 'm2', name: 'B', status: 'exploring' },   // active
      { id: 'm3', name: 'C', status: 'deferred' },    // blocked
    ], edges: [{ type: 'ACHIEVED_BY', dir: 'out', id: 'p1', name: 'Northwind' }] };
    const html = REGISTRY['goal-progress'].render({ label: 'Goal' }, data, { esc, trunc: (s) => s });
    expect(html).toContain('33%');                       // 1 of 3 done
    expect(html).toContain('1/3 milestones');
    expect(html).toContain('1 active');
    expect(html).toContain('class="nav-node gp-ms');     // milestones are one-click into the work
    expect(html).toContain('data-id="m2"');
  });
  it('counts a bi-temporally invalidated milestone (valid_until) as done', () => {
    const data = { goal_milestones: [
      { id: 'm1', name: 'A', status: '', valid_until: '2026-01-01' },  // done via valid_until
      { id: 'm2', name: 'B', status: 'proposed' },                      // next
    ] };
    const html = REGISTRY['goal-progress'].render({ label: 'Goal' }, data, { esc, trunc: (s) => s });
    expect(html).toContain('50%');
  });
  it('shows the on-ramp (no % bar) when a project is linked but has no milestones', () => {
    const data = { goal_milestones: [], edges: [{ type: 'ACHIEVED_BY', dir: 'out', id: 'p1', name: 'Northwind' }] };
    const html = REGISTRY['goal-progress'].render({ label: 'Goal', status: 'active' }, data, { esc, trunc: (s) => s });
    expect(html).not.toContain('gp-bar');                 // a 0% bar reads as failure for an unmodeled goal
    expect(html).toContain('tracked via');
    expect(html).toContain('Northwind');
    expect(html).toContain('no milestones yet');
  });
  it('nudges to link a project (with an inline on-ramp) when none delivers the goal', () => {
    const html = REGISTRY['goal-progress'].render({ label: 'Goal', status: 'active' }, { goal_milestones: [], edges: [] }, { esc, trunc: (s) => s });
    expect(html).toContain('not yet linked to a delivering project');
    expect(html).toContain('gp-onramp');                          // actionable, not a dead-end status line
    expect(html).toContain('data-gp-action="link-project"');
  });
  it('renders clickable blocker chips from goal_blockers', () => {
    const data = { goal_milestones: [], goal_blockers: [{ id: 'b1', name: 'X' }] };
    const html = REGISTRY['goal-progress'].render({ label: 'Goal' }, data, { esc, trunc: (s) => s });
    expect(html).toContain('gp-blocker');
    expect(html).toContain('data-id="b1"');
    expect(html).toContain('>X<');
  });
  it('is dispatched for any Goal node', () => {
    expect(composeInspector({ label: 'Goal' }, {}).map((c) => c.id)).toContain('goal-progress');
  });
});

describe('excerpt component (the "See" layer)', () => {
  it('renders the grounded excerpt body + a where caption, escaping content', () => {
    const data = { source: { kind: 'markdown', title: 'README.md', text: 'line <x>\nmore', matchedLine: 12, truncated: true } };
    const html = REGISTRY.excerpt.render({}, data, { esc, trunc: (s) => s });
    expect(html).toContain('line &lt;x&gt;');
    expect(html).toContain('near line 12');
    expect(html).toContain('README.md');
    expect(html).toContain('excerpt');
  });
  it('offers an "open full file" loader when the source path is known', () => {
    const data = { source: { kind: 'markdown', title: 'README.md', sourcePath: '/r/README.md', text: 'hi', matchedLine: 1 } };
    const html = REGISTRY.excerpt.render({}, data, { esc, trunc: (s) => s });
    expect(html).toContain('open full file');
    expect(html).toContain('__openFile(&quot;/r/README.md&quot;)');
    // no path → no loader link
    expect(REGISTRY.excerpt.render({}, { source: { kind: 'markdown', text: 'hi' } }, { esc, trunc: (s) => s })).not.toContain('open full file');
  });
  it('shows a quiet note for sandbox-blocked / binary sources, no body', () => {
    expect(REGISTRY.excerpt.render({}, { source: { blocked: true, title: 'x' } }, { esc, trunc: (s) => s })).toContain('outside the read sandbox');
    const bin = REGISTRY.excerpt.render({}, { source: { unsupported: true, kind: 'pdf', title: 'deck.pdf' } }, { esc, trunc: (s) => s });
    expect(bin).toContain('open to view');
    expect(bin).not.toContain('<pre');
  });
  it('renders nothing when there is no source payload', () => {
    expect(REGISTRY.excerpt.render({}, {}, { esc, trunc: (s) => s })).toBe('');
    expect(REGISTRY.excerpt.render({}, { source: { kind: 'markdown' } }, { esc, trunc: (s) => s })).toBe('');
  });
  it('is dispatched (with payload) for a node with a file but no inline text', () => {
    const node = { label: 'Resource', filePath: '/a/x.md' };
    const data = { source: { kind: 'markdown', title: 'x.md', text: 'hello' } };
    expect(composeInspector(node, data).map((c) => c.id)).toContain('excerpt');
    // …but is dropped when the BFF returns no readable payload (empty output).
    expect(composeInspector(node, {}).map((c) => c.id)).not.toContain('excerpt');
  });
});

describe('miniMarkdown', () => {
  it('renders headings, bold, code and bullet lists; escapes html', () => {
    const html = miniMarkdown('# H\nsome **bold** and `code`\n- one\n- two\n<script>', esc);
    expect(html).toContain('<h1>H</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('relationShape', () => {
  it('classifies leaf / hub / connector and reports in/out skew', () => {
    expect(relationShape(2, [{ dir: 'in', label: 'A' }, { dir: 'out', label: 'B' }]).role).toBe('leaf');
    const hub = relationShape(30, [{ dir: 'in', label: 'A' }, { dir: 'in', label: 'B' }, { dir: 'out', label: 'C' }]);
    expect(hub.role).toBe('hub');
    expect(hub.skew).toBe('balanced');
    const inbound = relationShape(10, [{ dir: 'in', label: 'A' }, { dir: 'in', label: 'B' }, { dir: 'in', label: 'C' }, { dir: 'out', label: 'D' }]);
    expect(inbound.role).toBe('connector');      // 4 label kinds
    expect(inbound.skew).toBe('mostly inbound');
  });
});

describe('isActionType / relationGroups', () => {
  it('separates action edges from provenance', () => {
    expect(isActionType('REQUIRES')).toBe(true);
    expect(isActionType('BLOCKED_BY')).toBe(true);
    expect(isActionType('INFORMS')).toBe(false);
    expect(isActionType('ABOUT')).toBe(false);
  });
  it('groups by type, ranks by EDGE_RANK, flags stale, uses uncapped totals', () => {
    const edges = [
      { type: 'INFORMS', dir: 'in', label: 'Source', name: 'a' },
      { type: 'INFORMS', dir: 'in', label: 'Source', name: 'b', valid_until: '2025-01-01' },
      { type: 'REQUIRES', dir: 'out', label: 'Idea', name: 'c' },
    ];
    const relTypes = ['INFORMS', 'INFORMS', 'INFORMS', 'INFORMS', 'REQUIRES'];   // uncapped: 4 INFORMS
    const g = relationGroups(edges, relTypes);
    expect(g[0].type).toBe('REQUIRES');           // higher EDGE_RANK first
    expect(g[0].action).toBe(true);
    const informs = g.find((x) => x.type === 'INFORMS');
    expect(informs.total).toBe(4);                // from relTypes, not the 2 shown
    expect(informs.items).toHaveLength(2);
    expect(informs.stale).toBe(1);
  });
});

describe('relations component (Phase 0 render)', () => {
  const data = {
    degree: 12, relTypes: ['REQUIRES', 'REQUIRES', 'ABOUT'],
    edges: [
      { type: 'REQUIRES', dir: 'out', label: 'Idea', name: 'Funding', id: 'n1' },
      { type: 'ABOUT', dir: 'in', label: 'Insight', name: 'note', id: 'n3', valid_until: '2025-01-01' },
    ],
  };
  it('renders a shape line, type groups, clickable neighbors, stale flag', () => {
    const html = REGISTRY.relations.render({ label: 'Project' }, data, { esc, trunc: (s) => s, view: 'inspector' });
    expect(html).toContain('connection');                        // shape verdict
    expect(html).toContain('acts on / blocks');                  // action section
    expect(html).toContain('referenced by');                     // provenance section
    expect(html).toContain('class="nav-node rel-n"');            // navigable neighbor
    expect(html).toContain('nav-node rel-n stale');              // stale neighbor flagged
    expect(html).toContain('data-id="n1"');                      // the keystone id is wired
  });

  // #29 remove-edge: the × rides each removable inspector edge (not report, not provenance).
  const editData = {
    degree: 3, relTypes: ['ABOUT', 'INFORMS'],
    edges: [
      { type: 'ABOUT', dir: 'out', label: 'Person', name: 'Priya', id: 'p1', rel_id: 'r1' },
      { type: 'INFORMS', dir: 'out', label: 'Project', name: 'Northwind', id: 'pr1', rel_id: 'r2' },
      { type: 'ABOUT', dir: 'out', label: 'Idea', name: 'NoId', id: 'n9' },   // no rel_id → no ×
    ],
  };
  it('emits a remove-× for a removable inspector edge, carrying the rel id', () => {
    const html = REGISTRY.relations.render({ label: 'Insight' }, editData, { esc, trunc: (s) => s, view: 'inspector' });
    expect(html).toContain('class="rel-x"');
    expect(html).toContain('data-unrel="r1"');
  });
  it('hides the × on provenance edges (INFORMS) and edges lacking a rel id', () => {
    const html = REGISTRY.relations.render({ label: 'Insight' }, editData, { esc, trunc: (s) => s, view: 'inspector' });
    expect(html).not.toContain('data-unrel="r2"');   // INFORMS is provenance
    expect(html).not.toContain('data-unrel=""');      // the rel_id-less edge gets no button
  });
  it('never shows the × in report view (read-only)', () => {
    const html = REGISTRY.relations.render({ label: 'Insight' }, editData, { esc, trunc: (s) => s, view: 'report' });
    expect(html).not.toContain('rel-x');
  });
});

// Goal.target_date (#25 P1): relative due label + the editable date input.
describe('dueLabel + goal-progress target date', () => {
  const NOW = Date.parse('2026-06-18T12:00:00');
  it('formats today / future / overdue / blank', () => {
    expect(dueLabel('2026-06-18', NOW)).toBe('due today');
    expect(dueLabel('2026-06-23', NOW)).toBe('due in 5d');
    expect(dueLabel('2026-06-15', NOW)).toBe('3d overdue');
    expect(dueLabel('', NOW)).toBe('');
    expect(dueLabel(null, NOW)).toBe('');
    expect(dueLabel('not-a-date', NOW)).toBe('');
  });
  it('goal-progress renders an editable date input wired to the goal id', () => {
    const html = REGISTRY['goal-progress'].render(
      { label: 'Goal', id: 'g1', status: 'active', target_date: '2026-12-31' },
      { edges: [] }, { esc, trunc: (s) => s });
    expect(html).toContain('type="date"');
    expect(html).toContain('data-goaldate="g1"');
    expect(html).toContain('value="2026-12-31"');
  });
});
