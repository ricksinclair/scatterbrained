import { describe, it, expect } from 'vitest';
import { stripAnsi, collapseOverwrites, cleanTranscript } from '../lib/ansi.js';

// Transcript cleaning (Act plane Phase 3): raw PTY bytes → readable text for hashing +
// local-model summarization.

describe('stripAnsi', () => {
  it('removes SGR colors', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m plain')).toBe('green plain');
  });
  it('removes cursor movement + erase sequences', () => {
    expect(stripAnsi('\x1b[2K\x1b[1Ahello\x1b[10;20H')).toBe('hello');
  });
  it('removes OSC window titles and hyperlinks (BEL and ST terminated)', () => {
    expect(stripAnsi('\x1b]0;my title\x07text')).toBe('text');
    expect(stripAnsi('\x1b]8;;http://x\x1b\\link\x1b]8;;\x1b\\')).toBe('link');
  });
  it('removes stray control chars but keeps \\n and \\t', () => {
    expect(stripAnsi('a\x00b\tc\nd\x7f')).toBe('ab\tc\nd');
  });
  it('removes CSI with colon/angle param bytes (SGR-colon, modifyOtherKeys, kitty)', () => {
    expect(stripAnsi('\x1b[38:5:196mred\x1b[0m')).toBe('red');
    expect(stripAnsi('\x1b[>4;2mhi')).toBe('hi');
    expect(stripAnsi('\x1b[<u done')).toBe(' done');
  });
  it('removes 2-byte / charset escapes (ESC= keypad, ESC( B charset)', () => {
    expect(stripAnsi('\x1b=text')).toBe('text');
    expect(stripAnsi('\x1b(Bplain')).toBe('plain');
  });
  it('passes plain text through untouched', () => {
    const s = 'nothing special here\nline two';
    expect(stripAnsi(s)).toBe(s);
  });
});

describe('collapseOverwrites', () => {
  it('keeps only the final \\r overwrite of a progress line', () => {
    expect(collapseOverwrites('progress 10%\rprogress 50%\rprogress 100%\ndone')).toBe('progress 100%\ndone');
  });
  it('collapses runs of identical consecutive lines (TUI redraw noise)', () => {
    expect(collapseOverwrites('frame\nframe\nframe\nnext')).toBe('frame\nnext');
  });
  it('does not collapse blank-line runs (paragraph spacing is meaning)', () => {
    expect(collapseOverwrites('a\n\n\nb')).toBe('a\n\n\nb');
  });
  it('treats CRLF line endings as endings, not overwrites (real PTY output)', () => {
    expect(collapseOverwrites('hello world\r\nsecond line\r\n')).toBe('hello world\nsecond line\n');
    // trailing-\r normalize composes with a real mid-line overwrite
    expect(collapseOverwrites('progress 10%\rprogress 100%\r\ndone\r\n')).toBe('progress 100%\ndone\n');
  });
  it('handles cooked-mode ONLCR doubled CR (\\r\\r\\n) without deleting the line', () => {
    expect(collapseOverwrites('Hello world\r\r\nSecond\r\r\n')).toBe('Hello world\nSecond\n');
    expect(cleanTranscript('Hello world\r\r\nSecond\r\r\n')).toBe('Hello world\nSecond');
  });
});

describe('cleanTranscript', () => {
  it('strips + collapses + trims in one pass', () => {
    const raw = '\x1b]0;term\x07\x1b[32m$ npm test\x1b[0m\n\x1b[2Kspinner\rspinner done\n\n';
    expect(cleanTranscript(raw)).toBe('$ npm test\nspinner done');
  });
  it('returns empty string for pure control noise', () => {
    expect(cleanTranscript('\x1b[2J\x1b[H\x1b]0;t\x07')).toBe('');
  });
});
