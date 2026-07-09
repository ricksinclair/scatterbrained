# whisper-stt.py — warm on-device STT runner (VOICE Phase 9). Managed by lib/stt.js as a
# persistent child (model load happens once; reload only on model switch); JSON-lines:
#   in : {"id": "...", "wav_b64": "<RIFF/PCM16 mono 16k>", "model": "large-v3-turbo"}
#   out: {"id": "...", "ok": true, "text": "..."} | {"id": "...", "ok": false, "error": "..."}
# mlx-whisper (Apple-GPU) with models pre-snapshotted under ~/.scatterbrained/stt/<id>.
# One bad request never kills the daemon.
import sys, json, base64, io, os

MODEL_DIR = os.path.expanduser('~/.scatterbrained/stt')

def main():
    import mlx_whisper
    import soundfile as sf
    import numpy as np
    loaded = None   # model id currently resolved (mlx_whisper caches per path internally)
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get('id')
            model = str(req.get('model') or 'large-v3-turbo')
            path = os.path.join(MODEL_DIR, model)
            if not os.path.isdir(path):
                raise ValueError(f'model not installed: {model}')
            audio, sr = sf.read(io.BytesIO(base64.b64decode(req.get('wav_b64', ''))), dtype='float32')
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if sr != 16000:
                # cheap linear resample — capture is 16k by contract, this is a safety net
                idx = np.linspace(0, len(audio) - 1, int(len(audio) * 16000 / sr))
                audio = np.interp(idx, np.arange(len(audio)), audio).astype('float32')
            out = mlx_whisper.transcribe(audio, path_or_hf_repo=path)
            loaded = model
            print(json.dumps({'id': req_id, 'ok': True, 'text': (out.get('text') or '').strip()}), flush=True)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({'id': req_id, 'ok': False, 'error': str(e)[:200]}), flush=True)

if __name__ == '__main__':
    main()
