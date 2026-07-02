import { describe, it, expect } from 'vitest';
import { emptyState } from '../public/lib/empty-state.js';

describe('emptyState — the one designed empty/error state (D2)', () => {
  it('renders the constellation motif + a title', () => {
    const html = emptyState({ title: 'All clean' });
    expect(html).toContain('class="empty-state"');
    expect(html).toContain('es-motif');
    expect(html).toContain('currentColor');       // theme-aware: dots + hairlines inherit ink
    expect(html).toContain('aria-hidden="true"'); // decorative
    expect(html).toContain('All clean');
  });

  it('escapes title, body, and action label/cmd (never trusts caller strings)', () => {
    const html = emptyState({
      title: '<b>x</b>', body: 'a "quote" & <i>tag</i>',
      action: { label: '<script>', cmd: 'evil" onmouseover="x' },
    });
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<i>tag</i>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a &quot;quote&quot; &amp; &lt;i&gt;tag&lt;/i&gt;');
    expect(html).toContain('data-cmd="evil&quot; onmouseover=&quot;x"');
  });

  it('renders a command action as a data-cmd button (the delegated dispatch path)', () => {
    const html = emptyState({ title: 'No folders', action: { label: 'Manage folders', cmd: 'manage-folders' } });
    expect(html).toContain('<button type="button" class="es-action" data-cmd="manage-folders">Manage folders</button>');
  });

  it('renders an action without a cmd as a plain button (caller wires it)', () => {
    const html = emptyState({ title: 'Failed', action: { label: 'Retry' } });
    expect(html).toContain('class="es-action"');
    expect(html).not.toContain('data-cmd');
  });

  it('renders an href action as a safe external link', () => {
    const html = emptyState({ title: 'x', action: { label: 'Docs', href: 'https://example.com/' } });
    expect(html).toContain('<a class="es-action" href="https://example.com/" target="_blank" rel="noopener">Docs</a>');
  });

  it('no action → no action element; no body → no body element', () => {
    const html = emptyState({ title: 'Nothing here' });
    expect(html).not.toContain('es-action');
    expect(html).not.toContain('es-body');
  });

  it('an icon overrides the motif', () => {
    const html = emptyState({ icon: '⚠', title: 'x' });
    expect(html).toContain('es-icon');
    expect(html).toContain('⚠');
    expect(html).not.toContain('es-motif');
  });
});
