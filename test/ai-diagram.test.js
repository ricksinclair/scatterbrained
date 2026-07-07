import { describe, it, expect } from 'vitest';
import { buildDiagramPrompt, extractPuml, aiDiagram } from '../lib/ai-diagram.js';

describe('ai-diagram — prompt building', () => {
  it('locks the dialect with a complete example and hard rules', () => {
    const p = buildDiagramPrompt('mindmap', 'CONTEXT');
    expect(p).toContain('@startmindmap');
    expect(p).toContain('Do NOT use skinparam');
    expect(p).toContain('CONTEXT');
  });
  it('component prompt restricts stereotypes to graph labels', () => {
    expect(buildDiagramPrompt('component', 'x')).toContain('Insight, Idea, Project');
  });
  it('retry prompt feeds the render error and the failing source back', () => {
    const p = buildDiagramPrompt('mindmap', 'x', 'line 3: bad arrow', '@startmindmap\n*a\n@endmindmap');
    expect(p).toContain('failed to render');
    expect(p).toContain('line 3: bad arrow');
    expect(p).toContain('Return ONLY the corrected diagram');
  });
});

describe('ai-diagram — extraction from chatty output', () => {
  it('pulls the block out of prose and fences', () => {
    expect(extractPuml('Sure! Here you go:\n```plantuml\n@startmindmap\n* a\n@endmindmap\n```\nHope that helps!'))
      .toBe('@startmindmap\n* a\n@endmindmap');
    expect(extractPuml('@startuml\nA->B\n@enduml')).toBe('@startuml\nA->B\n@enduml');
  });
  it('matches the closing tag to the opening dialect', () => {
    expect(extractPuml('@startuml\nA->B\n@endmindmap\n@enduml')).toBe('@startuml\nA->B\n@endmindmap\n@enduml'.match(/@start(\w+)[\s\S]*?@end\1/)[0]);
    expect(extractPuml('no diagram here')).toBeNull();
  });
});

describe('ai-diagram — the validate-by-render loop', () => {
  const prov = { model: 'test' };
  it('happy path: one attempt, rendered', async () => {
    const r = await aiDiagram(prov, 'ctx', 'mindmap', {
      generateImpl: async () => '@startmindmap\n* a\n@endmindmap',
      renderImpl: async () => ({ svg: '<svg/>' }),
    });
    expect(r).toEqual({ puml: '@startmindmap\n* a\n@endmindmap', svg: '<svg/>', kind: 'mindmap', attempts: 1 });
  });
  it('retries ONCE with the render error fed back, then succeeds', async () => {
    const prompts = [];
    let call = 0;
    const r = await aiDiagram(prov, 'ctx', 'mindmap', {
      generateImpl: async (_p, prompt) => { prompts.push(prompt); return '@startmindmap\n* fix' + (call++) + '\n@endmindmap'; },
      renderImpl: async () => (call <= 1 ? { error: 'bad node', line: 2 } : { svg: '<svg/>' }),
    });
    expect(r.attempts).toBe(2);
    expect(r.svg).toBe('<svg/>');
    expect(prompts[1]).toContain('line 2: bad node');   // the error went back to the model
  });
  it('two failures → honest structured error carrying the source', async () => {
    const r = await aiDiagram(prov, 'ctx', 'mindmap', {
      generateImpl: async () => '@startmindmap\n* bad\n@endmindmap',
      renderImpl: async () => ({ error: 'Syntax Error' }),
    });
    expect(r.svg).toBeUndefined();
    expect(r.error).toContain('failed to render');
    expect(r.puml).toContain('@startmindmap');
    expect(r.attempts).toBe(2);
  });
  it('no extractable block → retries, then honest error; null generation is terminal', async () => {
    const chatty = await aiDiagram(prov, 'ctx', 'mindmap', {
      generateImpl: async () => 'I cannot draw that, sorry.',
      renderImpl: async () => ({ svg: '<svg/>' }),
    });
    expect(chatty.error).toContain('no @start');
    const dead = await aiDiagram(prov, 'ctx', 'mindmap', {
      generateImpl: async () => null,
      renderImpl: async () => ({ svg: '<svg/>' }),
    });
    expect(dead).toEqual({ error: 'generation failed', attempts: 1 });
  });
});
