// Local text embedder — bge-small-en-v1.5 via Transformers.js (@xenova/transformers).
//
// 384-dim, normalized, mean-pooled. Runs fully on-device: no API, no key, no
// Python, no server. It is an OPTIONAL dependency — the toolkit's keyword lane
// works without it; only the semantic/vector lane needs it. Everything here
// degrades gracefully when the package isn't installed.
//
// bge models use an instruction prefix on the QUERY side for asymmetric
// retrieval; passages (documents) are embedded as-is.

export const EMBED_DIM = 384;
const MODEL = 'Xenova/bge-small-en-v1.5';
const QUERY_INSTRUCTION = 'Represent this sentence for searching relevant passages: ';

let _extractorPromise = null;

// True iff the optional dependency is importable — cheap, does NOT load weights.
export async function embedderAvailable() {
  try {
    await import('@xenova/transformers');
    return true;
  } catch {
    return false;
  }
}

async function getExtractor() {
  if (!_extractorPromise) {
    _extractorPromise = (async () => {
      let mod;
      try {
        mod = await import('@xenova/transformers');
      } catch (e) {
        throw new Error(
          'semantic lane needs the optional embedder. Install it:\n  npm install @xenova/transformers'
        );
      }
      mod.env.allowRemoteModels = true; // fetch the model once, then it is cached locally
      return mod.pipeline('feature-extraction', MODEL);
    })();
  }
  return _extractorPromise;
}

// Embed an array of strings -> array of number[] (length EMBED_DIM each).
// Pass { query: true } to embed search queries (adds the bge instruction prefix).
export async function embedTexts(texts, { query = false, batchSize = 32 } = {}) {
  const extractor = await getExtractor();
  const prepared = texts.map((t) => (query ? QUERY_INSTRUCTION + t : t));
  const out = [];
  for (let i = 0; i < prepared.length; i += batchSize) {
    const batch = prepared.slice(i, i + batchSize);
    const res = await extractor(batch, { pooling: 'mean', normalize: true });
    // res.dims = [batch, 384]; res.data is a flat Float32Array
    const dim = res.dims[res.dims.length - 1];
    for (let r = 0; r < batch.length; r++) {
      out.push(Array.from(res.data.slice(r * dim, (r + 1) * dim)));
    }
  }
  return out;
}

export async function embedOne(text, opts = {}) {
  const [v] = await embedTexts([text], opts);
  return v;
}
