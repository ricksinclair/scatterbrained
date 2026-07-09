# kokoro-tts.py — warm local-TTS runner (VOICE Phase 7). Managed by lib/tts.js as a
# persistent child (model load ~2s happens ONCE); JSON-lines protocol on stdio:
#   in : {"id": "...", "text": "...", "voice": "bm_george", "speed": 1.0}
#   out: {"id": "...", "ok": true, "b64": "<wav>", "duration": 3.2}
#      | {"id": "...", "ok": false, "error": "..."}
# Kokoro-82M (kokoro-onnx) — the "small model with a British voice" (bm_george/bm_lewis).
# Model files live in ~/.scatterbrained/tts/; the venv in ~/.scatterbrained/tts-venv.
import sys, json, base64, io, os

MODEL_DIR = os.path.expanduser('~/.scatterbrained/tts')

def main():
    from kokoro_onnx import Kokoro
    import soundfile as sf
    k = Kokoro(os.path.join(MODEL_DIR, 'kokoro-v1.0.onnx'), os.path.join(MODEL_DIR, 'voices-v1.0.bin'))
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get('id')
            text = str(req.get('text', ''))[:4000]
            voice = str(req.get('voice') or 'bm_george')
            speed = min(max(float(req.get('speed') or 1.0), 0.5), 2.0)
            samples, sr = k.create(text, voice=voice, speed=speed)
            buf = io.BytesIO()
            sf.write(buf, samples, sr, format='WAV')
            print(json.dumps({'id': req_id, 'ok': True, 'b64': base64.b64encode(buf.getvalue()).decode('ascii'),
                              'duration': round(len(samples) / sr, 2)}), flush=True)
        except Exception as e:  # noqa: BLE001 — one bad request must not kill the daemon
            print(json.dumps({'id': req_id, 'ok': False, 'error': str(e)[:200]}), flush=True)

if __name__ == '__main__':
    main()
