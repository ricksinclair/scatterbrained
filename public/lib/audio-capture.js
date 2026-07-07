// audio-capture.js — mic capture for the on-device STT lane (VOICE Phase 9).
// Pure pieces first (vitest-able): a RIFF/PCM16 WAV encoder and the RMS silence
// segmenter that powers hands-free mode. The DOM recorder at the bottom wires
// getUserMedia + a 16k AudioContext + ScriptProcessorNode (deprecated-but-universal;
// an AudioWorklet needs its own module file — deliberate v1 tradeoff).

// encodeWav(Float32Array, sampleRate) → ArrayBuffer — mono PCM16, samples clamped.
export function encodeWav(samples, sampleRate = 16000) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

// The hands-free VAD: a pure frame-feed state machine. feed(frame, tMs) → 'cut' when
// ≥minSpeechMs of speech has been followed by ≥silenceMs of quiet — the caller then
// flushes the segment. No speech yet → never cuts (breathing at the mic isn't a turn).
export function createSegmenter({ silenceMs = 800, minSpeechMs = 300, rms = 0.012 } = {}) {
  let speechMs = 0, silenceRun = 0;
  return {
    feed(frame, frameMs) {
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      const level = Math.sqrt(sum / (frame.length || 1));
      if (level >= rms) { speechMs += frameMs; silenceRun = 0; return null; }
      silenceRun += frameMs;
      if (speechMs >= minSpeechMs && silenceRun >= silenceMs) { speechMs = 0; silenceRun = 0; return 'cut'; }
      return null;
    },
    hasSpeech: () => speechMs >= minSpeechMs,
    reset() { speechMs = 0; silenceRun = 0; },
  };
}

// createRecorder({ vad, onSegment, w }) — start() begins capture; each segment (VAD cut
// in hands-free, or stop() for PTT) calls onSegment(wavArrayBuffer). stop() also ends
// the stream and releases the mic.
export function createRecorder({ vad = false, onSegment = () => {}, w = globalThis } = {}) {
  let ctx = null, stream = null, node = null, src = null;
  let chunks = [], seg = null, running = false;

  const flush = () => {
    if (!chunks.length) return;
    const total = chunks.reduce((s, c) => s + c.length, 0);
    if (total < 1600) { chunks = []; return; }               // <0.1s — nothing worth sending
    const all = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; }
    chunks = [];
    onSegment(encodeWav(all, ctx ? ctx.sampleRate : 16000));
  };

  return {
    async start() {
      if (running) return;
      running = true;
      stream = await w.navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new (w.AudioContext || w.webkitAudioContext)({ sampleRate: 16000 });
      src = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(4096, 1, 1);
      seg = vad ? createSegmenter() : null;
      node.onaudioprocess = (e) => {
        if (!running) return;
        const frame = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(frame));
        if (seg && seg.feed(frame, (frame.length / ctx.sampleRate) * 1000) === 'cut') flush();
      };
      src.connect(node);
      // Chrome requires the processor to reach a sink or it never fires — but a direct
      // connection would monitor the mic through the speakers. A zero-gain stage is the sink.
      const mute = ctx.createGain(); mute.gain.value = 0;
      node.connect(mute); mute.connect(ctx.destination);
    },
    stop() {
      if (!running) return;
      running = false;
      // PTT: everything since start is the utterance; hands-free: whatever the last cut left
      if (!seg || seg.hasSpeech()) flush(); else chunks = [];
      try { node && node.disconnect(); src && src.disconnect(); } catch { /* torn down */ }
      try { stream && stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
      try { ctx && ctx.close(); } catch { /* closed */ }
      ctx = null; stream = null; node = null; src = null;
    },
    running: () => running,
  };
}
