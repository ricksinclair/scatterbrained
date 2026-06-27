import { describe, it, expect } from 'vitest';
import { detectKind, expandRoots, isWithinRoots, pickPrimarySource, excerptAround, TEXT_KINDS } from '../lib/source.js';

describe('detectKind', () => {
  it('maps extensions to typed kinds, unknown otherwise', () => {
    expect(detectKind('/a/b.md')).toBe('markdown');
    expect(detectKind('/a/README.MARKDOWN')).toBe('markdown');
    expect(detectKind('notes.txt')).toBe('text');
    expect(detectKind('/x/deck.pptx')).toBe('pptx');
    expect(detectKind('/x/data.csv')).toBe('csv');
    expect(detectKind('/x/photo.png')).toBe('unknown');
    expect(detectKind('')).toBe('unknown');
  });
  it('classifies text-readable kinds', () => {
    expect(TEXT_KINDS.has('markdown')).toBe(true);
    expect(TEXT_KINDS.has('pdf')).toBe(false);
  });
});

describe('expandRoots', () => {
  it('resolves ~ and accepts {path} or string roots', () => {
    const roots = expandRoots({ roots: [{ path: '~/Projects/X' }, '/abs/Y'] }, '/home/demo');
    expect(roots).toContain('/home/demo/Projects/X');
    expect(roots).toContain('/abs/Y');
  });
});

describe('isWithinRoots — the read sandbox', () => {
  const roots = ['/home/demo/Projects/Northwind', '/home/demo/Projects/notes'];
  it('accepts files inside a root', () => {
    expect(isWithinRoots('/home/demo/Projects/Northwind/README.md', roots)).toBe(true);
    expect(isWithinRoots('/home/demo/Projects/Northwind', roots)).toBe(true);   // the root itself
  });
  it('rejects traversal and outside paths', () => {
    expect(isWithinRoots('/home/demo/Projects/Northwind/../../.ssh/id_rsa', roots)).toBe(false);
    expect(isWithinRoots('/etc/passwd', roots)).toBe(false);
    expect(isWithinRoots('', roots)).toBe(false);
  });
  it('is not fooled by a prefix-collision sibling dir', () => {
    expect(isWithinRoots('/home/demo/Projects/Northwind-secret/x.md', roots)).toBe(false);
  });
});

describe('pickPrimarySource', () => {
  it('prefers the node\'s own file_path', () => {
    expect(pickPrimarySource({ file_path: '/a/n.md', name: 'N' }, [])).toEqual({ filePath: '/a/n.md', title: 'N' });
  });
  it('falls back to the first incoming Source edge with a file', () => {
    const edges = [
      { dir: 'out', label: 'Project', name: 'P' },
      { dir: 'in', label: 'Source', name: 'doc.md', file_path: '/a/doc.md' },
    ];
    expect(pickPrimarySource({ name: 'N' }, edges)).toEqual({ filePath: '/a/doc.md', title: 'doc.md' });
  });
  it('returns null when no file is available', () => {
    expect(pickPrimarySource({ name: 'N' }, [{ dir: 'in', label: 'Source', url: 'https://x' }])).toBeNull();
  });
  it('prefers the source most relevant to the node name over an earlier generic one', () => {
    const edges = [
      { dir: 'in', label: 'Source', name: 'colorado.md', file_path: '/orgs/regions/colorado.md' },
      { dir: 'in', label: 'Source', name: 'ietf-profile.md', file_path: '/orgs/ietf-profile.md' },
    ];
    const r = pickPrimarySource({ name: 'Internet Engineering Task Force (IETF)' }, edges);
    expect(r.filePath).toBe('/orgs/ietf-profile.md');   // matches 'ietf', not the first (colorado)
  });
  it('prefers a readable candidate over an earlier unreadable one', () => {
    const edges = [
      { dir: 'in', label: 'Source', name: 'far', file_path: '/outside/a.md' },
      { dir: 'in', label: 'Source', name: 'near', file_path: '/ok/b.md' },
    ];
    const readable = (p) => p.startsWith('/ok/');
    expect(pickPrimarySource({ name: 'N' }, edges, readable)).toEqual({ filePath: '/ok/b.md', title: 'near' });
    // none readable → still returns the first so the caller can show a blocked note
    expect(pickPrimarySource({ name: 'N' }, edges, () => false)).toEqual({ filePath: '/outside/a.md', title: 'far' });
  });
});

describe('excerptAround', () => {
  const content = ['line one', 'intro text', 'the COOPERATIVE bylaws', 'detail a', 'detail b', 'tail'].join('\n');
  it('windows around the first keyword match (case-insensitive)', () => {
    const r = excerptAround(content, ['cooperative'], { context: 1 });
    expect(r.matchedLine).toBe(3);
    expect(r.text).toContain('the COOPERATIVE bylaws');
    expect(r.text).toContain('intro text');     // 1 line of context before
    expect(r.text).toContain('detail a');        // 1 line after
    expect(r.text).not.toContain('line one');
    expect(r.truncated).toBe(true);
  });
  it('falls back to the head when nothing matches', () => {
    const r = excerptAround(content, ['zzz'], { maxLines: 2 });
    expect(r.matchedLine).toBe(0);
    expect(r.text).toBe('line one\nintro text');
    expect(r.truncated).toBe(true);
  });
  it('ignores too-short keywords and bounds by maxLines', () => {
    const big = Array.from({ length: 100 }, (_, i) => 'row ' + i).join('\n');
    const r = excerptAround(big, ['a', 'of'], { maxLines: 10 });   // short kws dropped → head
    expect(r.text.split('\n').length).toBe(10);
  });
});
