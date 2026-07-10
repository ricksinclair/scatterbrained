// voice-providers.js — the pluggable speech seam (VOICE Phase 2). Web Speech API is the
// zero-cost default; everything voice-ui touches goes through createSTT/createTTS so a
// local Whisper/TTS provider (or a Playwright fake via window.__voiceProviders) can swap
// in without touching the panel. Constructors are injected (w) so vitest can drive the
// event sequences without a browser.
//
// Privacy note (surfaced in Settings): Chrome's SpeechRecognition ships audio to Google's
// servers. speechSynthesis is local. The seam is the containment for both.

export function sttAvailable(w = globalThis) {
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

// Voice preference (you, 2026-07-04): British by default. Explicit user pick wins;
// else the classic British male (Daniel on macOS), else any en-GB, else engine default.
export function pickVoice(voices = [], preferred = null) {
  if (preferred) {
    const v = voices.find((x) => x && x.name === preferred);
    if (v) return v.name;
  }
  const gb = voices.filter((v) => v && /en[-_]GB/i.test(v.lang || ''));
  const daniel = gb.find((v) => /daniel/i.test(v.name || ''));
  const pick = daniel || gb[0];
  return pick ? pick.name : null;
}

// createSTT: click-to-toggle listening. One utterance per recognition run (continuous:false)
// with interim results streaming to the ghost bubble; a final result auto-sends and the
// recognition RESTARTS while toggled on — Chrome ends runs unpredictably (its continuous
// mode self-stops), so "keep listening" is our loop, not the browser's. Three instant
// failures in a row stop the loop (mic dead / permission revoked) instead of spinning.
export function createSTT({
  w = globalThis, lang = 'en-US',
  onInterim = () => {}, onFinal = () => {}, onState = () => {},
} = {}) {
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  let active = false, rec = null, failStreak = 0, lastStart = 0;

  function spin() {
    rec = new SR();
    rec.lang = lang; rec.continuous = false; rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        (r.isFinal ? (final += r[0].transcript) : (interim += r[0].transcript));
      }
      if (final.trim()) { failStreak = 0; onFinal(final.trim()); onInterim(''); }
      else if (interim) onInterim(interim);
    };
    rec.onerror = (e) => {
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        active = false; onState('denied');
      }
      // 'no-speech'/'aborted'/'network' fall through to onend, which decides on restart
    };
    rec.onend = () => {
      if (!active) { onState('idle'); return; }
      // an instant end (<1s) is a failure, not a pause between utterances
      failStreak = (w.Date || Date).now() - lastStart < 1000 ? failStreak + 1 : 0;
      if (failStreak >= 3) { active = false; onState('error'); return; }
      start0();
    };
    lastStart = (w.Date || Date).now();
    try { rec.start(); } catch { /* already started — Chrome race, next onend restarts */ }
  }
  const start0 = () => spin();

  return {
    start() { if (active) return; active = true; failStreak = 0; onState('listening'); start0(); },
    stop() { active = false; onInterim(''); try { rec && rec.stop(); } catch { /* not running */ } },
    active: () => active,
  };
}

// createRecorderSTT: the ON-DEVICE recognition lane (VOICE Phase 9) with the SAME seam
// interface as createSTT — voice-ui cannot tell engines apart. Record-then-transcribe:
// no live interim words (accepted tradeoff — the ghost shows 'listening…'); a segment
// ends on stop() (PTT release) or a VAD silence cut (hands-free), goes to
// POST /api/voice/stt, and the text arrives via onFinal. Empty transcription = the
// quiet no-speech analogue. `makeRecorder` is injectable for tests.
export function createRecorderSTT({
  model = null, base = '', fetchImpl = fetch, makeRecorder = null,
  onInterim = () => {}, onFinal = () => {}, onState = () => {},
} = {}) {
  let active = false, rec = null, inflight = 0;
  const post = async (wavBuf) => {
    inflight++;
    onState('transcribing');
    try {
      const q = model ? '?model=' + encodeURIComponent(typeof model === 'function' ? model() : model) : '';
      const r = await fetchImpl(base + '/api/voice/stt' + q, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wavBuf,
      });
      const j = await r.json();
      if (j.text && j.text.trim()) onFinal(j.text.trim());
    } catch { /* a dropped segment must not kill the session */ }
    inflight--;
    if (!active && !inflight) onState('idle');
    else if (active) onState('listening');
  };
  return {
    async start({ vad = true } = {}) {
      if (active) return;
      active = true;
      try {
        const make = makeRecorder || (async (opts) => {
          const { createRecorder } = await import('./audio-capture.js');
          return createRecorder(opts);
        });
        rec = await make({ vad, onSegment: post });
        if (!active) return;                     // a fast tap stopped us mid-setup
        await rec.start();
        if (!active) { rec.stop(); return; }     // …or mid-getUserMedia — release the mic
        onState('listening'); onInterim('listening…');
      } catch {
        active = false; onState('denied');       // mic permission refused / no device
      }
    },
    stop() {
      if (!active) return;
      active = false;
      onInterim('');
      try { rec && rec.stop(); } catch { /* torn down */ }
      if (!inflight) onState('idle');
    },
    active: () => active,
  };
}

// createServerTTS: the local-model lane (Kokoro via POST /api/voice/tts) with the SAME
// interface as createTTS, so voice-ui cannot tell them apart. Word boundaries don't come
// from the model, so charIndex is ESTIMATED from playback progress (100ms ticks) — good
// enough for karaoke subtitles and honest for spoken_chars ("roughly this much was
// heard"). cancel() during the synth fetch aborts it; during playback it pauses.
export function createServerTTS({ base = '', voice = null, fetchImpl = fetch, AudioImpl = null } = {}) {
  const Audio_ = AudioImpl || globalThis.Audio;
  if (!Audio_) return null;
  return {
    speak(text, { voiceName = null, rate = 1, onBoundary = () => {}, onDone = () => {} } = {}) {
      const t = String(text || '');
      let at = 0, settled = false, audio = null, tick = null;
      const ctrl = new AbortController();
      const done = (interrupted) => {
        if (settled) return; settled = true;
        if (tick) clearInterval(tick);
        if (audio) { try { audio.pause(); } catch { /* already stopped */ } }
        onDone({ interrupted, spokenChars: interrupted ? at : t.length });
      };
      (async () => {
        try {
          const r = await fetchImpl(base + '/api/voice/tts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: t, voice: voiceName || voice || undefined, speed: rate !== 1 ? rate : undefined }),
            signal: ctrl.signal,
          });
          if (!r.ok) { done(true); return; }
          const blob = await r.blob();
          if (settled) return;
          audio = new Audio_(URL.createObjectURL(blob));
          audio.onended = () => done(false);
          audio.onerror = () => done(true);
          await audio.play();
          tick = setInterval(() => {
            if (!audio || !audio.duration || settled) return;
            at = Math.min(t.length, Math.round(t.length * (audio.currentTime / audio.duration)));
            onBoundary(at);
          }, 100);
        } catch { done(true); }
      })();
      return {
        cancel() { if (!settled) { try { ctrl.abort(); } catch { /* pre-fetch */ } done(true); } },
        progress: () => at,
        settled: () => settled,
      };
    },
    voices: () => [],   // server voices come from /api/voice/tts/ping, not the engine
  };
}

// createTTS: one utterance at a time, boundary-tracked. cancel() vs natural end is
// normalized into a single onDone({interrupted, spokenChars}) — fired exactly once —
// because browsers disagree on whether cancel() emits end, error, both, or neither.
// spokenChars is the LAST boundary charIndex: the same number the thread's highlight
// freeze and (Phase 3) the MCP voice_say result report.
export function createTTS({ w = globalThis } = {}) {
  const synth = w.speechSynthesis;
  const Utter = w.SpeechSynthesisUtterance;
  if (!synth || !Utter) return null;
  return {
    speak(text, { voiceName = null, rate = 1, onBoundary = () => {}, onDone = () => {} } = {}) {
      const t = String(text || '');
      const u = new Utter(t);
      if (voiceName) {
        const v = (synth.getVoices() || []).find((x) => x.name === voiceName);
        if (v) u.voice = v;
      }
      u.rate = rate;
      let at = 0, settled = false;
      const done = (interrupted) => {
        if (settled) return; settled = true;
        onDone({ interrupted, spokenChars: interrupted ? at : t.length });
      };
      u.onboundary = (e) => { if (typeof e.charIndex === 'number') { at = e.charIndex; onBoundary(at); } };
      u.onend = () => done(false);
      u.onerror = () => done(true);
      synth.speak(u);
      return {
        cancel() { if (!settled) { done(true); try { synth.cancel(); } catch { /* already stopped */ } } },
        progress: () => at,
        settled: () => settled,
      };
    },
    voices: () => synth.getVoices() || [],
  };
}
