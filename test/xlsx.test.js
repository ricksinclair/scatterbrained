import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { colToIndex, parseSharedStrings, parseSheet, parseXlsx } from '../lib/xlsx.js';

// Minimal local-header-only ZIP (matches office.js unzip), mirroring office.test.js.
function makeZip(entries) {
  const chunks = [];
  for (const [name, content] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6);
    h.writeUInt16LE(8, 8); h.writeUInt32LE(0, 14); h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    chunks.push(h, nameBuf, comp);
  }
  return Buffer.concat(chunks);
}

describe('xlsx — column letters', () => {
  it('maps A/B/Z/AA/AB to 0-based indexes', () => {
    expect(colToIndex('A1')).toBe(0);
    expect(colToIndex('B7')).toBe(1);
    expect(colToIndex('Z2')).toBe(25);
    expect(colToIndex('AA1')).toBe(26);
    expect(colToIndex('AB10')).toBe(27);
  });
});

describe('xlsx — shared strings', () => {
  it('extracts ordered strings and decodes entities, including multi-run <si>', () => {
    const xml = '<sst><si><t>Name</t></si><si><t>A &amp; B</t></si>' +
      '<si><r><t>Hello </t></r><r><t>world</t></r></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(['Name', 'A & B', 'Hello world']);
  });
});

describe('xlsx — sheet grid', () => {
  const shared = ['Name', 'Role', 'Maya', 'Eng'];
  const sheet =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>42</v></c></row>' +
    '<row r="3"><c r="B3" t="str"><v>inline</v></c></row>' +   // sparse: A3 missing
    '</sheetData></worksheet>';

  it('builds a dense rows grid, filling gaps with empty strings', () => {
    const rows = parseSheet(sheet, shared);
    expect(rows[0]).toEqual(['Name', 'Role', '']);     // header padded to maxCol
    expect(rows[1]).toEqual(['Maya', 'Eng', '42']);    // number kept as string
    expect(rows[2]).toEqual(['', 'inline', '']);       // missing A3 -> ''
  });

  it('returns [] for an empty sheet', () => {
    expect(parseSheet('<worksheet><sheetData/></worksheet>', [])).toEqual([]);
  });
});

describe('xlsx — end to end via ZIP', () => {
  it('parses a real-ish .xlsx buffer into { name, rows }', () => {
    const buf = makeZip({
      'xl/workbook.xml': '<workbook><sheets><sheet name="People" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Maya</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    });
    const { name, rows } = parseXlsx(buf);
    expect(name).toBe('People');
    expect(rows).toEqual([['Name'], ['Maya']]);
  });
});
