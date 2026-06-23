import { describe, it, expect } from 'vitest';
import { parseCsv, detectDelimiter, csvToTable, isNumericColumn, sortRows, filterRows } from '../public/lib/csv.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

describe('detectDelimiter', () => {
  it('picks tab when the header has more tabs than commas', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
});

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
  it('handles quoted fields with commas, newlines, and escaped quotes', () => {
    const csv = 'name,note\n"Smith, Jr.","line1\nline2"\n"she said ""hi""",ok';
    expect(parseCsv(csv)).toEqual([
      ['name', 'note'],
      ['Smith, Jr.', 'line1\nline2'],
      ['she said "hi"', 'ok'],
    ]);
  });
  it('does not emit a trailing empty row for a final newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('parses TSV via auto-detected delimiter', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('isNumericColumn', () => {
  const rows = [['name', 'count', 'note'], ['a', '1,200', 'x'], ['b', '$340', 'y'], ['c', '', 'z']];
  it('detects numeric columns, tolerating separators/currency/blanks', () => {
    expect(isNumericColumn(rows, 1)).toBe(true);
    expect(isNumericColumn(rows, 0)).toBe(false);
    expect(isNumericColumn(rows, 2)).toBe(false);
  });
});

describe('sortRows', () => {
  const rows = [['name', 'n'], ['Charlie', '2'], ['alice', '10'], ['Bob', '1']];
  it('sorts a numeric column numerically (10 after 2), header pinned', () => {
    expect(sortRows(rows, 1, 'asc').map((r) => r[1])).toEqual(['n', '1', '2', '10']);
    expect(sortRows(rows, 1, 'desc').map((r) => r[1])).toEqual(['n', '10', '2', '1']);
  });
  it('sorts a text column case-insensitively', () => {
    expect(sortRows(rows, 0, 'asc').map((r) => r[0])).toEqual(['name', 'alice', 'Bob', 'Charlie']);
  });
  it('dir none or null col → unchanged copy', () => {
    expect(sortRows(rows, 1, 'none')).toEqual(rows);
    expect(sortRows(rows, null, 'asc')).toEqual(rows);
  });
});

describe('filterRows', () => {
  const rows = [['name', 'city'], ['Smith', 'Durham'], ['Jones', 'Raleigh'], ['Brown', 'Durham']];
  it('keeps header + rows matching any cell, case-insensitive', () => {
    expect(filterRows(rows, 'durham').map((r) => r[0])).toEqual(['name', 'Smith', 'Brown']);
    expect(filterRows(rows, 'jone')).toHaveLength(2);
  });
  it('empty query → all rows', () => {
    expect(filterRows(rows, '')).toEqual(rows);
  });
});

describe('csvToTable', () => {
  it('builds a table with a header row, escaping cells', () => {
    const html = csvToTable([['col<x>', 'b'], ['1', '2']], esc);
    expect(html).toContain('<th>col&lt;x&gt;</th>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<thead>');
  });
  it('caps rows and notes the truncation', () => {
    const rows = [['h']].concat(Array.from({ length: 50 }, (_, i) => [String(i)]));
    const html = csvToTable(rows, esc, 10);
    expect(html).toContain('showing 10 of 51 rows');
  });
});
