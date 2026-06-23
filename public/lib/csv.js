// CSV / TSV parsing for the spreadsheet viewer. Pure + tested; the reader turns the
// rows into an HTML table. Handles quoted fields, escaped "" quotes, embedded commas
// and newlines, and auto-detects tab vs comma so .tsv works too.

export function detectDelimiter(text) {
  const nl = String(text).indexOf('\n');
  const line = nl < 0 ? String(text) : String(text).slice(0, nl);
  return line.split('\t').length > line.split(',').length ? '\t' : ',';
}

export function parseCsv(text, delim) {
  const s = String(text || '');
  delim = delim || detectDelimiter(s);
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }   // escaped quote
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }   // trailing field/row
  return rows;
}

// Is a column (across body rows) entirely numeric? Drives numeric vs. lexical sort and
// right-alignment. Tolerates thousands separators, currency, percent, and blanks.
export function isNumericColumn(rows, col) {
  let seen = 0;
  for (let i = 1; i < rows.length; i++) {
    const v = String(rows[i][col] ?? '').trim();
    if (v === '') continue;
    if (Number.isNaN(Number(v.replace(/[,$%\s]/g, '')))) return false;
    seen++;
  }
  return seen > 0;
}

// Sort body rows by a column, keeping the header row pinned at index 0. dir: asc|desc|none.
export function sortRows(rows, col, dir) {
  if (!rows.length || col == null || dir === 'none') return rows.slice();
  const num = isNumericColumn(rows, col);
  const key = (r) => {
    const v = r[col] ?? '';
    return num ? (Number(String(v).replace(/[,$%\s]/g, '')) || 0) : String(v).toLowerCase();
  };
  const body = rows.slice(1).sort((a, b) => { const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  if (dir === 'desc') body.reverse();
  return [rows[0], ...body];
}

// Keep the header + body rows where any cell contains the (case-insensitive) query.
export function filterRows(rows, query) {
  const q = String(query || '').toLowerCase();
  if (!q || !rows.length) return rows.slice();
  return [rows[0], ...rows.slice(1).filter((r) => r.some((c) => String(c).toLowerCase().includes(q)))];
}

// Render parsed rows as an HTML table string. First row is treated as the header.
// `esc` is the caller's HTML-escaper; rows are capped to keep the DOM light.
export function csvToTable(rows, esc, max = 2000) {
  if (!rows.length) return '<div class="fr-note">empty</div>';
  const shown = rows.slice(0, max);
  const head = shown[0].map((c) => `<th>${esc(c)}</th>`).join('');
  const body = shown.slice(1).map((r) =>
    `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  const more = rows.length > max ? `<caption class="csv-more">showing ${max} of ${rows.length} rows</caption>` : '';
  return `<table class="csv-table">${more}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
