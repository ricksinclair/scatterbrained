import { describe, it, expect } from 'vitest';
import { autostartDecision, slipwayCommand } from '../lib/slipway-boot.js';

// Slipway autostart decision logic — server.js owns the I/O (ping, spawn, readiness poll);
// these cover the pure decision + command resolution so the boot path can't regress silently.

describe('autostartDecision', () => {
  it('spawns when nothing answers and autostart is not disabled', () => {
    expect(autostartDecision({ env: {}, pingOk: false })).toBe('spawn');
  });
  it('never double-spawns when Slipway already answers', () => {
    expect(autostartDecision({ env: {}, pingOk: true })).toBe('already-running');
  });
  it('SLIPWAY_AUTOSTART=0 disables entirely — even when nothing is running', () => {
    expect(autostartDecision({ env: { SLIPWAY_AUTOSTART: '0' }, pingOk: false })).toBe('disabled');
    expect(autostartDecision({ env: { SLIPWAY_AUTOSTART: '0' }, pingOk: true })).toBe('disabled');
  });
  it('any other SLIPWAY_AUTOSTART value keeps the default-on behavior', () => {
    expect(autostartDecision({ env: { SLIPWAY_AUTOSTART: '1' }, pingOk: false })).toBe('spawn');
    expect(autostartDecision({ env: { SLIPWAY_AUTOSTART: '' }, pingOk: false })).toBe('spawn');
  });
  it('defaults are safe when called bare', () => {
    expect(autostartDecision()).toBe('spawn');
    expect(autostartDecision({})).toBe('spawn');
  });
});

describe('slipwayCommand', () => {
  it('runs server.py through the login shell so PATH matches a manual launch', () => {
    const { cmd, args, cwd, serverPy } = slipwayCommand({ env: { SHELL: '/bin/zsh' }, home: '/Users/alice' });
    expect(cmd).toBe('/bin/zsh');
    expect(args[0]).toBe('-lc');
    expect(args[1]).toContain("python3 '/Users/alice/Projects/mlx-control/server.py'");
    expect(serverPy).toBe('/Users/alice/Projects/mlx-control/server.py');
    expect(cwd).toBe('/Users/alice/Projects/mlx-control');
  });
  it('falls back to /bin/zsh when SHELL is unset', () => {
    expect(slipwayCommand({ env: {}, home: '/Users/alice' }).cmd).toBe('/bin/zsh');
  });
  it('SLIPWAY_DIR overrides the checkout location', () => {
    const { args, cwd, serverPy } = slipwayCommand({ env: { SLIPWAY_DIR: '/opt/slipway' }, home: '/Users/alice' });
    expect(args[1]).toContain("'/opt/slipway/server.py'");
    expect(serverPy).toBe('/opt/slipway/server.py');
    expect(cwd).toBe('/opt/slipway');
  });
});
