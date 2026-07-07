// stt.js — the server side of the on-device speech-recognition lane (VOICE Phase 9):
// manages the warm whisper runner (bin/whisper-stt.py) exactly like lib/tts.js manages
// kokoro — lazy spawn, JSON-lines, pending-map, auto-respawn. Availability = the shared
// venv + the install marker + at least the default model on disk; absent → the browser
// falls back to Web Speech through the same provider seam.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PY = path.join(os.homedir(), '.scatterbrained', 'tts-venv', 'bin', 'python');
const STT_DIR = path.join(os.homedir(), '.scatterbrained', 'stt');
const RUNNER = path.join(__dirname, '..', 'bin', 'whisper-stt.py');

export const STT_MODELS = [
  { id: 'large-v3-turbo', label: 'Whisper turbo · best accuracy' },
  { id: 'small.en', label: 'Whisper small.en · fastest' },
];
export const STT_DEFAULT = 'large-v3-turbo';
export const isSttModel = (m) => STT_MODELS.some((x) => x.id === m);

export function sttAvailable() {
  return fs.existsSync(VENV_PY) && fs.existsSync(path.join(STT_DIR, '.installed'))
    && fs.existsSync(path.join(STT_DIR, STT_DEFAULT));
}
export const installedModels = () => STT_MODELS.filter((m) => fs.existsSync(path.join(STT_DIR, m.id)));

let child = null;
const pending = new Map();   // id → { resolve, timer }

function ensureChild() {
  if (child) return;
  child = spawn(VENV_PY, [RUNNER], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) continue;
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg); }
    }
  });
  const gone = () => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'stt runner exited' }); }
    pending.clear(); child = null;
  };
  child.on('exit', gone);
  child.on('error', gone);
}

// transcribe(wavBuffer, model) → { ok, text } | { ok:false, error }
export function transcribe(wav, model = STT_DEFAULT, { timeoutMs = 30000 } = {}) {
  if (!sttAvailable()) return Promise.resolve({ ok: false, error: 'local stt not installed' });
  ensureChild();
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'stt timeout' }); }, timeoutMs);
    pending.set(id, { resolve: (msg) => resolve(msg.ok ? { ok: true, text: msg.text } : { ok: false, error: msg.error }), timer });
    try {
      child.stdin.write(JSON.stringify({ id, wav_b64: wav.toString('base64'), model: isSttModel(model) ? model : STT_DEFAULT }) + '\n');
    } catch {
      clearTimeout(timer); pending.delete(id);
      resolve({ ok: false, error: 'stt runner unavailable' });
    }
  });
}
