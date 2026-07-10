import { describe, it, expect } from 'vitest';
import { renderDoc, sanitizeDocHtml, resolveDocPath, slugify } from '../public/lib/docmd.js';

describe('docmd — real doc-set constructs', () => {
  it('renders tables, ordered/nested lists, blockquotes (the miniMarkdown gaps)', () => {
    const { html } = renderDoc('| a | b |\n|---|---|\n| 1 | 2 |\n\n1. one\n2. two\n\n> quoted');
    expect(html).toContain('<table>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<blockquote>');
  });
  it('fenced code goes through highlightCode (theme-reactive hl-* classes) with a lang label', () => {
    const { html } = renderDoc('```js\nconst a = "hi"; // note\n```');
    expect(html).toContain('doc-code');
    expect(html).toContain('hl-');
    expect(html).toContain('doc-code-lang');
  });
  it('headings get stable slug ids and populate the TOC (h1–h3 only)', () => {
    const { html, toc } = renderDoc('# Alpha\n## Beta Two\n#### Deep');
    expect(html).toContain('<h1 id="alpha">');
    expect(html).toContain('<h2 id="beta-two">');
    expect(toc).toEqual([
      { id: 'alpha', level: 1, text: 'Alpha' },
      { id: 'beta-two', level: 2, text: 'Beta Two' },
    ]);
  });
  it('duplicate headings get de-duplicated ids', () => {
    const { toc } = renderDoc('## Setup\n## Setup');
    expect(toc.map((t) => t.id)).toEqual(['setup', 'setup-2']);
    const seen = new Set(['x']); expect(slugify('x', seen)).toBe('x-2');
  });
  it('TOC text decodes entities — "&" headings never show as "&amp;"', () => {
    const { toc } = renderDoc('# Time & the intention clock\n## "Quotes" <tags>');
    expect(toc[0].text).toBe('Time & the intention clock');
    expect(toc[1].text).toBe('"Quotes" <tags>');
  });
});

describe('docmd — frontmatter never renders (docs-curation)', () => {
  it('strips a leading frontmatter block before parsing', () => {
    const { html, toc } = renderDoc('---\naudience: user\nsection: guides\norder: 1\n---\n# Themes\nbody');
    expect(html).not.toContain('audience');
    expect(html).toContain('<h1 id="themes">');
    expect(toc[0].text).toBe('Themes');
  });
  it('leaves a mid-document --- (an hr) and an unclosed block alone', () => {
    expect(renderDoc('# T\n\n---\n\nmore').html).toContain('<hr>');
    expect(renderDoc('---\naudience: user\nnever closed').html).toContain('audience');
  });
});

describe('docmd — plantuml fences (stage 6c hydration contract)', () => {
  it('becomes a .doc-diagram placeholder carrying the source, with visible fallback', () => {
    const { html } = renderDoc('```plantuml\n@startuml\nA -> B\n@enduml\n```');
    expect(html).toContain('class="doc-diagram"');
    expect(html).toContain('data-puml="@startuml');
    expect(html).toContain('doc-diagram-src');       // honest fallback: the source shows
    const puml = renderDoc('```puml\n@startmindmap\n* x\n@endmindmap\n```').html;
    expect(puml).toContain('doc-diagram');
  });
});

describe('docmd — links and images', () => {
  it('relative .md links become in-lens data-doc-link with resolved paths', () => {
    const { html } = renderDoc('[spec](../SPEC.md) [frag](GUIDE.md#part-2)', { docPath: 'docs/DESIGN.md' });
    expect(html).toContain('data-doc-link="SPEC.md"');
    expect(html).toContain('data-doc-link="docs/GUIDE.md"');
    expect(html).toContain('data-doc-frag="part-2"');
  });
  it('external links open new-tab with noopener; unknown schemes render as text', () => {
    const { html } = renderDoc('[ok](https://example.com) [bad](javascript:alert(1))');
    expect(html).toContain('target="_blank" rel="noopener"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('bad');
  });
  it('relative images route through the sandboxed /api/raw; remote http images pass', () => {
    const { html } = renderDoc('![shot](screenshots/a.png)\n\n![ext](https://x.io/i.png)', { docPath: 'r/docs/D.md' });
    expect(html).toContain('/api/raw?path=' + encodeURIComponent('r/docs/screenshots/a.png'));
    expect(html).toContain('https://x.io/i.png');
  });
  it('resolveDocPath handles ./ ../ and nesting', () => {
    expect(resolveDocPath('../SPEC.md', 'root/docs/a.md')).toBe('root/SPEC.md');
    expect(resolveDocPath('./b.md', 'root/a.md')).toBe('root/b.md');
    expect(resolveDocPath('sub/c.md', 'root/docs/a.md')).toBe('root/docs/sub/c.md');
  });
});

describe('docmd — sanitization (whole files from disk hit innerHTML)', () => {
  it('raw HTML blocks in markdown are escaped, never passed through', () => {
    const { html } = renderDoc('before\n\n<script>alert(1)</script>\n\n<div onclick="x()">hi</div>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onclick=');
    expect(html).toContain('&lt;script&gt;');
  });
  it('sanitizeDocHtml strips script/on*/non-http URLs as the final belt', () => {
    const out = sanitizeDocHtml('<a href="javascript:x()">a</a><img src="file:///etc/passwd"><p onmouseover="p()">t</p><a href="https://ok.io">b</a>');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('file://');
    expect(out).not.toContain('onmouseover');
    expect(out).toContain('https://ok.io');
  });
});
