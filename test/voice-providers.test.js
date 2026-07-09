import { describe, it, expect, vi } from 'vitest';
import { sttAvailable, createSTT, createTTS, pickVoice } from '../public/lib/voice-providers.js';

describe('pickDefaultModel — small local by default (≤20B class)', async () => {
  const { pickDefaultModel } = await import('../lib/inference.js');
  const GB = 1024 ** 3;
  it('picks the best chat model under the cap, never embeddings/base', () => {
    expect(pickDefaultModel([
      { name: 'qwen3.6:27b-mlx', size: 19 * GB },
      { name: 'llama3.1:8b', size: 4.9 * GB },
      { name: 'gemma4:12b-mlx', size: 10 * GB },
      { name: 'nomic-embed-text:latest', size: 0.27 * GB },
      { name: 'qwen2.5-coder:1.5b-base', size: 0.99 * GB },
    ])).toBe('gemma4:12b-mlx');   // largest chat model under ~14GB
  });
  it('nothing under the cap → the smallest chat model, never silently huge', () => {
    expect(pickDefaultModel([
      { name: 'qwen3.5:35b-mlx', size: 21 * GB },
      { name: 'qwen3.6:27b-mlx', size: 19 * GB },
    ])).toBe('qwen3.6:27b-mlx');
  });
  it('degrades to first name when metadata is missing', () => {
    expect(pickDefaultModel([{ name: 'mystery' }])).toBe('mystery');
    expect(pickDefaultModel([])).toBe(null);
  });
});

describe('pickVoice — British by default', () => {
  const voices = [
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Kate', lang: 'en-GB' },
    { name: 'Daniel', lang: 'en_GB' },
    { name: 'Amelie', lang: 'fr-FR' },
  ];
  it('explicit preference wins when present', () => {
    expect(pickVoice(voices, 'Samantha')).toBe('Samantha');
    expect(pickVoice(voices, 'Ghost')).toBe('Daniel');   // stale pref → fall through
  });
  it('Daniel beats other en-GB voices; any en-GB beats en-US', () => {
    expect(pickVoice(voices)).toBe('Daniel');
    expect(pickVoice(voices.filter((v) => v.name !== 'Daniel'))).toBe('Kate');
  });
  it('no British voice → null (engine default), never a wrong accent', () => {
    expect(pickVoice([{ name: 'Samantha', lang: 'en-US' }])).toBe(null);
    expect(pickVoice([])).toBe(null);
  });
});

// A scriptable SpeechRecognition double: the test drives onresult/onend/onerror.
function fakeSRWorld({ now = () => 1000 } = {}) {
  const instances = [];
  class SR {
    start() { this.started = true; }
    stop() { this.stopped = true; this.onend && this.onend(); }
    constructor() { instances.push(this); }
  }
  return { w: { SpeechRecognition: SR, Date: { now } }, instances };
}
const result = (transcript, isFinal) => ({ resultIndex: 0, results: [Object.assign([{ transcript }], { isFinal })] });

describe('sttAvailable / createSTT', () => {
  it('is honest about missing support', () => {
    expect(sttAvailable({})).toBe(false);
    expect(createSTT({ w: {} })).toBe(null);
  });
  it('streams interim, sends finals, clears the ghost', () => {
    const { w, instances } = fakeSRWorld();
    const onInterim = vi.fn(), onFinal = vi.fn();
    const stt = createSTT({ w, onInterim, onFinal });
    stt.start();
    instances[0].onresult(result('hel', false));
    expect(onInterim).toHaveBeenCalledWith('hel');
    instances[0].onresult(result('hello there', true));
    expect(onFinal).toHaveBeenCalledWith('hello there');
    expect(onInterim).toHaveBeenLastCalledWith('');
  });
  it('restarts between utterances while toggled on; stop() ends the loop', () => {
    const { w, instances } = fakeSRWorld({ now: (() => { let t = 0; return () => (t += 5000); })() });
    const stt = createSTT({ w });
    stt.start();
    instances[0].onend();                    // browser ended a run — not instant, so respin
    expect(instances).toHaveLength(2);
    stt.stop();
    expect(stt.active()).toBe(false);
    instances[1].onend && instances[1].onend();
    expect(instances).toHaveLength(2);       // no respin after stop
  });
  it('three instant failures stop the loop with an error state', () => {
    const { w, instances } = fakeSRWorld({ now: () => 1000 });   // frozen clock = every run instant
    const onState = vi.fn();
    const stt = createSTT({ w, onState });
    stt.start();
    instances[0].onend(); instances[1].onend(); instances[2].onend();
    expect(onState).toHaveBeenLastCalledWith('error');
    expect(stt.active()).toBe(false);
  });
  it('permission denial deactivates and reports denied', () => {
    const { w, instances } = fakeSRWorld();
    const onState = vi.fn();
    const stt = createSTT({ w, onState });
    stt.start();
    instances[0].onerror({ error: 'not-allowed' });
    expect(onState).toHaveBeenLastCalledWith('denied');
    expect(stt.active()).toBe(false);
  });
});

// A scriptable speechSynthesis double.
function fakeTTSWorld() {
  const spoken = [];
  class Utter { constructor(text) { this.text = text; spoken.push(this); } }
  const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [{ name: 'Ava' }, { name: 'Tom' }] };
  return { w: { speechSynthesis: synth, SpeechSynthesisUtterance: Utter }, spoken, synth };
}

describe('createTTS', () => {
  it('is null without speechSynthesis', () => {
    expect(createTTS({ w: {} })).toBe(null);
  });
  it('natural end reports full length, not interrupted', () => {
    const { w, spoken } = fakeTTSWorld();
    const onDone = vi.fn(), onBoundary = vi.fn();
    createTTS({ w }).speak('hello world', { onBoundary, onDone });
    spoken[0].onboundary({ charIndex: 6 });
    expect(onBoundary).toHaveBeenCalledWith(6);
    spoken[0].onend();
    expect(onDone).toHaveBeenCalledWith({ interrupted: false, spokenChars: 11 });
  });
  it('cancel() reports interrupted at the last boundary — exactly once', () => {
    const { w, spoken, synth } = fakeTTSWorld();
    const onDone = vi.fn();
    const h = createTTS({ w }).speak('hello world', { onDone });
    spoken[0].onboundary({ charIndex: 6 });
    h.cancel();
    expect(onDone).toHaveBeenCalledWith({ interrupted: true, spokenChars: 6 });
    expect(synth.cancel).toHaveBeenCalled();
    spoken[0].onend();                       // browsers may still fire end after cancel
    spoken[0].onerror();                     // …or error; neither may double-fire onDone
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(h.settled()).toBe(true);
  });
  it('picks the named voice when present', () => {
    const { w, spoken } = fakeTTSWorld();
    createTTS({ w }).speak('x', { voiceName: 'Tom' });
    expect(spoken[0].voice).toEqual({ name: 'Tom' });
  });
});
