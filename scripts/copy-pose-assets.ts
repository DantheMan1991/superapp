import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POSE_BASE,
  POSE_MODEL_NAMES,
  POSE_MODELS,
  TASKS_VISION_VERSION,
} from "../src/modules/fitness/posture/core/assets";

/**
 * Put the posture check's pose model where the site serves it
 * (docs/modules/posture.md, "The pose model"; ADR 0118).
 *
 * 1. **The library and its WebAssembly** are copied out of
 *    `node_modules/@mediapipe/tasks-vision` into `public/pose/tasks-vision-<v>/`.
 *    The worker imports `vision_bundle.mjs` from there at run time instead of
 *    letting the bundler take it in, because MediaPipe loads its own WebAssembly
 *    loader with a dynamic `import(url)` that a bundler would rewrite. Copied,
 *    not committed, so the files can never drift from the installed package:
 *    the same reason `copy-map-worker.ts` exists.
 * 2. **The three models** are downloaded from Google's model store and checked
 *    against the SHA-256 pinned in `core/assets.ts`. A file already there with
 *    the right hash is kept, so this costs a download once per checkout (and
 *    once per deploy, since a build starts from an empty `public/pose/`).
 *
 * `--strict` (prebuild) fails on a model that cannot be had: a deploy without
 * its model would ship a posture check that cannot find anybody. Without it
 * (predev) a failed download only warns, so `npm run dev` still starts
 * offline; the setup check then says the model is missing.
 */

const strict = process.argv.includes("--strict");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = join(root, "node_modules", "@mediapipe", "tasks-vision");
const publicDir = join(root, "public");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function copyLibrary(): void {
  const installed = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { version: string };
  if (installed.version !== TASKS_VISION_VERSION) {
    throw new Error(
      `@mediapipe/tasks-vision is ${installed.version} but core/assets.ts says ${TASKS_VISION_VERSION}. Change both together.`,
    );
  }
  const to = join(publicDir, POSE_BASE);
  mkdirSync(join(to, "wasm"), { recursive: true });
  copyFileSync(join(pkg, "vision_bundle.mjs"), join(to, "vision_bundle.mjs"));
  const wasm = readdirSync(join(pkg, "wasm"));
  for (const file of wasm) copyFileSync(join(pkg, "wasm", file), join(to, "wasm", file));
  // An older version's folder would be served forever under its own name.
  for (const entry of readdirSync(join(publicDir, "pose"))) {
    if (entry.startsWith("tasks-vision-") && `/pose/${entry}` !== POSE_BASE) {
      rmSync(join(publicDir, "pose", entry), { recursive: true, force: true });
    }
  }
  console.log(`Copied MediaPipe tasks-vision ${installed.version} (${wasm.length} WebAssembly files) into public${POSE_BASE}.`);
}

async function download(url: string): Promise<Uint8Array> {
  let last: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`Could not download ${url}: ${String(last)}`);
}

async function ensureModels(): Promise<void> {
  const dir = join(publicDir, "pose", "models");
  mkdirSync(dir, { recursive: true });
  const wanted = new Set(POSE_MODEL_NAMES.map((name) => POSE_MODELS[name].path.split("/").pop()!));
  for (const name of POSE_MODEL_NAMES) {
    const asset = POSE_MODELS[name];
    const target = join(publicDir, asset.path);
    if (existsSync(target) && sha256(readFileSync(target)) === asset.sha256) continue;
    try {
      const bytes = await download(asset.source);
      const got = sha256(bytes);
      if (got !== asset.sha256) {
        throw new Error(`pose model ${name} has SHA-256 ${got}, expected ${asset.sha256}. The file changed upstream.`);
      }
      writeFileSync(target, bytes);
      console.log(`Downloaded pose model ${name} (${(asset.bytes / 1e6).toFixed(1)} MB), hash checked.`);
    } catch (error) {
      if (strict) throw error;
      console.warn(`[copy-pose-assets] ${String(error)}. The posture check will say its model is missing.`);
    }
  }
  // A model from an older pin: remove it rather than serve it.
  for (const file of readdirSync(dir)) {
    if (!wanted.has(file)) rmSync(join(dir, file), { force: true });
  }
}

async function main(): Promise<void> {
  mkdirSync(join(publicDir, "pose"), { recursive: true });
  copyLibrary();
  await ensureModels();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
