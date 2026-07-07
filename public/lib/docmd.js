// docmd.js — full-document markdown rendering for the Docs lens (pure).
// Wraps the vendored `marked` (public/vendor/marked.esm.js — the deliberate resolution
// of registry.js's "Open #1": real doc sets need tables/fences/nested lists/images,
// which is a parser, not a miniMarkdown extension). miniMarkdown stays for small
// trusted inspector snippets; THIS lane renders whole files from disk, so it sanitizes.
//
// renderDoc(text, {docPath, esc}) → { html, toc }:
//   · headings get stable slug ids and are collected into toc (scroll-spy)
//   · fenced code goes line-by-line through the existing highlightCode (--hl-* vars,
//     already theme-reactive) inside <pre class="doc-code">
//   · ```plantuml / ```puml fences become .doc-diagram placeholders carrying the
//     source (data-puml) with the highlighted source visible as the no-render fallback;
//     docs-ui.js hydrates them via /api/diagram/render (stage 6c)
//   · relative .md links → <a data-doc-link="resolved/path"> (in-lens navigation);
//     http(s) links open new-tab; other schemes render as plain text
//   · relative images → /api/raw?path= (the sandboxed byte endpoint)
// sanitizeDocHtml is the final belt: strip script/foreignObject/on*/bad URLs. marked
// does NOT sanitize; raw HTML blocks in the markdown are ESCAPED, not passed through.

import { Marked } from '../vendor/marked.esm.js';
import { highlightCode } from './codehl.js';
import { isWebUrl } from './links.js';

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function slugify(text, seen) {
  let id = String(text || '').toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'section';
  if (seen) { let base = id, i = 2; while (seen.has(id)) id = base + '-' + i++; seen.add(id); }
  return id;
}

// Resolve a relative link against the current doc's directory (pure path math, no fs).
export function resolveDocPath(href, docPath) {
  const dir = String(docPath || '').split('/').slice(0, -1);
  const parts = String(href || '').split('/');
  const out = [...dir];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

const codeBlock = (text, lang) => {
  const lines = String(text || '').split('\n');
  const body = lines.map((l) => highlightCode(l, lang || '', escHtml)).join('\n');
  return { body, langLabel: lang ? `<span class="doc-code-lang">${escHtml(lang)}</span>` : '' };
};

export function renderDoc(text, { docPath = '' } = {}) {
  const toc = [];
  const seen = new Set();
  const md = new Marked({
    gfm: true, breaks: false,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = slugify(inner, seen);
        if (depth <= 3) toc.push({ id, level: depth, text: inner.replace(/<[^>]*>/g, '') });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      code({ text: codeText, lang }) {
        const language = String(lang || '').toLowerCase();
        if (language === 'plantuml' || language === 'puml') {
          const { body } = codeBlock(codeText, '');
          return `<div class="doc-diagram" data-puml="${escHtml(codeText)}">` +
            `<pre class="doc-code doc-diagram-src">${body}</pre></div>\n`;
        }
        const { body, langLabel } = codeBlock(codeText, language);
        return `<pre class="doc-code">${langLabel}${body}</pre>\n`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = String(href || '');
        if (isWebUrl(url)) return `<a href="${escHtml(url)}" target="_blank" rel="noopener">${inner}</a>`;
        if (url.startsWith('#')) return `<a href="${escHtml(url)}">${inner}</a>`;
        if (/\.(md|markdown|txt|rst)(#[\w-]*)?$/i.test(url) && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
          const [p, frag] = url.split('#');
          return `<a href="#" data-doc-link="${escHtml(resolveDocPath(p, docPath))}"${frag ? ` data-doc-frag="${escHtml(frag)}"` : ''}>${inner}</a>`;
        }
        return inner;   // unknown scheme / non-doc file: text only (XSS posture)
      },
      image({ href, text: alt }) {
        const url = String(href || '');
        if (isWebUrl(url)) return `<img src="${escHtml(url)}" alt="${escHtml(alt)}" loading="lazy">`;
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return escHtml(alt || '');
        return `<img src="/api/raw?path=${encodeURIComponent(resolveDocPath(url, docPath))}" alt="${escHtml(alt)}" loading="lazy">`;
      },
      html({ text: raw }) { return escHtml(raw); },   // raw HTML never passes through
    },
  });
  const html = sanitizeDocHtml(md.parse(String(text || '')));
  return { html, toc };
}

// Final pass before innerHTML — same posture as the diagram SVG sanitizer.
export function sanitizeDocHtml(html) {
  let out = String(html || '');
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\s(href|src|xlink:href)\s*=\s*"([^"]*)"/gi, (m, attr, url) =>
    /^(https?:|#|\/api\/raw\?)/i.test(url.trim()) || url === '' ? m : ` ${attr}="#"`);
  return out;
}
