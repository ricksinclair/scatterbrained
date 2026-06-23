// Dependency-free .xlsx → rows reader. An .xlsx is an OOXML ZIP (same container as
// .docx/.pptx), so we reuse office.js `unzip` and read just the worksheet grid: the
// shared-string table (xl/sharedStrings.xml) plus the first worksheet's cells. Output
// matches parseCsv's shape — an array of string-rows, row[0] the header — so the
// existing spreadsheet viewer renders it unchanged. Approximate by design (a reader,
// not a converter): formulas yield their cached value, dates stay as serial numbers.
import { unzip } from './office.js';

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');                          // ampersand last
}

// "AB12" -> 27 (0-based column index); ignores the row part.
export function colToIndex(ref) {
  const m = /^([A-Za-z]+)/.exec(String(ref || ''));
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function rowOf(ref) { const m = /(\d+)\s*$/.exec(String(ref || '')); return m ? Number(m[1]) : 1; }

// Concatenate the text of every <t> inside a string-item, decoding entities.
function siText(xml) {
  let t = '', m; const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  while ((m = re.exec(xml))) t += m[1];
  return decodeEntities(t);
}

// xl/sharedStrings.xml -> ordered array; index == cell's <v> when t="s".
export function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = []; let m; const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  while ((m = re.exec(xml))) out.push(siText(m[1]));
  return out;
}

// Parse one worksheet's XML into a dense rows[][] grid (strings), filling gaps with ''.
export function parseSheet(xml, shared = []) {
  if (!xml) return [];
  const grid = new Map();           // 1-based spreadsheet row -> Map(colIdx -> value)
  let maxCol = -1, maxRow = 0;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let cm;
  while ((cm = cellRe.exec(xml))) {
    const attrs = cm[1] || '', inner = cm[2] || '';
    const refM = /\br="([A-Za-z]+\d+)"/.exec(attrs);
    const typeM = /\bt="([^"]+)"/.exec(attrs);
    if (!refM) continue;
    const col = colToIndex(refM[1]), rowNum = rowOf(refM[1]), type = typeM ? typeM[1] : 'n';
    let val = '';
    if (type === 'inlineStr') {
      val = siText(inner);
    } else {
      const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
      const raw = vM ? vM[1] : '';
      if (type === 's') { const idx = Number(raw); val = shared[idx] != null ? shared[idx] : ''; }
      else if (type === 'str') { val = decodeEntities(raw); }
      else if (type === 'b') { val = raw === '1' ? 'TRUE' : 'FALSE'; }
      else { val = decodeEntities(raw); }            // number / date-serial / general
    }
    if (!grid.has(rowNum)) grid.set(rowNum, new Map());
    grid.get(rowNum).set(col, val);
    if (col > maxCol) maxCol = col;
    if (rowNum > maxRow) maxRow = rowNum;
  }
  if (maxRow === 0 || maxCol < 0) return [];
  const rows = [];
  for (let r = 1; r <= maxRow; r++) {
    const cells = grid.get(r) || new Map();
    const arr = new Array(maxCol + 1).fill('');
    for (const [c, v] of cells) arr[c] = v;
    rows.push(arr);
  }
  return rows;
}

// Pick the workbook's first worksheet part (lowest-numbered sheetN.xml) and its name.
function firstSheetKey(files) {
  const keys = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => (parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10)));
  return keys[0] || null;
}
function firstSheetName(files) {
  const wb = files['xl/workbook.xml'];
  if (!wb) return 'Sheet1';
  const m = /<sheet\b[^>]*\bname="([^"]+)"/.exec(wb.toString('utf8'));
  return m ? decodeEntities(m[1]) : 'Sheet1';
}

// Unzipped files -> { name, rows } for the first worksheet.
export function firstSheet(files) {
  const key = firstSheetKey(files);
  if (!key) return { name: 'Sheet1', rows: [] };
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] ? files['xl/sharedStrings.xml'].toString('utf8') : '');
  const rows = parseSheet(files[key].toString('utf8'), shared);
  return { name: firstSheetName(files), rows };
}

// Convenience: raw .xlsx buffer -> { name, rows }.
export function parseXlsx(buf) { return firstSheet(unzip(buf)); }
