// ai-diagram.js — "diagram this": node text → PlantUML via the local model, validated
// by actually rendering. Small local models chatter and mis-syntax; the design is
// therefore: (1) kind-LOCKED skeleton prompt with a complete tiny example of the exact
// target dialect, (2) extract the @start…@end block from wherever it lands, (3) render
// to validate, (4) ONE retry feeding the render error back, (5) honest structured
// failure carrying the bad source. generateImpl/renderImpl injectable for tests.

const RULES = `Rules:
- Output ONLY the diagram, nothing else — no explanation, no markdown fence.
- Do NOT use skinparam, !include, !theme, <style>, or colors — the Studio themes it.
- At most 25 elements. Short labels (under 6 words each).`;

const KIND_PROMPTS = {
  mindmap: `Draw a PlantUML MINDMAP summarizing the ideas and their structure.
Example of the exact expected output format:
@startmindmap
* Central topic
** First theme
*** A detail
** Second theme
@endmindmap
Use ONLY the * / ** / *** depth syntax (no boxes, no arrows). One root.`,
  component: `Draw a PlantUML component diagram of the system/concepts and their relationships.
Example of the exact expected output format:
@startuml
rectangle "Web app" as a1 <<Project>>
rectangle "Database" as a2 <<Resource>>
a1 --> a2 : reads
@enduml
Use ONLY \`rectangle "Label" as idN <<Stereotype>>\` lines and \`idA --> idB : verb\` arrows.
Stereotypes must come from: Insight, Idea, Project, Goal, Person, Organization, Rule, Resource, Skill, Source.`,
  sequence: `Draw a PlantUML sequence diagram of the flow/process described.
Example of the exact expected output format:
@startuml
participant "User" as u
participant "System" as s
u -> s : request
s --> u : response
@enduml
Use ONLY participant declarations and -> / --> arrows with short messages.`,
};

export function buildDiagramPrompt(kind, context, retryError, badSource) {
  const head = KIND_PROMPTS[kind] || KIND_PROMPTS.mindmap;
  if (retryError) {
    return `${head}\n${RULES}\n\nYour previous diagram failed to render.\nError: ${retryError}\nPrevious attempt:\n${badSource}\n\nReturn ONLY the corrected diagram.`;
  }
  return `${head}\n${RULES}\n\nContent to diagram:\n${context}\n\nDiagram:`;
}

// Pull the @start…@end block out of chatty output (prose around it, or a ```fence).
export function extractPuml(text) {
  const m = String(text || '').match(/@start(\w+)[\s\S]*?@end\1/);
  return m ? m[0].trim() : null;
}

// The lane. → { puml, svg, attempts } | { error, puml?, attempts }
export async function aiDiagram(provider, context, kind, { generateImpl, renderImpl } = {}) {
  let last = { error: 'generation failed' };
  let bad = null, badErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = buildDiagramPrompt(kind, context, badErr, bad);
    const out = await generateImpl(provider, prompt, { temperature: 0.1, maxTokens: 700, timeoutMs: 60000 });
    if (out == null) return { error: 'generation failed', attempts: attempt };
    const puml = extractPuml(out);
    if (!puml) { bad = out.slice(0, 2000); badErr = 'no @start…@end diagram block found in the output'; last = { error: badErr, attempts: attempt }; continue; }
    const r = await renderImpl(puml);
    if (r.svg) return { puml, svg: r.svg, kind, attempts: attempt };
    bad = puml; badErr = r.line ? `line ${r.line}: ${r.error}` : r.error;
    last = { error: `diagram failed to render after ${attempt} attempt${attempt > 1 ? 's' : ''}: ${badErr}`, puml, attempts: attempt };
  }
  return last;
}
