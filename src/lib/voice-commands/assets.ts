/**
 * WHERE THE LISTENER LIVES (docs/modules/voice-commands.md, "The listener's
 * files"; ADR 0124).
 *
 * Hands-free listens with an open-source keyword spotter that runs on the
 * phone: Sherpa-ONNX's, compiled to WebAssembly by Sherpaw (`@sherpaw/kws`,
 * Apache-2.0), with a small Chinese and English model (Apache-2.0). Nothing
 * about it is fetched from anywhere but this site:
 *
 * - the engine (its JavaScript and its WebAssembly) is copied out of
 *   `node_modules/@sherpaw/kws` into `public/voice-commands/sherpaw-kws-<v>/`
 *   by `scripts/copy-listener-assets.ts` (prebuild and predev), so it can never
 *   drift from the installed package;
 * - the model is downloaded by the same script from the Hugging Face commit
 *   pinned below, checked against its SHA-256, and served from
 *   `public/voice-commands/models/` under a name that carries the hash.
 *
 * Both paths are versioned, so `next.config.ts` serves them `immutable`: a
 * phone downloads the listener once. The engine is 12.5 MB as a file and
 * about 2 MB on the wire (the site sends WebAssembly compressed); the model
 * does not compress. About 15 MB in all, the figure the founder was shown.
 *
 * `KWS_VERSION` must equal the installed `@sherpaw/kws`
 * (tests/voice-commands.test.ts holds it to package.json).
 */

export const KWS_VERSION = "0.2.1";

export const LISTENER_BASE = `/voice-commands/sherpaw-kws-${KWS_VERSION}`;
/**
 * The engine as an ES module, imported by the listener's worker at run time,
 * never bundled: it finds its WebAssembly next to itself
 * (`./prebuilt/kws.wasm`, from `import.meta.url`), which a bundler would
 * rewrite.
 */
export const LISTENER_ENGINE_URL = `${LISTENER_BASE}/core.js`;

/** The model's four files, as the preload pack lays them out (its `preload.js.metadata`). */
export const MODEL_FILES = [
  { filename: "/decoder.onnx", start: 0, end: 759_829 },
  { filename: "/encoder.onnx", start: 759_829, end: 12_736_101 },
  { filename: "/joiner.onnx", start: 12_736_101, end: 13_074_255 },
  { filename: "/tokens.txt", start: 13_074_255, end: 13_076_183 },
] as const;

/** Where each file lands in the engine's own file system. */
export const MODEL_PATHS = {
  encoder: "/encoder.onnx",
  decoder: "/decoder.onnx",
  joiner: "/joiner.onnx",
  tokens: "/tokens.txt",
} as const;

const MODEL_REPO = "https://huggingface.co/moeru-ai/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20";
/** The commit pinned 2026-10-02; the README asks for a pinned commit. */
const MODEL_COMMIT = "1770a4b22db32184c110ac43c601db17cc9c93f8";

const MODEL_SHA256 = "4ca3ae0d147df1576fac87a4837f5a8959f4f87600a8306c57cc67eb8b40494d";

export const LISTENER_MODEL = {
  /**
   * The upstream sherpa-onnx release's fp32 chunk-16 model (by pkufool,
   * Apache-2.0), unmodified, packed for the engine by Sherpaw.
   */
  source: `${MODEL_REPO}/resolve/${MODEL_COMMIT}/install/bin/wasm/preload.data`,
  /** Its metadata at the same commit, which `MODEL_FILES` copies. */
  metadataSource: `${MODEL_REPO}/resolve/${MODEL_COMMIT}/install/bin/wasm/preload.js.metadata`,
  metadataSha256: "e7e223298765f02cdc868d8d1af52fd2c0da6aeef2a5af4122489fd7a8ed1e7b",
  sha256: MODEL_SHA256,
  bytes: 13_076_183,
  /** Where this site serves it. */
  path: `/voice-commands/models/kws-zipformer-zh-en-3M-${MODEL_SHA256.slice(0, 12)}.data`,
} as const;

/** What the person is told the first download costs. */
export const LISTENER_DOWNLOAD_WORDS = "about 15 MB";
