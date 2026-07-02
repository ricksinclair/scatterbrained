// resolveLayout — "the graph expresses its own UI".
// Pure function: given a node's content signals (and runtime capabilities), return
// the ordered list of detail-panel components to render. No DOM; fully unit-tested.
//
// Signal fields read from `node` (all optional):
//   label, sourceKind, filePath, url, confidence, jurisdiction,
//   tags[] (e.g. 'ui:chart'), ui[] (explicit ordered component ids),
//   renderHint (single id), hasText, isTabular, sourceCount, edgeCount,
//   superseded, hasHistory
// `caps`: { llm, notion } — capability flags (e.g. a local LLM is connected).

import { isVideoUrl, isWebUrl } from './links.js';

export const COMPONENTS = [
  'markdown', 'excerpt', 'chart', 'text', 'timeline', 'resurface', 'flashcard',
  'provenance', 'relations', 'confidence', 'goal-progress', 'map', 'keyvalue', 'ai-summary', 'ai-qa',
  'protected-facts', 'notes',
  'video', 'link',
];

// durable knowledge nodes that can age and warrant a "revisit?" nudge (resurface)
const DURABLE = ['Insight', 'Goal', 'Project', 'Idea'];

// components that require a capability to be useful
const REQUIRES = { 'ai-summary': (caps) => !!caps.llm, 'ai-qa': (caps) => !!caps.llm };

export function resolveLayout(node = {}, caps = {}) {
  const out = [];
  const add = (c) => {
    if (!c || out.includes(c) || !COMPONENTS.includes(c)) return;
    if (REQUIRES[c] && !REQUIRES[c](caps)) return;       // capability-gated (e.g. ai-summary)
    out.push(c);
  };

  // 1. explicit hints from the graph win (single hint, then ordered ui[], then ui:* tags)
  add(node.renderHint);
  (node.ui || []).forEach(add);
  (node.tags || []).forEach((t) => { if (typeof t === 'string' && t.startsWith('ui:')) add(t.slice(3)); });

  // 2. content-type body
  if (['markdown', 'text'].includes(node.sourceKind) && node.hasText) add('markdown');
  else if (node.sourceKind === 'csv' || node.isTabular) add('chart');
  // NOTE: a relation-distribution "connections by type" chart was previously added here for any
  // node with >=5 edges, but it duplicated the `relations` component (which already groups edges
  // by type). `relations` is now the single source of by-type connection info; `chart` is reserved
  // for a node's own tabular/numeric data (the csv/isTabular case above). [dedup, 2026-06-25]
  if (node.hasText && !out.includes('markdown')) add('text');
  // web links: a video URL embeds a player inline; any other web URL gets a rich
  // link card. Both sit above `excerpt` so the link is the headline, not a footnote.
  if (node.url && isVideoUrl(node.url)) add('video');
  else if (node.url && isWebUrl(node.url)) add('link');
  // The "See" layer: a real backing file always offers an excerpt of its *actual*
  // contents — complementary to `markdown`/`text`, which render the stored summary.
  if (node.filePath || node.url) add('excerpt');

  // 3. label-specific
  if (node.label === 'Rule' && node.confidence) add('confidence');
  if (node.label === 'Goal') add('goal-progress');
  if (node.jurisdiction) add('map');
  // resurface is offered for durable nodes; the component self-suppresses (renders
  // empty) unless the node is actually due, so the resolver needn't know the date.
  if (DURABLE.includes(node.label)) add('resurface');

  // 4. always-on when the data is present
  if (node.superseded || node.hasHistory) add('timeline');
  if ((node.sourceCount || 0) > 0) add('provenance');
  if ((node.edgeCount || 0) > 0) add('relations');

  // 5. AI enhancers (only when a local model is connected; gated by REQUIRES)
  add('ai-summary');
  add('ai-qa');

  // 6. the raw property inspector — always offered (collapsed by default in the UI)
  //    so every node exposes its full property bag, not just the curated components.
  add('keyvalue');
  // 7. governance + inbox, always offered: protected facts (#23) a rewrite must honor,
  //    then the deferred-instruction note inbox. Both render their own add affordance.
  add('protected-facts');
  add('notes');
  return out;
}
