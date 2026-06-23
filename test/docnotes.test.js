import { describe, it, expect } from 'vitest';
import {
  lineNotesIndex, rawLinesHtml, cellNotesIndex, rowNotesIndex, colNotesIndex,
  sectionNotesIndex, pageNotesIndex,
  makeCellLocator, parseCellLocator, makeRowLocator, parseRowLocator,
  makeColLocator, parseColLocator, makePageLocator, parsePageLocator, slugify,
  anchoredCount, annoHtml, authorLabel,
} from '../public/lib/docnotes.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('docnotes — anchored per-line notes', () => {
  it('indexes only line-anchored notes by line number', () => {
    const idx = lineNotesIndex([
      { anchor_kind: 'line', locator: 3, text: 'a' },
      { anchor_kind: 'line', locator: 3, text: 'b' },
      { anchor_kind: 'node', text: 'node-level — ignored' },
      { anchor_kind: 'line', locator: 7, text: 'c' },
    ]);
    expect(idx.get(3).length).toBe(2);
    expect(idx.get(7).length).toBe(1);
    expect(idx.has(1)).toBe(false);
  });

  it('renders a gutter per line and notes beneath their anchored line', () => {
    const text = 'first line\nsecond line\nthird line';
    const notes = [{ id: 'n1', anchor_kind: 'line', locator: 2, text: 'check this assumption', state: 'raw' }];
    const html = rawLinesHtml(text, notes, esc);
    expect((html.match(/fr-gut/g) || []).length).toBe(3);        // a gutter on every line
    expect((html.match(/data-line="/g) || []).length).toBe(3);
    expect(html).toContain('data-line="2"');
    expect(html).toContain('class="fr-line has-note" data-line="2"');  // line 2 flagged
    expect(html).toContain('check this assumption');             // the note shows
    expect(html).toContain('fr-anno-raw');
    // line 1 has no note → no anno after it
    expect(html.indexOf('first line')).toBeLessThan(html.indexOf('check this assumption'));
  });

  it('escapes line content and note text', () => {
    const html = rawLinesHtml('<script>x</script>', [{ anchor_kind: 'line', locator: 1, text: '<b>hi</b>', state: 'addressed' }], esc);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).toContain('fr-anno-addressed');
    expect(html).not.toContain('<script>x</script>');
  });
});

describe('docnotes — locator codec', () => {
  it('round-trips cell locators', () => {
    expect(makeCellLocator(3, 2)).toBe('r3c2');
    expect(parseCellLocator('r3c2')).toEqual({ r: 3, c: 2 });
    expect(parseCellLocator('r0c0')).toEqual({ r: 0, c: 0 });
    expect(parseCellLocator('nope')).toBeNull();
    expect(parseCellLocator(null)).toBeNull();
  });
  it('round-trips row and column locators, distinct from cell', () => {
    expect(makeRowLocator(2)).toBe('row2');
    expect(parseRowLocator('row2')).toBe(2);
    expect(makeColLocator(3)).toBe('col3');
    expect(parseColLocator('col3')).toBe(3);
    // a row/col locator is NOT a cell locator and vice-versa
    expect(parseCellLocator('row2')).toBeNull();
    expect(parseRowLocator('r2c1')).toBeNull();
    expect(parseColLocator('row2')).toBeNull();
  });
  it('round-trips page locators and tolerates bare numbers', () => {
    expect(makePageLocator(5)).toBe('p5');
    expect(parsePageLocator('p5')).toBe(5);
    expect(parsePageLocator(7)).toBe(7);
    expect(parsePageLocator('x')).toBeNull();
  });
  it('slugifies headings stably', () => {
    expect(slugify('  The Wheel & You! ')).toBe('the-wheel-you');
    expect(slugify('Section 1: Intro')).toBe('section-1-intro');
    expect(slugify('already-slug')).toBe('already-slug');
  });
});

describe('docnotes — anchor indexes', () => {
  it('cellNotesIndex keys only cell-anchored notes by r,c', () => {
    const idx = cellNotesIndex([
      { anchor_kind: 'cell', locator: 'r2c1', text: 'a' },
      { anchor_kind: 'cell', locator: 'r2c1', text: 'b' },
      { anchor_kind: 'cell', locator: 'r9c4', text: 'c' },
      { anchor_kind: 'line', locator: 2, text: 'ignored' },
      { anchor_kind: 'cell', locator: 'bad', text: 'ignored' },
    ]);
    expect(idx.get('2,1').length).toBe(2);
    expect(idx.get('9,4').length).toBe(1);
    expect(idx.size).toBe(2);
  });
  it('rowNotesIndex and colNotesIndex key whole-row / whole-column notes', () => {
    const notes = [
      { anchor_kind: 'row', locator: 'row2', text: 'check this row' },
      { anchor_kind: 'row', locator: 'row2', text: 'second' },
      { anchor_kind: 'col', locator: 'col1', text: 'whole column' },
      { anchor_kind: 'cell', locator: 'r2c1', text: 'ignored by row/col' },
      { anchor_kind: 'line', locator: 2, text: 'ignored' },
    ];
    const rows = rowNotesIndex(notes), cols = colNotesIndex(notes);
    expect(rows.get(2).length).toBe(2);
    expect(rows.size).toBe(1);
    expect(cols.get(1).length).toBe(1);
    expect(cols.size).toBe(1);
    // cell index ignores row/col notes
    expect(cellNotesIndex(notes).get('2,1').length).toBe(1);
  });
  it('sectionNotesIndex keys section notes by slug', () => {
    const idx = sectionNotesIndex([
      { anchor_kind: 'section', locator: 'the-wheel', text: 'a' },
      { anchor_kind: 'section', locator: 'the-wheel', text: 'b' },
      { anchor_kind: 'node', text: 'ignored' },
    ]);
    expect(idx.get('the-wheel').length).toBe(2);
    expect(idx.size).toBe(1);
  });
  it('pageNotesIndex keys pdf notes by page, accepting p<n> or bare', () => {
    const idx = pageNotesIndex([
      { anchor_kind: 'pdf', locator: 'p1', text: 'a' },
      { anchor_kind: 'pdf', locator: 3, text: 'b' },
      { anchor_kind: 'line', locator: 1, text: 'ignored' },
    ]);
    expect(idx.get(1).length).toBe(1);
    expect(idx.get(3).length).toBe(1);
    expect(idx.size).toBe(2);
  });
  it('anchoredCount counts every non-node anchor', () => {
    expect(anchoredCount([
      { anchor_kind: 'node' }, { anchor_kind: 'line', locator: 1 },
      { anchor_kind: 'cell', locator: 'r1c1' }, { anchor_kind: 'pdf', locator: 'p2' },
    ])).toBe(3);
  });
  it('annoHtml renders state pill + escaped text', () => {
    const html = annoHtml([{ id: 'n1', state: 'cued', text: '<x>' }], esc);
    expect(html).toContain('fr-anno-cued');
    expect(html).toContain('cued');
    expect(html).toContain('&lt;x&gt;');
  });
  it('authorLabel maps you / agent:<model> / bare to a kind + display text', () => {
    expect(authorLabel('you')).toEqual({ kind: 'you', text: 'You' });
    expect(authorLabel()).toEqual({ kind: 'you', text: 'You' });
    expect(authorLabel('agent:claude-opus-4-8')).toEqual({ kind: 'agent', text: 'claude-opus-4-8' });
    expect(authorLabel('Reviewer X')).toEqual({ kind: 'agent', text: 'Reviewer X' });
  });
  it('annoHtml renders an author byline with a you/agent tell', () => {
    const you = annoHtml([{ id: 'n1', state: 'raw', text: 'hi', author: 'you' }], esc);
    expect(you).toContain('fr-anno-au-you');
    expect(you).toContain('You');
    const agent = annoHtml([{ id: 'n2', state: 'raw', text: 'hi', author: 'agent:claude-opus-4-8' }], esc);
    expect(agent).toContain('fr-anno-au-agent');
    expect(agent).toContain('claude-opus-4-8');
  });
});
