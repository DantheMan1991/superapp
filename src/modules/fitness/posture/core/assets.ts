/**
 * WHERE THE POSE MODEL LIVES (docs/modules/posture.md, "The pose model").
 *
 * MediaPipe's Pose Landmarker (Apache-2.0, trained on Google's own consented
 * data: the cleanest licence of every pose model looked at) runs on the phone,
 * in a worker. Nothing about it is fetched from anywhere but this site:
 *
 * - the task library and its WebAssembly are copied out of `node_modules`
 *   into `public/pose/tasks-vision-<version>/` by `scripts/copy-pose-assets.ts`
 *   (prebuild and predev, like MapLibre's worker), so they can never drift
 *   from the installed package;
 * - the three models are downloaded by the same script from Google's model
 *   store, checked against the SHA-256 pinned below, and served from
 *   `public/pose/models/` under a name that carries the hash.
 *
 * Both paths are versioned, so `next.config.ts` serves them `immutable`: a
 * phone downloads the 30 MB heavy model once, not on every check.
 *
 * `TASKS_VISION_VERSION` must equal the installed `@mediapipe/tasks-vision`
 * (tests/posture-assets.test.ts holds it to package.json).
 */

export const TASKS_VISION_VERSION = "1.0.1";

export const POSE_BASE = `/pose/tasks-vision-${TASKS_VISION_VERSION}`;
/** The library as an ES module, imported by the worker at run time (never bundled). */
export const POSE_BUNDLE_URL = `${POSE_BASE}/vision_bundle.mjs`;
/** The folder `FilesetResolver.forVisionTasks` loads its WebAssembly from. */
export const POSE_WASM_BASE = `${POSE_BASE}/wasm`;

export const POSE_MODEL_NAMES = ["lite", "full", "heavy"] as const;
export type PoseModelName = (typeof POSE_MODEL_NAMES)[number];

export type PoseModelAsset = {
  name: PoseModelName;
  /** Google's model store, float16, version 1 (the only version since April 2023). */
  source: string;
  sha256: string;
  bytes: number;
  /** Where this site serves it. */
  path: string;
};

function model(name: PoseModelName, sha256: string, bytes: number): PoseModelAsset {
  return {
    name,
    source: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${name}/float16/1/pose_landmarker_${name}.task`,
    sha256,
    bytes,
    path: `/pose/models/pose_landmarker_${name}-${sha256.slice(0, 12)}.task`,
  };
}

/** Pinned 2026-09-30 from the files themselves; a changed file fails the build. */
export const POSE_MODELS: Record<PoseModelName, PoseModelAsset> = {
  lite: model("lite", "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a", 5_777_746),
  full: model("full", "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1", 9_398_198),
  heavy: model("heavy", "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b", 30_664_242),
};

/** The model a check measures with: the most accurate one (PCK@0.2 94.2 against 91.8 and 87.0). */
export const MEASURING_MODEL: PoseModelName = "heavy";
