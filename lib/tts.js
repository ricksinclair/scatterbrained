// tts.js — the server side of the local-TTS lane (VOICE Phase 7): manages the warm
// kokoro runner (bin/kokoro-tts.py) as a lazy, auto-respawning child speaking JSON-lines.
// Availability = the venv + model files exist on disk; absent → the browser falls back
// to Web Speech through the same provider seam. Zero npm deps — node:child_process only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PY = path.join(os.homedir(), '.scatterbrained', 'tts-venv', 'bin', 'python');
const MODEL = path.join(os.homedir(), '.scatterbrained', 'tts', 'kokoro-v1.0.onnx');
const VOICES_BIN = path.join(os.homedir(), '.scatterbrained', 'tts', 'voices-v1.0.bin');
const RUNNER = path.join(__dirname, '..', 'bin', 'kokoro-tts.py');

// Curated voice menu, British first (Rick's default register). Kokoro ships more; add
// on demand rather than dumping the whole zoo into Settings.
export const TTS_VOICES = [
  { id: 'bm_george', label: 'George · British male' },
  { id: 'bm_lewis', label: 'Lewis · British male' },
  { id: 'bf_emma', label: 'Emma · British female' },
  { id: 'bf_isabella', label: 'Isabella · British female' },
  { id: 'am_michael', label: 'Michael · American male' },
  { id: 'af_bella', label: 'Bella · American female' },
];
export const TTS_DEFAULT = 'bm_george';
export const isTtsVoice = (v) => TTS_VOICES.some((x) => x.id === v);

export function ttsAvailable() {
  return fs.existsSync(VENV_PY) && fs.existsSync(MODEL) && fs.existsSync(VOICES_BIN);
}

let child = null, ready = false;
const pending = new Map();   // id → { resolve, timer }

function ensureChild() {
  if (child) return;
  ready = false;
  child = spawn(VENV_PY, [RUNNER], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.ready) { ready = true; continue; }
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); clearTimeout(p.timer); p.resolve(msg); }
    }
  });
  const gone = () => {
    for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: 'tts runner exited' }); }
    pending.clear(); child = null; ready = false;
  };
  child.on('exit', gone);
  child.on('error', gone);
}

// synth(text, voice, {speed}) → { ok, wav: Buffer, duration } | { ok:false, error }
export function synth(text, voice = TTS_DEFAULT, { speed = 1.0, timeoutMs = 30000 } = {}) {
  if (!ttsAvailable()) return Promise.resolve({ ok: false, error: 'local tts not installed' });
  ensureChild();
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: 'tts timeout' });
    }, timeoutMs);
    pending.set(id, {
      resolve: (msg) => resolve(msg.ok ? { ok: true, wav: Buffer.from(msg.b64, 'base64'), duration: msg.duration } : { ok: false, error: msg.error }),
      timer,
    });
    try {
      child.stdin.write(JSON.stringify({ id, text: String(text).slice(0, 4000), voice: isTtsVoice(voice) ? voice : TTS_DEFAULT, speed: Math.min(Math.max(Number(speed) || 1, 0.5), 2) }) + '\n');
    } catch {
      clearTimeout(timer); pending.delete(id);
      resolve({ ok: false, error: 'tts runner unavailable' });
    }
  });
}
