// ansi.js — clean a raw PTY transcript into readable text (Act plane, Phase 3 capture).
// Slipway transcripts are raw terminal bytes: ANSI colors/cursor moves, OSC titles, \r
// progress-bar overwrites, and full-screen TUI redraws. Pure + dependency-free → unit-tested.

// eslint-disable-next-line no-control-regex
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;              // window titles, hyperlinks
// CSI param bytes are 0x30-0x3F (incl. : < = > ? for SGR-colon, modifyOtherKeys, kitty-keyboard).
// eslint-disable-next-line no-control-regex
const CSI = /\x1b\[[0-9;:<=>?]*[ -/]*[@-~]/g;                   // colors, cursor moves, modes
// Other escape sequences: ESC + optional intermediates (0x20-0x2F) + a final (0x30-0x7E) —
// covers charset selects (ESC ( B), keypad mode (ESC =, ESC >), etc. Runs after CSI/OSC.
// eslint-disable-next-line no-control-regex
const ESC_SEQ = /\x1b[ -/]*[0-9:;<=>?@-~]/g;
// eslint-disable-next-line no-control-regex
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;               // control chars except \n \t \r

export function stripAnsi(s) {
  return String(s || '').replace(OSC, '').replace(CSI, '').replace(ESC_SEQ, '').replace(CTRL, '');
}

// Resolve in-line terminal overwrites: keep the segment after the last \r on each line
// (progress bars/spinners redraw the same line), then collapse runs of identical consecutive
// lines (full-screen TUI redraw noise).
export function collapseOverwrites(s) {
  const lines = String(s || '').split('\n').map((raw) => {
    // PTY output is CRLF — trailing \r is a line ENDING, not an overwrite. Strip ALL trailing \r
    // (cooked-mode ONLCR turns an app's own "\r\n" into "\r\r\n"), else the line would collapse to
    // the empty segment after it.
    const line = raw.replace(/\r+$/, '');
    const i = line.lastIndexOf('\r');
    return i === -1 ? line : line.slice(i + 1);
  });
  const out = [];
  for (const line of lines) {
    if (out.length && out[out.length - 1] === line && line.trim() !== '') continue;
    out.push(line);
  }
  return out.join('\n');
}

// The full cleaning pass capture/summarize use. Order matters: strip escapes first so \r
// segments compare as text, then resolve overwrites.
export function cleanTranscript(s) {
  return collapseOverwrites(stripAnsi(s)).trim();
}
