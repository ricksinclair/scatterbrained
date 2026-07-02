import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guard the icon class: every Tabler icon the UI references must exist in the vendored
// subset (public/vendor/tabler-subset.css). A missing glyph renders as a tofu block — the
// "due/overdue had a block icon" bug (calendar-clock + refresh weren't in the subset).
const root = fileURLToPath(new URL('../public/', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');

const SUBSET = read('vendor/tabler-subset.css');
const defined = new Set([...SUBSET.matchAll(/\.ti-([a-z0-9-]+)\s*\{/g)].map((m) => m[1]));

// Sources that reference icons, plus how icons appear there.
const SOURCES = ['app.js', 'index.html', 'lib/registry.js'];

function referencedIcons() {
  const names = new Set();
  for (const f of SOURCES) {
    const src = read(f);
    // 1. Static markup: class="ti ti-NAME"
    for (const m of src.matchAll(/\bti ti-([a-z0-9-]+)/g)) names.add(m[1]);
    // 2. Dynamic dock sections: dockSection('key', 'icon-name', ...)
    for (const m of src.matchAll(/dockSection\(\s*'[^']+'\s*,\s*'([a-z0-9-]+)'/g)) names.add(m[1]);
  }
  return names;
}

describe('Tabler icon subset coverage', () => {
  it('defines every icon the UI references (no tofu blocks)', () => {
    const missing = [...referencedIcons()].filter((n) => !defined.has(n)).sort();
    expect(missing, `add these to public/vendor/tabler-subset.css: ${missing.join(', ')}`).toEqual([]);
  });
});
