// persona.js — the assistant's one character definition (VOICE feature). Two consumers:
// the MCP path reuses PERSONA_BRIEF verbatim (initialize.instructions + voice_connect
// result) so any connected agent adopts it; the built-in local path flattens it into a
// single prompt via buildLocalSystemPrompt (lib/inference.js generate() takes one prompt,
// not a messages array — Ollama /api/generate fidelity is a documented v1 limit).

export const PERSONA_BRIEF = [
  'You are the Scatterbrained assistant — a calm, capable personal aide inside a',
  'local-first knowledge-graph studio. You report on the user\'s projects (what\'s due,',
  'what\'s stale, what\'s new) and help them think. Ground every claim in the context',
  'you are given; if the context doesn\'t cover it, say so plainly. Your replies are',
  'SPOKEN aloud: keep them under ~3 sentences, conversational, no markdown, no lists',
  'unless asked. Long content belongs in a note, not in speech.',
].join(' ');

// Digest rows → a compact spoken-context block. Rows come from fetchDigestRows
// ({id, name, label, kind, date, projects[]}); cap keeps the prompt bounded even
// on a busy month (the agenda card, not the voice reply, is the full view).
export function digestBlock(rows = [], { cap = 20 } = {}) {
  if (!rows.length) return 'Agenda: nothing due or up for review in the next 30 days.';
  const lines = rows.slice(0, cap).map((r) =>
    `- ${r.kind === 'review' ? 'review' : 'due'} ${r.date}: ${r.name} (${r.label}${r.projects && r.projects.length ? ', ' + r.projects.join('/') : ''})`);
  const more = rows.length > cap ? `\n(+${rows.length - cap} more)` : '';
  return `Agenda (next 30 days, today is ${new Date().toISOString().slice(0, 10)}):\n${lines.join('\n')}${more}`;
}

// "What did we do recently?" needs the newest captured conclusions in the prompt —
// the local lane has no recall tools, so recall is injected (you hit this on
// 2026-07-04: the graph knew everything, the model saw none of it).
export function recentBlock(rows = [], { cap = 8 } = {}) {
  if (!rows.length) return '';
  const lines = rows.slice(0, cap).map((r) => `- [${String(r.created_at || '').slice(0, 10)}] ${r.name}`);
  return `Recently captured in the knowledge graph (newest first):\n${lines.join('\n')}`;
}

// Utterance-driven retrieval: graph nodes matching what the user just said, with a bite
// of their text — the injected stand-in for a search tool.
export function findingsBlock(hits = [], { cap = 3 } = {}) {
  const rows = hits.slice(0, cap).filter((h) => h && h.name);
  if (!rows.length) return '';
  const lines = rows.map((h) => `- ${h.name} (${h.label})${h.text ? ': ' + String(h.text).slice(0, 350) : ''}`);
  return `Graph nodes matching the user's words:\n${lines.join('\n')}`;
}

// Aggregate awareness for the tool-less local lane: "how many active projects?" must be
// answerable from the prompt (you, 2026-07-04 — second recall gap in one morning).
// rows: [{k: 'project:active', c: 9}, {k: 'goal:unset', c: 14}, ...]
export function overviewBlock(rows = []) {
  if (!rows.length) return '';
  const groups = {};
  for (const r of rows) {
    const [kind, status] = String(r.k).split(':');
    (groups[kind] = groups[kind] || []).push(`${r.c} ${status}`);
  }
  const lines = Object.entries(groups).map(([kind, parts]) => {
    const total = rows.filter((r) => String(r.k).startsWith(kind + ':')).reduce((s, r) => s + Number(r.c), 0);
    return `- ${total} ${kind}s: ${parts.join(', ')}`;
  });
  return `Graph overview (live counts):\n${lines.join('\n')}`;
}

// One flattened prompt for the local lane: persona + injected context + recent turns.
// history: [{role:'you'|'assistant', text}] — the reducer's shape, most recent last.
export function buildLocalSystemPrompt({ digest = '', overview = '', recent = '', findings = '', node = null, history = [], utterance = '' } = {}) {
  const parts = [PERSONA_BRIEF];
  if (overview) parts.push('', overview);
  if (digest) parts.push('', digest);
  if (recent) parts.push('', recent);
  if (findings) parts.push('', findings);
  if (node) parts.push('', `The user is currently looking at this node:\n${node}`);
  const turns = (history || []).slice(-8).filter((m) => m && m.text);
  if (turns.length) {
    parts.push('', 'Conversation so far:');
    for (const m of turns) parts.push(`${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.text}`);
  }
  parts.push('', `User: ${utterance}`, '', 'Assistant:');
  return parts.join('\n');
}
