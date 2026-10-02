import { describe, expect, it } from "vitest";
import { RECORD_BATCH_MAX, RECORD_LINE_MAX, recordRequestSchema } from "../src/lib/speech/voices";
import { keywordsFor } from "../src/lib/voice-commands/phrases";
import type { CookTimer } from "../src/modules/food/core/cook";
import { realSteps } from "../src/modules/food/core/cook";
import {
  COOK_COMMANDS,
  commandWords,
  cookListening,
  everyCookLine,
  firstRinging,
  isCookCommand,
  listSpeech,
  nextStepTime,
  SAY,
  speechLines,
  spokenRange,
  spokenText,
  startedSpeech,
  stepSpeech,
  stoppedSpeech,
  timerLabel,
  usesSpeech,
} from "../src/modules/food/core/hands-free";

/**
 * FOOD D1c, hands-free cook mode (docs/modules/food.md; ADR 0124): what cook
 * mode listens for, how a recipe is said aloud, and which timer a voice starts
 * or stops. Invented recipes only.
 */

const steps = realSteps([
  { text: "Heat the oven to 400°F. Butter a 10-inch skillet." },
  { text: "Whisk the flour, the cornmeal and the salt." },
  { text: "For the batter", heading: true },
  { text: "Beat the eggs into the milk; pour into the dry mix." },
  { text: "Bake 25 to 30 minutes, until golden. Rest 5 minutes before cutting." },
]);
const ingredients = [
  { text: "1 ½ cups flour" },
  { text: "1 cup cornmeal" },
  { text: "½ tsp salt" },
  { text: "Wet", heading: true },
  { text: "2 eggs" },
  { text: "1 cup milk" },
];

function timer(over: Partial<CookTimer>): CookTimer {
  return { id: "t", label: "Step 4 · 25–30 min", lo: 1500, hi: 1800, endsAt: 0, ...over };
}

describe("what cook mode listens for", () => {
  it("listens for start timer while nothing rings, and for stop timer only while something does", () => {
    expect(cookListening(false)).toEqual(["next", "back", "repeat", "start-timer", "ingredients"]);
    expect(cookListening(true)).toEqual(["next", "back", "repeat", "stop-timer", "ingredients"]);
  });

  it("gives the engine a vocabulary it accepts: no two pronunciations alike, in either state", () => {
    for (const ringing of [false, true]) {
      const keywords = keywordsFor(COOK_COMMANDS, cookListening(ringing));
      const sounds = keywords.flatMap((k) => k.matches.map((m) => m.tokens.join(" ")));
      expect(new Set(sounds).size).toBe(sounds.length);
      expect(keywords.map((k) => k.label)).toEqual(cookListening(ringing));
    }
  });

  it("hears the alternates as the same command", () => {
    const [back] = keywordsFor(COOK_COMMANDS, ["back"]);
    expect(back.matches.length).toBe(5);
    expect(commandWords("back")).toBe("go back");
    expect(commandWords("ingredients")).toBe("ingredients");
  });

  it("knows its own labels and nothing else", () => {
    expect(isCookCommand("next")).toBe(true);
    expect(isCookCommand("stop-timer")).toBe(true);
    expect(isCookCommand("toString")).toBe(false);
    expect(isCookCommand("constructor")).toBe(false);
  });
});

describe("a recipe's shorthand, said aloud", () => {
  it.each([
    // What the voice garbled when read back (2026-10-02).
    ["Whisk in 1 ½ cups flour and 1/4 cup sugar.", "Whisk in 1 and a half cups flour and a quarter cup sugar."],
    ["Stir in 3/4 cup milk and 1 1/2 tsp vanilla.", "Stir in three quarters cup milk and 1 and a half teaspoons vanilla."],
    ["Add 2 tbsp butter and ½ tsp salt.", "Add 2 tablespoons butter and a half teaspoon salt."],
    ["Pour into a 9x13-inch pan.", "Pour into a 9 by 13 inch pan."],
    ["Bake at 400F.", "Bake at 400 degrees Fahrenheit."],
    ["Bake at 200 C.", "Bake at 200 degrees Celsius."],
    ["Add 2-3 Tbsp oil.", "Add 2 to 3 tablespoons oil."],
    ["Bake 25–30 minutes.", "Bake 25 to 30 minutes."],
    ["Season with 1 tbsp. kosher salt.", "Season with 1 tablespoon kosher salt."],
    ["Add 1 tsp.", "Add 1 teaspoon."],
    ["Add 1½ tsp baking soda.", "Add 1 and a half teaspoons baking soda."],
    ["Use ⅔ cup.", "Use two thirds cup."],
    // What it already says well is left alone.
    ["Bake at 400°F for 25 min.", "Bake at 400°F for 25 min."],
    ["Add 8 oz cream cheese and 2 lbs beef.", "Add 8 oz cream cheese and 2 lbs beef."],
    ["Add 1.5 cups stock.", "Add 1.5 cups stock."],
  ])("%s", (written, said) => {
    expect(spokenText(written)).toBe(said);
  });

  it("leaves numbers that are not fractions alone", () => {
    expect(spokenText("Serves 12. Makes 24 cookies.")).toBe("Serves 12. Makes 24 cookies.");
    expect(spokenText("Bake at 350/180 for 9/30.")).toBe("Bake at 350/180 for 9/30.");
  });
});

describe("lines the voice route takes", () => {
  it("keeps a step that fits as one line", () => {
    expect(speechLines("Bake 25 minutes.")).toEqual(["Bake 25 minutes."]);
    expect(speechLines("   ")).toEqual([]);
  });

  it("cuts a long step at its sentences, packing them, and never past the limit", () => {
    const sentence = "Stir the sauce slowly over a low heat until it thickens and coats the back of a spoon.";
    const long = Array.from({ length: 8 }, () => sentence).join(" ");
    const lines = speechLines(long);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(RECORD_LINE_MAX);
      expect(line.endsWith(".")).toBe(true);
    }
    expect(lines.join(" ")).toBe(long);
  });

  it("does not cut inside a number", () => {
    const lines = speechLines(`${"Add 1.5 cups of the warm stock, stirring all the while. ".repeat(7)}`.trim());
    for (const line of lines) expect(line.startsWith("5 cups")).toBe(false);
  });

  it("cuts a sentence longer than a line at a comma, or between words", () => {
    const run = `Add ${Array.from({ length: 60 }, (_, i) => `item ${i}`).join(", ")}.`;
    const lines = speechLines(run);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(RECORD_LINE_MAX);
    expect(lines.join(" ")).toBe(run);
    const words = "word ".repeat(120).trim();
    expect(speechLines(words).join(" ")).toBe(words);
  });
});

describe("what the voice says", () => {
  it("says a group's heading when the group starts, and not again", () => {
    expect(stepSpeech(steps, 0)).toEqual(["Heat the oven to 400°F. Butter a 10 inch skillet."]);
    expect(stepSpeech(steps, 2)).toEqual(["For the batter.", "Beat the eggs into the milk; pour into the dry mix."]);
    expect(stepSpeech(steps, 3)).toEqual(["Bake 25 to 30 minutes, until golden. Rest 5 minutes before cutting."]);
    expect(stepSpeech(steps, 9)).toEqual([]);
  });

  it("reads the list at the servings being cooked, headings included", () => {
    expect(listSpeech(ingredients, 2)).toEqual([
      "3 cups flour. 2 cups cornmeal. 1 teaspoon salt. Wet. 4 eggs. 2 cups milk.",
    ]);
    expect(listSpeech([], 1)).toEqual([SAY.noList]);
  });

  it("says what a step uses, or that it names nothing", () => {
    expect(usesSpeech(steps[1].text, ingredients, 1)).toEqual([
      "This step uses 1 and a half cups flour, 1 cup cornmeal and a half teaspoon salt.",
    ]);
    expect(usesSpeech(steps[0].text, ingredients, 1)).toEqual([SAY.usesNothing]);
  });

  it("says a timer the way a person would", () => {
    expect(spokenRange(1500, 1800)).toBe("25 to 30 minutes");
    expect(spokenRange(4500, null)).toBe("1 hour 15 minutes");
    expect(spokenRange(60, null)).toBe("1 minute");
    expect(spokenRange(45, null)).toBe("45 seconds");
    expect(spokenRange(3600, 5400)).toBe("1 hour to 1 hour 30 minutes");
    expect(startedSpeech({ lo: 1500, hi: 1800 })).toBe("Timer started: 25 to 30 minutes.");
    expect(stoppedSpeech({ hi: 1800 }, false)).toBe("Timer stopped. Check it now. It can take up to 30 minutes.");
    expect(stoppedSpeech({ hi: null }, true)).toBe("Timer stopped. Another one is ringing.");
  });

  it("fetches ahead every line it might say, each one the route accepts, in batches it accepts", () => {
    const lines = everyCookLine(steps, ingredients, 1);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).toContain(SAY.gather);
    expect(lines).toContain("Timer started: 25 to 30 minutes.");
    expect(lines).toContain("Timer stopped. Check it now. It can take up to 30 minutes.");
    for (let i = 0; i < lines.length; i += RECORD_BATCH_MAX) {
      expect(recordRequestSchema.safeParse({ voice: "arcas", lines: lines.slice(i, i + RECORD_BATCH_MAX) }).success).toBe(true);
    }
  });
});

describe("timers by voice", () => {
  const twoTimes = "Cook 5 minutes, flip, then cook 5 minutes more and rest 2 minutes.";

  it("labels a voice's timer as a tap's", () => {
    expect(timerLabel(4, { lo: 1500, hi: 1800 })).toBe("Step 4 · 25–30 min");
  });

  it("starts the step's first time, then the next one each time it is asked", () => {
    expect(nextStepTime(twoTimes, 2, [])).toMatchObject({ lo: 300, text: "5 minutes" });
    const one = [timer({ label: "Step 2 · 5 min" })];
    expect(nextStepTime(twoTimes, 2, one)).toMatchObject({ lo: 300, start: twoTimes.lastIndexOf("5 minutes") });
    const two = [...one, timer({ id: "u", label: "Step 2 · 5 min" })];
    expect(nextStepTime(twoTimes, 2, two)).toMatchObject({ lo: 120 });
    const all = [...two, timer({ id: "v", label: "Step 2 · 2 min" })];
    expect(nextStepTime(twoTimes, 2, all)).toBe("running");
  });

  it("starts nothing in a step with no time, and counts only this step's timers", () => {
    expect(nextStepTime("Whisk the eggs.", 1, [])).toBeNull();
    expect(nextStepTime(twoTimes, 3, [timer({ label: "Step 2 · 5 min" })])).toMatchObject({ lo: 300, start: twoTimes.indexOf("5 minutes") });
  });

  it("stops the timer that has rung longest, and none that has not rung", () => {
    const now = 10_000;
    const timers = [timer({ id: "late", endsAt: 9_000 }), timer({ id: "first", endsAt: 5_000 }), timer({ id: "still", endsAt: 20_000 })];
    expect(firstRinging(timers, now)?.id).toBe("first");
    expect(firstRinging([timer({ endsAt: 20_000 })], now)).toBeNull();
  });
});
