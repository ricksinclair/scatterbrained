import { describe, it, expect } from 'vitest';
import { buildFileTree, flattenTree } from '../public/lib/filetree.js';

const files = [
  { rel: 'src/api/routes.ts', path: '/r/src/api/routes.ts', lang: 'ts' },
  { rel: 'src/api/errors.ts', path: '/r/src/api/errors.ts', lang: 'ts' },
  { rel: 'src/index.ts', path: '/r/src/index.ts', lang: 'ts' },
  { rel: 'README.md', path: '/r/README.md', lang: 'markdown' },
];

describe('filetree — buildFileTree', () => {
  it('nests files under their directories', () => {
    const root = buildFileTree(files);
    expect([...root.dirs.keys()]).toEqual(['src']);
    expect(root.files.map((f) => f.name)).toEqual(['README.md']);
    const src = root.dirs.get('src');
    expect([...src.dirs.keys()]).toEqual(['api']);
    expect(src.files.map((f) => f.name)).toEqual(['index.ts']);
    expect(src.dirs.get('api').path).toBe('src/api');
    expect(src.dirs.get('api').files.map((f) => f.name).sort()).toEqual(['errors.ts', 'routes.ts']);
  });
  it('tolerates empty / malformed input', () => {
    expect(buildFileTree(null).files).toEqual([]);
    expect(buildFileTree([{ path: '/x' }]).files).toEqual([]);   // no rel → skipped
  });
});

describe('filetree — flattenTree', () => {
  it('emits dirs before files, alphabetical, depth-tagged', () => {
    const rows = flattenTree(buildFileTree(files));
    expect(rows.map((r) => `${r.type}:${r.name}@${r.depth}`)).toEqual([
      'dir:src@0', 'dir:api@1', 'file:errors.ts@2', 'file:routes.ts@2', 'file:index.ts@1', 'file:README.md@0',
    ]);
  });
  it('hides a collapsed directory subtree', () => {
    const rows = flattenTree(buildFileTree(files), new Set(['src/api']));
    const labels = rows.map((r) => `${r.type}:${r.name}`);
    expect(labels).toContain('dir:api');
    expect(labels).not.toContain('file:routes.ts');   // subtree hidden
    expect(rows.find((r) => r.name === 'api').collapsed).toBe(true);
  });
  it('collapsing a parent hides nested dirs too', () => {
    const rows = flattenTree(buildFileTree(files), new Set(['src']));
    const names = rows.map((r) => r.name);
    expect(names).toContain('src');
    expect(names).not.toContain('api');
    expect(names).not.toContain('index.ts');
    expect(names).toContain('README.md');
  });
});
