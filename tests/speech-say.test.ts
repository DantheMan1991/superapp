import { describe, expect, it } from "vitest";
import {
  forSpeech,
  SPEAK_EACH_UP_TO,
  spokenConfirmation,
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
