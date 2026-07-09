// Slipway autostart — pure decision logic (server.js owns the spawn/probe I/O).
//
// Studio treats Slipway (127.0.0.1:8765) as its local-model runtime. Models are NOT
// loaded by default, so an idle Slipway is near-zero cost — safe to bring up with the
// Studio. We only ever START the panel process; we never load a model on the user's
// behalf (that stays an explicit action — see the voice panel's Load-model affordance).
import path from 'node:path';

// Decide what boot should do. Pure: callers pass env + the ping result.
//   → 'disabled'        SLIPWAY_AUTOSTART=0 — leave everything alone
//   → 'already-running' something answers /api/status on :8765 — never double-spawn
//   → 'spawn'           start it
export function autostartDecision({ env = {}, pingOk = false } = {}) {
  if (env.SLIPWAY_AUTOSTART === '0') return 'disabled';
  if (pingOk) return 'already-running';
  return 'spawn';
}

// Ordered list of dirs to look for Slipway's server.py in — the caller picks the first that
// actually exists (that stat is I/O, so it lives in server.js). Priority:
//   1. SLIPWAY_DIR             explicit override (dev pointing at a working checkout)
//   2. <root>/slipway          the copy VENDORED into a Scatterbrained release (bundled Act plane)
//   3. ~/Projects/mlx-control  the private dev checkout (canonical Slipway)
// So a packaged install runs the bundled copy, while a dev tree with mlx-control still works.
export function slipwayDirCandidates({ env = {}, home = '', root = '' } = {}) {
  const dirs = [];
  if (env.SLIPWAY_DIR) dirs.push(env.SLIPWAY_DIR);
  if (root) dirs.push(path.join(root, 'slipway'));
  dirs.push(path.join(home, 'Projects', 'mlx-control'));
  return dirs;
}

// Resolve the spawn command for a chosen dir (or the legacy default when none is passed —
// keeps the old {env, home} call working). Spawned through the user's LOGIN shell (-lc) so
// Slipway sees the same PATH as a manual launch — verified failure otherwise: a bare
// 'python3' resolved to the CommandLineTools 3.9 with no vllm-mlx on PATH, and every MLX
// model load died with "exited during load".
export function slipwayCommand({ env = {}, home = '', dir = '' } = {}) {
  const resolved = dir || env.SLIPWAY_DIR || path.join(home, 'Projects', 'mlx-control');
  const serverPy = path.join(resolved, 'server.py');
  return { cmd: env.SHELL || '/bin/zsh', args: ['-lc', `exec python3 '${serverPy}'`], cwd: resolved, serverPy };
}
