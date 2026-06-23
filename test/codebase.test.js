import { describe, it, expect } from 'vitest';
import { langOf, parseImports, normalizeRel, resolveImport, buildModuleGraph, parsesImports, extractsRefs, IGNORE_DIRS,
  dependents, dependencies, findPath, orphans, cycles, summary } from '../lib/codebase.js';

describe('langOf', () => {
  it('maps extensions to languages', () => {
    expect(langOf('a/b.ts')).toBe('ts');
    expect(langOf('x.JSX')).toBe('js');
    expect(langOf('s.py')).toBe('py');
    expect(langOf('styles.css')).toBe('css');
    expect(langOf('README.md')).toBe('doc');
    expect(langOf('Makefile')).toBe('other');
    expect(langOf('')).toBe('other');
  });
});

describe('parseImports', () => {
  it('pulls relative JS/TS specifiers, drops bare packages', () => {
    const src = `
      import { a } from './a.js';
      import b from "../lib/b";
      export { c } from './c';
      import 'react';            // bare → dropped
      const d = require('./d');
      const e = await import("./e.ts");
      import x from 'lodash';     // bare → dropped
    `;
    const got = parseImports(src, 'ts');
    expect(got).toContain('./a.js');
    expect(got).toContain('../lib/b');
    expect(got).toContain('./c');
    expect(got).toContain('./d');
    expect(got).toContain('./e.ts');
    expect(got).not.toContain('react');
    expect(got).not.toContain('lodash');
  });
  it('does not treat member access (obj.import) as an import', () => {
    expect(parseImports("foo.import('./x')", 'js')).toEqual([]);
  });
  it('parses css @import', () => {
    expect(parseImports("@import './base.css';\n@import url('http://x/y.css');", 'css')).toContain('./base.css');
  });
  it('returns nothing for unparsed langs', () => {
    expect(parseImports('import os', 'py')).toEqual([]);
    expect(parsesImports('py')).toBe(false);
    expect(parsesImports('ts')).toBe(true);
  });
});

describe('langOf — asset kinds', () => {
  it('classifies images, fonts, media so assets are first-class nodes', () => {
    expect(langOf('logo.jpg')).toBe('image');
    expect(langOf('photo.JPEG')).toBe('image');
    expect(langOf('icon.svg')).toBe('image');
    expect(langOf('font.woff2')).toBe('font');
    expect(langOf('clip.mp4')).toBe('media');
    expect(langOf('page.html')).toBe('html');
  });
});

describe('reference extraction (markup / styles / docs reference local files)', () => {
  it('HTML: src/href to scripts, styles, images, pages (incl. bare paths)', () => {
    const html = `<link href="styles.css"><script src="./app.js"></script>
      <img src="images/logo.jpg"><a href="https://x.com/y">ext</a><a href="#top">anchor</a>`;
    const got = parseImports(html, 'html');
    expect(got).toContain('styles.css');
    expect(got).toContain('./app.js');
    expect(got).toContain('images/logo.jpg');     // bare relative path kept (it's a local file)
    expect(got).not.toContain('https://x.com/y');  // external dropped
    expect(got.some((s) => s.startsWith('#'))).toBe(false);
  });
  it('CSS: @import and url() assets/fonts, query stripped', () => {
    const css = `@import "base.css"; body{background:url('bg.png?v=2')} @font-face{src:url(font.woff2)}`;
    const got = parseImports(css, 'css');
    expect(got).toContain('base.css');
    expect(got).toContain('bg.png');               // ?v=2 stripped
    expect(got).toContain('font.woff2');
  });
  it('Markdown: image + link references to local files', () => {
    const md = `![logo](./img/logo.png) and [spec](../docs/spec.md) and [web](http://x)`;
    const got = parseImports(md, 'doc');
    expect(got).toContain('./img/logo.png');
    expect(got).toContain('../docs/spec.md');
    expect(got).not.toContain('http://x');
  });
  it('extractsRefs covers code + markup/doc/config langs', () => {
    expect(['js', 'ts', 'css', 'html', 'doc', 'data'].every(extractsRefs)).toBe(true);
    expect(extractsRefs('image')).toBe(false);
  });
  it('config/manifest (data) files reference their entry/asset paths', () => {
    const angular = '{ "build": { "options": { "browser": "src/main.ts", "tsConfig": "tsconfig.app.json", "styles": ["src/styles.scss"], "assets": ["public"] } }, "version": "1.0.0" }';
    const got = parseImports(angular, 'data');
    expect(got).toContain('src/main.ts');
    expect(got).toContain('tsconfig.app.json');
    expect(got).toContain('src/styles.scss');
    expect(got).not.toContain('public');        // a dir, no slash/ext → not a candidate
  });
});

describe('buildModuleGraph — config files are the build linkers (angular.json case)', () => {
  it('wires the entry/styles/tsconfig that no source file references (fixes the island)', () => {
    const g = buildModuleGraph([
      { rel: 'angular.json', text: '{"browser":"src/main.ts","tsConfig":"tsconfig.app.json","styles":["src/styles.scss"]}' },
      { rel: 'src/main.ts', text: "import { cfg } from './app.config';" },
      { rel: 'src/app.config.ts', text: '' },
      { rel: 'tsconfig.app.json', text: '{}' },
      { rel: 'src/styles.scss', text: '' },
    ]);
    const edges = g.links.map((l) => `${l.source}->${l.target}`);
    expect(edges).toContain('angular.json->src/main.ts');       // the build config now links the entry
    expect(edges).toContain('angular.json->tsconfig.app.json');
    expect(edges).toContain('angular.json->src/styles.scss');
    expect(g.nodes.find((n) => n.id === 'src/styles.scss').deg).toBe(1);   // no longer an island
  });
});

describe('buildModuleGraph — assets connect to the page/stylesheet that references them', () => {
  it('an HTML page links to its image, script and stylesheet; CSS to its bg image', () => {
    const g = buildModuleGraph([
      { rel: 'index.html', text: '<link href="style.css"><script src="app.js"></script><img src="img/logo.jpg">' },
      { rel: 'style.css', text: 'body{background:url("img/bg.png")}' },
      { rel: 'app.js', text: '' },
      { rel: 'img/logo.jpg', text: '' },
      { rel: 'img/bg.png', text: '' },
    ]);
    const edges = g.links.map((l) => `${l.source}->${l.target}`);
    expect(edges).toContain('index.html->style.css');
    expect(edges).toContain('index.html->app.js');
    expect(edges).toContain('index.html->img/logo.jpg');   // the JPEG now belongs to the page
    expect(edges).toContain('style.css->img/bg.png');
    expect(g.nodes.find((n) => n.id === 'img/logo.jpg').deg).toBe(1);   // no longer an island
  });
  it('resolves web-root asset refs that omit the public/ prefix (the real-world case)', () => {
    const g = buildModuleGraph([
      { rel: 'src/app/home/home.html', text: '<img src="infographics/timeline.png">' },
      { rel: 'public/infographics/timeline.png', text: '' },
    ]);
    // referenced as "infographics/…" but lives under public/ → still connected
    expect(g.links.map((l) => `${l.source}->${l.target}`)).toContain('src/app/home/home.html->public/infographics/timeline.png');
  });
});

describe('normalizeRel', () => {
  it('collapses . and .. segments', () => {
    expect(normalizeRel('a/b/../c')).toBe('a/c');
    expect(normalizeRel('./a/./b')).toBe('a/b');
    expect(normalizeRel('a/b/c/../../d')).toBe('a/d');
  });
});

describe('resolveImport — completion against the repo file set', () => {
  const set = new Set(['src/a.ts', 'src/lib/b.ts', 'src/lib/index.ts', 'src/c.js']);
  it('resolves exact, extension, and index completions relative to the importer', () => {
    expect(resolveImport('src/a.ts', './lib/b', set)).toBe('src/lib/b.ts');
    expect(resolveImport('src/a.ts', './lib', set)).toBe('src/lib/index.ts');
    expect(resolveImport('src/lib/b.ts', '../c', set)).toBe('src/c.js');
    expect(resolveImport('src/a.ts', './c.js', set)).toBe('src/c.js');
  });
  it('returns null for externals / unmatched targets', () => {
    expect(resolveImport('src/a.ts', './nope', set)).toBe(null);
  });
});

describe('buildModuleGraph', () => {
  const files = [
    { rel: 'src/app.ts', text: "import { fmt } from './util/fmt'; import './styles.css';" },
    { rel: 'src/util/fmt.ts', text: "import { z } from './zod-helper';" },
    { rel: 'src/util/zod-helper.ts', text: "import 'zod';" },
    { rel: 'src/styles.css', text: '' },
    { rel: 'README.md', text: '# docs' },
  ];
  it('creates a node per file and an edge per resolved in-repo import', () => {
    const g = buildModuleGraph(files);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      ['README.md', 'src/app.ts', 'src/styles.css', 'src/util/fmt.ts', 'src/util/zod-helper.ts'],
    );
    const edges = g.links.map((l) => `${l.source}->${l.target}`);
    expect(edges).toContain('src/app.ts->src/util/fmt.ts');
    expect(edges).toContain('src/app.ts->src/styles.css');
    expect(edges).toContain('src/util/fmt.ts->src/util/zod-helper.ts');
  });
  it('annotates nodes with lang, dir, basename, degree', () => {
    const g = buildModuleGraph(files);
    const app = g.nodes.find((n) => n.id === 'src/app.ts');
    expect(app.lang).toBe('ts');
    expect(app.dir).toBe('src');
    expect(app.name).toBe('app.ts');
    expect(app.deg).toBe(2);                 // two outgoing resolved imports
    const fmt = g.nodes.find((n) => n.id === 'src/util/fmt.ts');
    expect(fmt.deg).toBe(2);                 // imported by app + imports zod-helper
  });
  it('de-duplicates repeated imports and ignores bare packages', () => {
    const g = buildModuleGraph([
      { rel: 'a.ts', text: "import './b'; import './b'; import 'react';" },
      { rel: 'b.ts', text: '' },
    ]);
    expect(g.links).toHaveLength(1);
  });
});

describe('IGNORE_DIRS', () => {
  it('covers the usual noise', () => {
    ['node_modules', '.git', 'dist', '__pycache__', 'coverage'].forEach((d) => expect(IGNORE_DIRS.has(d)).toBe(true));
  });
});

// A small fixed graph: app→util, app→styles, util→helper, helper→util (cycle), lib (orphan-ish)
const G = {
  nodes: [{ id: 'app.ts', lang: 'ts' }, { id: 'util.ts', lang: 'ts' }, { id: 'helper.ts', lang: 'ts' },
          { id: 'styles.css', lang: 'css' }, { id: 'entry.ts', lang: 'ts' }],
  links: [
    { source: 'app.ts', target: 'util.ts' }, { source: 'app.ts', target: 'styles.css' },
    { source: 'util.ts', target: 'helper.ts' }, { source: 'helper.ts', target: 'util.ts' },
    { source: 'entry.ts', target: 'app.ts' },
  ],
};

describe('graph queries', () => {
  it('dependents: who imports a file (direct + transitive)', () => {
    expect(dependents(G, 'styles.css').sort()).toEqual(['app.ts']);
    expect(dependents(G, 'app.ts', { transitive: true }).sort()).toEqual(['entry.ts']);
  });
  it('dependencies: what a file imports (direct + transitive)', () => {
    expect(dependencies(G, 'app.ts').sort()).toEqual(['styles.css', 'util.ts']);
    expect(dependencies(G, 'entry.ts', { transitive: true }).sort()).toEqual(['app.ts', 'helper.ts', 'styles.css', 'util.ts']);
  });
  it('findPath: shortest import path or null', () => {
    expect(findPath(G, 'entry.ts', 'helper.ts')).toEqual(['entry.ts', 'app.ts', 'util.ts', 'helper.ts']);
    expect(findPath(G, 'styles.css', 'app.ts')).toBe(null);
    expect(findPath(G, 'app.ts', 'app.ts')).toEqual(['app.ts']);
  });
  it('orphans: files nothing imports', () => {
    expect(orphans(G).sort()).toEqual(['entry.ts']);
  });
  it('cycles: detects the util↔helper import cycle', () => {
    const c = cycles(G);
    expect(c).toHaveLength(1);
    expect(c[0].sort()).toEqual(['helper.ts', 'util.ts']);
  });
  it('summary: counts, languages, and degree-ranked hubs', () => {
    const s = summary(G);
    expect(s.fileCount).toBe(5);
    expect(s.edgeCount).toBe(5);
    expect(s.languages).toEqual({ ts: 4, css: 1 });
    expect(s.hubs[0].degree).toBe(3);                                   // app.ts & util.ts tie at degree 3
    expect(s.hubs.slice(0, 2).map((h) => h.file).sort()).toEqual(['app.ts', 'util.ts']);
  });
});

describe('buildModuleGraph — index.html boots the single config-declared entry', () => {
  it('connects index.html to the app entry (the build convention), only when unambiguous', () => {
    const g = buildModuleGraph([
      { rel: 'angular.json', text: '{"browser":"src/main.ts"}' },
      { rel: 'src/index.html', text: '<link href="favicon.ico">' },
      { rel: 'favicon.ico', text: '' },
      { rel: 'src/main.ts', text: '' },
    ]);
    const edges = g.links.map((l) => `${l.source}->${l.target}`);
    expect(edges).toContain('src/index.html->src/main.ts');          // no longer an island
    expect(edges).toContain('src/index.html->favicon.ico');
  });
  it('does NOT guess when there are multiple config-declared entries', () => {
    const g = buildModuleGraph([
      { rel: 'angular.json', text: '{"browser":"src/main.ts"}' },
      { rel: 'package.json', text: '{"module":"src/other.ts"}' },
      { rel: 'index.html', text: '' },
      { rel: 'src/main.ts', text: '' },
      { rel: 'src/other.ts', text: '' },
    ]);
    expect(g.links.some((l) => l.source === 'index.html')).toBe(false);   // ambiguous → no synthetic edge
  });
});
