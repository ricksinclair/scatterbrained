import { describe, it, expect } from 'vitest';
import { encodeWav, createSegmenter } from '../public/lib/audio-capture.js';

describe('encodeWav', () => {
  it('writes a valid RIFF/PCM16 mono header', () => {
    const buf = encodeWav(new Float32Array([0, 0.5, -0.5]), 16000);
    const v = new DataView(buf);
    const str = (off, n) => String.fromCharCode(...new Uint8Array(buf, off, n));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1);          // PCM
    expect(v.getUint16(22, true)).toBe(1);          // mono
    expect(v.getUint32(24, true)).toBe(16000);      // sample rate
    expect(v.getUint32(40, true)).toBe(6);          // data bytes = 3 samples × 2
    expect(buf.byteLength).toBe(44 + 6);
  });
  it('encodes samples as int16 and clamps out-of-range values', () => {
    const buf = encodeWav(new Float32Array([0, 1, -1, 2, -2]), 16000);
    const v = new DataView(buf);
    expect(v.getInt16(44, true)).toBe(0);
    expect(v.getInt16(46, true)).toBe(0x7fff);
    expect(v.getInt16(48, true)).toBe(-0x8000);
    expect(v.getInt16(50, true)).toBe(0x7fff);      // clamped
    expect(v.getInt16(52, true)).toBe(-0x8000);     // clamped
  });
});

describe('createSegmenter — the hands-free VAD', () => {
  const loud = new Float32Array(160).fill(0.1);
  const quiet = new Float32Array(160).fill(0.001);
  const feedMs = (seg, frame, ms, step = 10) => {
    let cut = null;
    for (let t = 0; t < ms; t += step) { const r = seg.feed(frame, step); if (r) cut = r; }
    return cut;
  };
  it('cuts after speech followed by enough silence', () => {
    const seg = createSegmenter({ silenceMs: 800, minSpeechMs: 300 });
    expect(feedMs(seg, loud, 400)).toBe(null);      // speaking
    expect(feedMs(seg, quiet, 700)).toBe(null);     // pausing… not yet
    expect(feedMs(seg, quiet, 200)).toBe('cut');    // 800ms+ of quiet → segment
  });
  it('never cuts without minimum speech (breathing is not a turn)', () => {
    const seg = createSegmenter({ silenceMs: 800, minSpeechMs: 300 });
    expect(feedMs(seg, quiet, 5000)).toBe(null);
    expect(feedMs(seg, loud, 200)).toBe(null);      // too short
    expect(feedMs(seg, quiet, 2000)).toBe(null);
  });
  it('resets after a cut so the next sentence needs fresh speech', () => {
    const seg = createSegmenter({ silenceMs: 800, minSpeechMs: 300 });
    feedMs(seg, loud, 400); feedMs(seg, quiet, 900);   // → cut consumed inside
    expect(feedMs(seg, quiet, 2000)).toBe(null);       // silence alone can't cut again
    feedMs(seg, loud, 400);
    expect(feedMs(seg, quiet, 900)).toBe('cut');       // second sentence cuts
  });
  it('hasSpeech reflects the min-speech gate', () => {
    const seg = createSegmenter({ minSpeechMs: 300 });
    feedMs(seg, loud, 200);
    expect(seg.hasSpeech()).toBe(false);
    feedMs(seg, loud, 200);
    expect(seg.hasSpeech()).toBe(true);
  });
});
