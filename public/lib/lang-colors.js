// lang-colors.js — language → color palette, shared by the codebase-map lens and the
// code-review file dots. Pure data; extracted from app.js so both surfaces share one source.
export const LANG_COLORS = {
  js: '#e0b25a', ts: '#79b4ab', py: '#5a9fd4', go: '#6fc5d6', rust: '#d77f42',
  css: '#c77dff', html: '#ef9a5b', vue: '#7fd6a0', svelte: '#e06b5a',
  doc: '#8f8a7c', data: '#9aa0ab', shell: '#9ad06f', sql: '#d6a05a',
  image: '#d6688a', font: '#b07fd6', media: '#5fb0a0', other: '#6c727c',
};
export const langColor = (l) => LANG_COLORS[l] || LANG_COLORS.other;
