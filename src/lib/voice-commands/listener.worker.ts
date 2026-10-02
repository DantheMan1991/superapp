/// <reference lib="webworker" />
import { loadData } from "@sherpaw/preloader";
import type { KWSModule, KeywordSpotter } from "@sherpaw/kws/core";
import { LISTENER_ENGINE_URL, LISTENER_MODEL, MODEL_FILES, MODEL_PATHS } from "./assets";
import type { Keyword } from "./phrases";
import type { AudioBlock, FromListener, ListenerStage, ToListener } from "./protocol";

/**
 * THE LISTENER'S WORKER (docs/modules/voice-commands.md; ADR 0124).
 *
 * The keyword spotter runs HERE, off the page's thread: the microphone's
 * blocks arrive from the worklet on a port of their own, are decoded, and are
 * dropped. Only the label of a phrase heard goes back to the page, never a
 * sample: the spotter keeps a few seconds of sound in its own memory to
 * decode, and nothing writes any of it anywhere.
 *
 * Decoding takes about 46 ms per second of sound on a laptop (the D1c spike),
 * a phone a few times that: a worker keeps it from ever slowing a tap.
 *
 * The engine is imported at run time from this site's own copy
 * (scripts/copy-listener-assets.ts), not bundled: it finds its WebAssembly
 * from its own `import.meta.url`, which a bundler would rewrite.
 */

declare const self: DedicatedWorkerGlobalScope;

type Engine = typeof import("@sherpaw/kws/core");

/** A block that waited longer than this is stale: a phone too slow to keep up skips, rather than lags. */
const STALE_MS = 2_000;

let spotter: KeywordSpotter | null = null;
/** Keywords asked for while the engine was still loading. */
let wanted: Keyword[] | null = null;
let held = false;
/** Start a fresh stream before the next block: after a hold, or a skip. */
let afresh = false;
let reported = false;
let port: MessagePort | null = null;

function send(message: FromListener): void {
  self.postMessage(message);
}

function fail(stage: ListenerStage, error: unknown): void {
  send({ type: "error", stage, message: error instanceof Error ? error.message : String(error) });
}

/** A path on this site as a full address, for an import or a fetch from inside the worker. */
function onThisSite(path: string): string {
  return new URL(path, self.location.origin).href;
}

async function loadEngine(): Promise<{ engine: Engine; module: KWSModule }> {
  const engine = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ onThisSite(LISTENER_ENGINE_URL))) as Engine;
  return { engine, module: await engine.initKWSModule() };
}

/** The model, with its progress told as it comes: most of the first download. */
async function loadModel(): Promise<Uint8Array> {
  const response = await fetch(onThisSite(LISTENER_MODEL.path));
  if (!response.ok || !response.body) throw new Error(`The model answered ${response.status}.`);
  const total = LISTENER_MODEL.bytes;
  const bytes = new Uint8Array(total);
  const reader = response.body.getReader();
  let loaded = 0;
  let told = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.byteLength > total) throw new Error("The model is larger than the one pinned.");
    bytes.set(value, loaded);
    loaded += value.byteLength;
    if (loaded - told >= 256 * 1024) {
      told = loaded;
      send({ type: "progress", loaded, total });
    }
  }
  if (loaded !== total) throw new Error(`The model stopped at ${loaded} of ${total} bytes.`);
  send({ type: "progress", loaded, total });
  return bytes;
}

async function start(keywords: Keyword[]): Promise<void> {
  const [engine, model] = await Promise.allSettled([loadEngine(), loadModel()]);
  if (engine.status === "rejected") return fail("engine", engine.reason);
  if (model.status === "rejected") return fail("model", model.reason);
  const { engine: kws, module } = engine.value;
  try {
    loadData({
      module,
      data: model.value,
      metadata: { files: MODEL_FILES.map((file) => ({ ...file })), remote_package_size: LISTENER_MODEL.bytes },
    });
    spotter = kws.createKeywordSpotter(module, { model: MODEL_PATHS, keywords: wanted ?? keywords });
    wanted = null;
  } catch (error) {
    return fail("spotter", error);
  }
  send({ type: "ready" });
}

/** The microphone's blocks come from this port from now on: a new worklet closes the old one's. */
function listenOn(next: MessagePort): void {
  port?.close();
  port = next;
  port.onmessage = (event: MessageEvent<AudioBlock>) => hear(event.data);
}

function hear(block: AudioBlock): void {
  if (!spotter || held) return;
  if (Date.now() - block.sent > STALE_MS) {
    afresh = true;
    return;
  }
  try {
    if (afresh) {
      spotter.reset();
      afresh = false;
    }
    for (const hit of spotter.processAudio(block.samples, block.rate)) send({ type: "heard", label: hit.label });
  } catch (error) {
    // One bad block is not the end of listening; the page is told once.
    if (!reported) {
      reported = true;
      fail("audio", error);
    }
  }
}

self.onmessage = (event: MessageEvent<ToListener>) => {
  const message = event.data;
  if (message.type === "start") {
    void start(message.keywords);
  } else if (message.type === "audio") {
    listenOn(message.port);
  } else if (message.type === "keywords") {
    if (!spotter) wanted = message.keywords;
    else spotter.setKeywords(message.keywords).catch((error: unknown) => fail("spotter", error));
  } else if (message.type === "hold") {
    held = message.on;
    if (!message.on) afresh = true;
  }
};
