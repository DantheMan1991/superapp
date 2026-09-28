import { describe, expect, it } from "vitest";
import {
  forSpeech,
  pickVoice,
  SPEAK_EACH_UP_TO,
  spokenConfirmation,
  type VoiceOption,
} from "../src/lib/speech/say";

/**
 * The pure half of saying it back (tell.md, slice D1).
 *
 * Everything a person HEARS goes through these two functions, and neither can
 * be checked by looking at a screen — which is the whole point of the feature
 * and the reason they are pure rather than inlined in the component.
 */

describe("punctuating a summary for the ear", () => {
  it("turns the separators the toasts use into pauses", () => {
    // Every real summary this product produces, as the packs write them.
    expect(forSpeech("3 head — died — from Pen 2")).toBe("3 head, died, from Pen 2");
    expect(forSpeech("Bluebell — all quiet")).toBe("Bluebell, all quiet");
    expect(forSpeech("Fix the top gate — due 2026-09-20")).toBe(
      "Fix the top gate, due 2026-09-20",
    );
    expect(forSpeech("Cattle · 12 head")).toBe("Cattle, 12 head");
  });

  it("leaves a line that already reads aloud alone", () => {
    expect(forSpeech("Clocked in at 7:42 AM")).toBe("Clocked in at 7:42 AM");
    expect(forSpeech("Pen 2 moved to Creek field")).toBe("Pen 2 moved to Creek field");
    expect(forSpeech("5 lb of Grower crumble to Pen 2")).toBe(
      "5 lb of Grower crumble to Pen 2",
    );
  });

  it("does not break a hyphen that is part of a word or a date", () => {
    // The dash rule wants SPACES on both sides for exactly this reason: a
    // paddock called "South-West" and a date are not two facts.
    expect(forSpeech("Moved to South-West")).toBe("Moved to South-West");
    expect(forSpeech("due 2026-09-20")).toBe("due 2026-09-20");
  });

  it("never leaves a doubled-up comma", () => {
    expect(forSpeech("Pen 2 — , odd")).toBe("Pen 2, odd");
    expect(forSpeech("Pen 2  —  spaced   out")).toBe("Pen 2, spaced out");
  });

  it("says nothing about an empty line", () => {
    expect(forSpeech("")).toBe("");
    expect(forSpeech("   ")).toBe("");
  });
});

describe("what it says once something is recorded", () => {
  it("says the one thing, in the pack's own words", () => {
    expect(spokenConfirmation(["Clocked in at 7:42 AM"])).toBe("Clocked in at 7:42 AM");
  });

  /**
   * THE ROUND IN ONE BREATH is the best trick the box has — "pen one fine, pen
   * two fine, pen three the water was frozen" is three cards from one sentence.
   * Answering that with "Recorded 3 things" throws away the answer somebody
   * actually asked for.
   */
  it("says all of a handful, because hearing them is the point", () => {
    const said = spokenConfirmation([
      "Pen 1 — looked at, all normal",
      "Pen 2 — looked at, all normal",
      "Pen 3 — the water was frozen",
    ]);
    expect(said).toBe(
      "Pen 1, looked at, all normal. Pen 2, looked at, all normal. Pen 3, the water was frozen",
    );
  });

  it("counts rather than lectures past a handful", () => {
    const many = Array.from({ length: SPEAK_EACH_UP_TO + 1 }, (_, i) => `Thing ${i}`);
    expect(spokenConfirmation(many)).toBe(`Recorded ${many.length} things`);
  });

  it("says nothing when there is nothing to say", () => {
    expect(spokenConfirmation([])).toBe("");
    expect(spokenConfirmation(["", "   "])).toBe("");
  });

  it("ignores a blank among real ones rather than counting it", () => {
    expect(spokenConfirmation(["Clocked in at 7:42 AM", "  "])).toBe(
      "Clocked in at 7:42 AM",
    );
  });
});

/**
 * WHICH OF THE DEVICE'S VOICES (F2d, ADR 0115). The founder heard Microsoft
 * David, the first English voice on a Windows PC, and called it "very
 * robotic". These are the lists real devices give, abridged.
 */
function voice(name: string, lang: string, extra: Partial<VoiceOption> = {}): VoiceOption {
  return { name, lang, localService: true, default: false, voiceURI: name, ...extra };
}

const windowsChrome = [
  voice("Microsoft David - English (United States)", "en-US", { default: true }),
  voice("Microsoft Mark - English (United States)", "en-US"),
  voice("Microsoft Zira - English (United States)", "en-US"),
  voice("Google Deutsch", "de-DE", { localService: false }),
  voice("Google US English", "en-US", { localService: false }),
  voice("Google UK English Female", "en-GB", { localService: false }),
];

const edge = [
  voice("Microsoft Ana Online (Natural) - English (United States)", "en-US", { localService: false }),
  voice("Microsoft Aria Online (Natural) - English (United States)", "en-US", { localService: false }),
  voice("Microsoft Guy Online (Natural) - English (United States)", "en-US", { localService: false }),
  voice("Microsoft David - English (United States)", "en-US", { default: true }),
  voice("Microsoft Libby Online (Natural) - English (United Kingdom)", "en-GB", { localService: false }),
];

const iphone = [
  voice("Albert", "en-US"),
  voice("Samantha", "en-US", { default: true }),
  voice("Samantha (Enhanced)", "en-US"),
  voice("Ava (Premium)", "en-US"),
  voice("Daniel", "en-GB"),
];

const american = { lang: "en", region: "en-US", online: true };

describe("the device's most natural voice", () => {
  it("takes Chrome's Google voice over Microsoft David on a Windows PC", () => {
    expect(pickVoice(windowsChrome, american)?.name).toBe("Google US English");
  });

  it("takes Edge's natural voices, never its child's", () => {
    expect(pickVoice(edge, american)?.name).toBe("Microsoft Aria Online (Natural) - English (United States)");
    expect(pickVoice(edge.slice(0, 1).concat(edge.slice(3)), american)?.name).toBe(
      "Microsoft Libby Online (Natural) - English (United Kingdom)",
    );
  });

  it("takes an iPhone's premium download, then its enhanced one, and never a novelty voice", () => {
    expect(pickVoice(iphone, american)?.name).toBe("Ava (Premium)");
    expect(pickVoice(iphone.slice(0, 3), american)?.name).toBe("Samantha (Enhanced)");
    expect(pickVoice(iphone.slice(0, 2), american)?.name).toBe("Samantha");
    expect(pickVoice([voice("Albert", "en-US"), voice("Fred", "en-US")], american)?.name).toBe("Albert");
  });

  it("uses only what is on the device when there is no signal", () => {
    expect(pickVoice(windowsChrome, { ...american, online: false })?.name).toBe(
      "Microsoft David - English (United States)",
    );
  });

  it("passes over a network voice that already failed on this page", () => {
    const picked = pickVoice(windowsChrome, { ...american, avoid: new Set(["Google US English"]) });
    expect(picked?.name).not.toBe("Google US English");
  });

  it("prefers the person's own region", () => {
    expect(pickVoice(windowsChrome, { lang: "en", region: "en-GB", online: true })?.name).toBe(
      "Google UK English Female",
    );
    expect(pickVoice([voice("English", "en_US")], american)?.name).toBe("English");
  });

  it("never speaks another language; the device's default when it has none of this one", () => {
    const foreign = [voice("Google Deutsch", "de-DE"), voice("Thomas", "fr-FR", { default: true })];
    expect(pickVoice(foreign, american)?.name).toBe("Thomas");
    expect(pickVoice([voice("Google Deutsch", "de-DE")], american)).toBeNull();
    expect(pickVoice([], american)).toBeNull();
  });
});
