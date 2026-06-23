// protected-facts.js — protected key-facts (#23). Pure, DOM-free, tested. The single source
// for the ProtectedFact vocabulary, candidate detection, value normalization, and the
// rewrite-guard diff. Shared by the server (suggest/check/pin endpoints), the inspector
// `protected-facts` section, and the `protected-fact-check` CLI that graph-sync calls before it
// overwrites a node's text.
//
// The discipline: a "second brain that remembers" must HONOR its verified details. When a
// node's text is rewritten (demo cleanup, LLM polish, graph-sync, by hand), a pinned ProtectedFact
// that no longer appears verbatim is a correctness failure — surfaced for approval, never
// silently dropped. (Distinct from the `key-facts` metric row — that's a UI summary; these
// are first-class ProtectedFact nodes ABOUT a target.)

// Closed vocabulary of fact kinds — same single-source discipline as schedule.js / vocab.js.
// `re` is the detector for auto-suggesting candidates; kinds without one are pin-only.
export const KIND_META = {
  money:      { label: 'amount',     re: /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:million|billion|thousand|bn|[kmb])?\b/gi },
  percent:    { label: 'percent',    re: /\b\d[\d,]*(?:\.\d+)?\s?%/g },
  date:       { label: 'date',       re: /\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  citation:   { label: 'citation',   re: /\b\d+\s+U\.?S\.?C\.?\s*§+\s*\d+[\w().-]*|\bSubchapter\s+[A-Z]\b|\b(?:§|Section)\s*\d+[\w().-]*|\b\d{3,4}-[A-Z]{1,5}\b/g },
  number:     { label: 'number',     re: /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b/g },
  identifier: { label: 'identifier', re: null },   // codes/SKUs/IDs — too varied to auto-detect; pin only
  name:       { label: 'name',       re: null },   // proper names — pin only
  other:      { label: 'fact',       re: null },
};
export const PROTECTED_FACT_KINDS = Object.keys(KIND_META);

export function isProtectedFactKind(k) {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(KIND_META, k);
}

// Normalize a value for robust presence-matching: lowercase, collapse whitespace, tighten
// the spacing around §, and drop thousands-separators so "$4,200" matches "$4200". The SAME
// transform is applied to both the needle (the fact) and the haystack (the new text), so the
// comparison is space-/comma-/case-insensitive without losing the digits that matter.
export function normalizeValue(v) {
  if (v == null) return '';
  return String(v)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*§\s*/g, '§')
    .replace(/u\.\s*s\.\s*c\.?/g, 'usc')
    .replace(/,(?=\d{3}\b)/g, '')
    .trim();
}

// Detect protectable-fact candidates in free text — deterministic, no LLM. Returns
// [{ value, kind, index }] in document order, with overlapping matches resolved by kind
// priority (money > percent > date > citation > number) so "$4,200" isn't also a bare number.
const DETECT_ORDER = ['money', 'percent', 'date', 'citation', 'number'];
export function detectCandidates(text) {
  const s = String(text || '');
  if (!s) return [];
  const claimed = []; // [start, end) spans already taken by a higher-priority kind
  const overlaps = (a, b) => claimed.some(([s0, e0]) => a < e0 && b > s0);
  const out = [];
  for (const kind of DETECT_ORDER) {
    const re = KIND_META[kind].re;
    if (!re) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const value = m[0].trim().replace(/[.,;:]+$/, '');   // drop trailing sentence punctuation
      const start = m.index, end = m.index + m[0].length;
      if (!value || overlaps(start, end)) continue;
      claimed.push([start, end]);
      out.push({ value, kind, index: start });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// The rewrite guard. Given the node's live ProtectedFacts and the proposed new text, return the
// facts that would be lost. A fact survives iff its normalized value still appears in the new
// text. A casualty is `altered` when exactly one same-kind candidate in the new text is novel
// (a likely replacement → suggestedNew), else `dropped`. Pure; the caller decides whether to
// block, queue for approval, or apply.
export function checkRewrite(facts, newText) {
  const list = Array.isArray(facts) ? facts : [];
  const hay = normalizeValue(newText);
  const candidates = detectCandidates(newText);
  const pinnedNorms = new Set(list.map((f) => f.value_norm || normalizeValue(f.value)));
  const violations = [];
  for (const f of list) {
    const needle = f.value_norm || normalizeValue(f.value);
    if (!needle || hay.includes(needle)) continue;
    const nearby = [...new Set(
      candidates.filter((c) => c.kind === f.kind && !pinnedNorms.has(normalizeValue(c.value))).map((c) => c.value)
    )];
    const suggestedNew = nearby.length === 1 ? nearby[0] : null;
    violations.push({
      id: f.id || null,
      value: f.value,
      kind: f.kind,
      status: suggestedNew ? 'altered' : 'dropped',
      suggestedNew,
      nearby,
    });
  }
  return { ok: violations.length === 0, violations };
}
