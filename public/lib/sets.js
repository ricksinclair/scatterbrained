// Closed vocabulary of named component SETS — the unit graph-sync assigns most
// often (SPEC §10.7). A set groups component ids that belong together; a view has a
// default set. Code-only (not graph-declarable) so the vocabulary stays lintable.
// Only components that actually exist in the registry should appear here.
export const SETS = {
  evidence: ['provenance', 'relations', 'timeline'],   // Insight / claim nodes
  decision: ['rationale', 'goal-progress'],            // Decision / Goal nodes (rationale: future)
  viewers: ['excerpt', 'markdown', 'text'],            // a node with a primary file
  // VOICE Phase 5: the closed vocabulary the assistant's show_panel tool may compose —
  // the injection-safety boundary (the model names component ids, never HTML). Everything
  // form-bearing, capability-gated, or data-heavy (ai-*, chart, flashcard, notes, viewers)
  // stays out until a real need appears.
  'voice-panel': ['markdown', 'relations', 'timeline', 'provenance', 'goal-progress', 'acceptance', 'keyvalue'],
};

// The default set a view leads with (the rest of the resolved layout follows).
export const DEFAULT_SET_BY_VIEW = {
  inspector: null,                 // inspector just follows the resolver order
  report: 'evidence',              // report leads with the evidence bundle when present
};

export function setMembers(id) { return SETS[id] ? [...SETS[id]] : []; }
