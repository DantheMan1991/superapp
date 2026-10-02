import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KWS_VERSION, LISTENER_BASE, LISTENER_MODEL, MODEL_FILES } from "../src/lib/voice-commands/assets";
import { MODEL_PHONES, PHRASES } from "../src/lib/voice-commands/phrases";

/**
 * Put hands-free's listener where the site serves it
 * (docs/modules/voice-commands.md, "The listener's files"; ADR 0124).
 *
 * 1. **The engine** (`core.js`, the chunk it imports, and its WebAssembly) is
 *    copied out of `node_modules/@sherpaw/kws/dist` into
 *    `public/voice-commands/sherpaw-kws-<v>/`, keeping the layout, because the
 *    engine finds `prebuilt/kws.wasm` next to itself. The listener's worker
 *    imports it from there at run time instead of letting the bundler take it
 *    in. Copied, not committed, so it can never drift from the installed
 *    package: the posture model's reason (`copy-pose-assets.ts`).
 * 2. **The model** is downloaded from the Hugging Face commit pinned in
 *    `assets.ts` and checked against its SHA-256. A file already there with
 *    the right hash is kept, so this costs a download once per checkout, and
 *    once per deploy.
 * 3. **Every phrase's sounds are in the model's own token list**, read out of
 *    the file just checked: a phrase the model cannot hear fails here, before
 *    a deploy, not on a phone in a kitchen.
 *
 * `--strict` (prebuild) fails on a model that cannot be had: a deploy without
 * it would ship a hands-free that cannot hear. Without it (predev) a failed
 * download only warns, so `npm run dev` still starts offline.
 */

const strict = process.argv.includes("--strict");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "node_modules", "@sherpaw", "kws", "dist");
const publicDir = join(root, "public");
const folder = join(publicDir, "voice-commands");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function copyEngine(): void {
  const pkg = JSON.parse(readFileSync(join(dist, "..", "package.json"), "utf8")) as { version: string };
  if (pkg.version !== KWS_VERSION) {
    throw new Error(`@sherpaw/kws is ${pkg.version} but src/lib/voice-commands/assets.ts says ${KWS_VERSION}. Change both together.`);
  }
  const core = readFileSync(join(dist, "core.js"), "utf8");
  // core.js re-exports the engine from a chunk whose name carries a build hash.
  const chunks = [...core.matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)].map((m) => m[1]);
  if (chunks.length !== 1) throw new Error(`@sherpaw/kws core.js imports ${chunks.length} chunks; expected 1.`);
  const chunk = readFileSync(join(dist, chunks[0]), "utf8");
  if (/^\s*import\s/m.test(chunk)) throw new Error(`@sherpaw/kws ${chunks[0]} imports something; the copy would not carry it.`);
  const to = join(publicDir, LISTENER_BASE);
  mkdirSync(join(to, "prebuilt"), { recursive: true });
  copyFileSync(join(dist, "core.js"), join(to, "core.js"));
  copyFileSync(join(dist, chunks[0]), join(to, chunks[0]));
  copyFileSync(join(dist, "prebuilt", "kws.wasm"), join(to, "prebuilt", "kws.wasm"));
  // An older version's folder would be served forever under its own name.
  for (const entry of readdirSync(folder)) {
    if (entry.startsWith("sherpaw-kws-") && `/voice-commands/${entry}` !== LISTENER_BASE) {
      rmSync(join(folder, entry), { recursive: true, force: true });
    }
  }
  console.log(`Copied @sherpaw/kws ${pkg.version} (core.js, ${chunks[0]}, prebuilt/kws.wasm) into public${LISTENER_BASE}.`);
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

/** The model's token list, out of the pack, as `MODEL_FILES` says where it sits. */
function tokensOf(model: Uint8Array): Set<string> {
  const file = MODEL_FILES.find((f) => f.filename === "/tokens.txt");
  if (!file) throw new Error("MODEL_FILES has no /tokens.txt.");
  const text = new TextDecoder().decode(model.subarray(file.start, file.end));
  const tokens = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^(\S+)\s+\d+$/.exec(line.trim());
    if (!m) throw new Error("The model's tokens.txt does not read as tokens: MODEL_FILES is out of step with the pack.");
    tokens.add(m[1]);
  }
  return tokens;
}

function checkPhrases(model: Uint8Array): void {
  const last = MODEL_FILES[MODEL_FILES.length - 1];
  if (last.end !== LISTENER_MODEL.bytes) throw new Error("MODEL_FILES does not end where the pack does.");
  const tokens = tokensOf(model);
  for (const phone of MODEL_PHONES) {
    if (!tokens.has(phone)) throw new Error(`The model has no token ${phone}, which MODEL_PHONES lists.`);
  }
  for (const [phrase, sounds] of Object.entries(PHRASES)) {
    for (const pronunciation of sounds) {
      for (const token of pronunciation.split(" ")) {
        if (!tokens.has(token)) throw new Error(`"${phrase}" uses ${token}, which the model does not know.`);
      }
    }
  }
}

async function ensureModel(): Promise<void> {
  const dir = join(folder, "models");
  mkdirSync(dir, { recursive: true });
  const target = join(publicDir, LISTENER_MODEL.path);
  let model: Uint8Array | null = existsSync(target) ? new Uint8Array(readFileSync(target)) : null;
  if (!model || sha256(model) !== LISTENER_MODEL.sha256) {
    try {
      model = await download(LISTENER_MODEL.source);
      const got = sha256(model);
      if (got !== LISTENER_MODEL.sha256) {
        throw new Error(`The listener's model has SHA-256 ${got}, expected ${LISTENER_MODEL.sha256}. The file changed upstream.`);
      }
      writeFileSync(target, model);
      console.log(`Downloaded the listener's model (${(LISTENER_MODEL.bytes / 1e6).toFixed(1)} MB), hash checked.`);
    } catch (error) {
      if (strict) throw error;
      console.warn(`[copy-listener-assets] ${String(error)}. Hands-free will say its listener could not be downloaded.`);
      return;
    }
  }
  checkPhrases(model);
  // A model from an older pin: removed rather than served.
  const wanted = LISTENER_MODEL.path.split("/").pop();
  for (const file of readdirSync(dir)) {
    if (file !== wanted) rmSync(join(dir, file), { force: true });
  }
}

async function main(): Promise<void> {
  mkdirSync(folder, { recursive: true });
  copyEngine();
  await ensureModel();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
