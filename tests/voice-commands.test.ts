import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KWS_VERSION, LISTENER_BASE, LISTENER_ENGINE_URL, LISTENER_MODEL, MODEL_FILES } from "../src/lib/voice-commands/assets";
import { CAPTURE_PROCESSOR, CAPTURE_WORKLET_SOURCE } from "../src/lib/voice-commands/capture-worklet";
import { keywordsFor, MODEL_PHONES, PHRASES, type PhraseKey } from "../src/lib/voice-commands/phrases";

/**
 * HANDS-FREE'S LISTENER (docs/modules/voice-commands.md; ADR 0124): the files
 * it is served from, the sounds it listens for, and the proxy keeping out of
 * its way. The listener itself runs in a browser and was driven there; these
 * hold the parts a change could quietly break.
 */

describe("the listener's files", () => {
  it("serves the engine that is installed", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@sherpaw/kws"]).toBe(KWS_VERSION);
    expect(LISTENER_ENGINE_URL).toBe(`${LISTENER_BASE}/core.js`);
    expect(LISTENER_BASE).toBe(`/voice-commands/sherpaw-kws-${KWS_VERSION}`);
  });

  it("downloads the model from one pinned commit, and names it by its hash", () => {
    expect(LISTENER_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(LISTENER_MODEL.path).toContain(LISTENER_MODEL.sha256.slice(0, 12));
    expect(LISTENER_MODEL.path.startsWith("/voice-commands/models/")).toBe(true);
    expect(LISTENER_MODEL.source).toMatch(/^https:\/\/huggingface\.co\/moeru-ai\/[\w.-]+\/resolve\/[0-9a-f]{40}\//);
    expect(LISTENER_MODEL.metadataSource.split("/resolve/")[1].slice(0, 40)).toBe(
      LISTENER_MODEL.source.split("/resolve/")[1].slice(0, 40),
    );
  });

  it("lays the model's four files end to end, as the pack does", () => {
    let at = 0;
    for (const file of MODEL_FILES) {
      expect(file.start).toBe(at);
      expect(file.end).toBeGreaterThan(file.start);
      at = file.end;
    }
    expect(at).toBe(LISTENER_MODEL.bytes);
    expect(MODEL_FILES.map((f) => f.filename).sort()).toEqual(["/decoder.onnx", "/encoder.onnx", "/joiner.onnx", "/tokens.txt"]);
  });

  it("is a folder the proxy never runs on, while pages still pass through it", () => {
    const source = readFileSync("src/proxy.ts", "utf8");
    // The page matcher: the one line in the file that is a string starting "/((?!".
    const literal = /^\s*("\/\(\(\?!.*"),\s*$/m.exec(source)?.[1];
    expect(literal).toBeDefined();
    const pages = new RegExp(`^${JSON.parse(literal!) as string}$`);
    expect(pages.test(LISTENER_MODEL.path)).toBe(false);
    expect(pages.test(`${LISTENER_BASE}/prebuilt/kws.wasm`)).toBe(false);
    expect(pages.test(LISTENER_ENGINE_URL)).toBe(false);
    expect(pages.test("/personal/m/food/recipes/11111111-1111-4111-8111-111111111111/cook")).toBe(true);
    expect(pages.test("/personal/m/food/notes.database")).toBe(true);
  });
});

describe("what the listener can hear", () => {
  const all = Object.entries(PHRASES) as [PhraseKey, readonly string[]][];

  it("writes every phrase in the model's own sounds", () => {
    expect(MODEL_PHONES.size).toBe(69);
    for (const [, sounds] of all) {
      expect(sounds.length).toBeGreaterThan(0);
      for (const pronunciation of sounds) {
        for (const token of pronunciation.split(" ")) expect(MODEL_PHONES.has(token), `${token} in ${pronunciation}`).toBe(true);
      }
    }
  });

  it("never gives two phrases, or one phrase twice, the same sounds", () => {
    const sounds = all.flatMap(([, list]) => [...list]);
    expect(new Set(sounds).size).toBe(sounds.length);
  });

  it("builds a command from all its phrases' pronunciations, labelled as the command", () => {
    const keywords = keywordsFor({ back: ["go back", "previous step"], next: ["next step"] } as const, ["next", "back"]);
    expect(keywords.map((k) => k.label)).toEqual(["next", "back"]);
    expect(keywords[1].matches).toHaveLength(PHRASES["go back"].length + PHRASES["previous step"].length);
    expect(keywords[0].matches[0].tokens).toEqual(PHRASES["next step"][0].split(" "));
  });
});

describe("the microphone's worklet", () => {
  it("registers the processor the listener asks for, and holds samples to what the engine takes", () => {
    expect(CAPTURE_WORKLET_SOURCE).toContain(`registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR)}`);
    expect(CAPTURE_WORKLET_SOURCE).toContain("v > 1 ? 1 : v < -1 ? -1 : v || 0");
  });

  it("is a script a worklet can run: it parses", () => {
    // The worklet's globals, so the class body can be evaluated here.
    const registered: string[] = [];
    const run = new Function(
      "AudioWorkletProcessor",
      "registerProcessor",
      "sampleRate",
      CAPTURE_WORKLET_SOURCE,
    ) as (base: unknown, register: (name: string) => void, rate: number) => void;
    run(class {}, (name) => registered.push(name), 16_000);
    expect(registered).toEqual([CAPTURE_PROCESSOR]);
  });
});
