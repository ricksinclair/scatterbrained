// Model-load consent — pure decision logic (voice-ui.js owns the dialog + the POST).
//
// Loading a local model is not a toggle: it pulls gigabytes of weights into memory and an
// MLX load takes 15-60s, during which a small Mac can feel wedged. So it is an explicit,
// full-screen accept/decline — never a side effect of touching a dropdown. This module says
// what that dialog should read; it never renders or fetches.
//
// Sizes arrive from Slipway's /api/models as human strings: `du -sh` for MLX ("28G", "2.1G")
// and `ollama list` for Ollama ("2.1 GB"). Cloud rows carry a provider label in `size`, which
// is why parseSizeGb refuses anything it can't read rather than guessing a number.

// A model at or above this reads as a hang rather than a load — the 28GB default was the
// original offender (a 28GB first-launch wall "reads as broken"), a ~2-3GB 4-bit build is fine.
export const HEAVY_GB = 10;

const UNITS = { M: 1 / 1024, G: 1, T: 1024 };

// "28G" | "2.1 GB" | "512M" → GB as a number. Unreadable → null (never a fabricated size).
export function parseSizeGb(size) {
  const m = /^\s*([\d.]+)\s*([MGT])B?\s*$/i.exec(String(size ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return n * UNITS[m[2].toUpperCase()];
}

const short = (id) => String(id || '').split('/').pop();

// Format for humans without lying about precision: 28 GB, 2.3 GB, 0.5 GB.
function gbLabel(gb) {
  return `${Number(gb.toFixed(1))} GB`;
}

// What the consent dialog should say for one model. Pure: model row in, copy out.
export function consentView({ id, backend = 'local', size } = {}) {
  const gb = parseSizeGb(size);
  const heavy = gb !== null && gb >= HEAVY_GB;
  const sizeLabel = gb === null ? null : gbLabel(gb);
  const body = sizeLabel
    ? `${sizeLabel} of weights will be loaded into memory by ${backend}.`
    : `Its size is unknown — ${backend} will load it into memory.`;
  return {
    model: short(id),
    id,
    backend,
    sizeLabel,
    heavy,
    title: 'Load this model?',
    body,
    // Only the heavy case earns a second sentence; a 2GB load needs no scare copy.
    warning: heavy
      ? 'This is a large model. Loading can take a minute or more and will occupy most of your memory while it runs.'
      : null,
    confirmLabel: 'Load model',
    cancelLabel: 'Not now',
  };
}

// The brain picker's options. Lists EVERY loadable local model — not just the resident one,
// which is why switching models used to be impossible from the orb (/api/ai/ping reports only
// what is in memory). `resident` is the model actually loaded; the rest need a consented load.
export function pickerOptions({ models = [], resident = null, agent = null } = {}) {
  const opts = [];
  const agentOn = !!(agent && agent.connected);
  if (agentOn) opts.push({ value: 'agent', label: `agent · ${agent.model}`, resident: true, selected: true });
  for (const m of models) {
    const gb = parseSizeGb(m.size);
    const suffix = gb === null ? '' : ` · ${gbLabel(gb)}`;
    opts.push({
      value: `local:${m.id}`,
      model: m.id,
      backend: m.backend,
      size: m.size,
      label: `${m.backend || 'local'} · ${short(m.id)}${suffix}`,
      resident: m.id === resident,
      selected: !agentOn && m.id === resident,
    });
  }
  return opts;
}
