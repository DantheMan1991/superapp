import { describe, expect, it } from "vitest";
import { RECORD_BATCH_MAX, recordRequestSchema } from "../src/lib/speech/voices";
import { keywordsFor, PHRASES } from "../src/lib/voice-commands/phrases";
import {
  commandWords,
  isWorkoutCommand,
  notYet,
  notYetLines,
  REPLY,
  replyLines,
  sayHere,
  sayList,
  WORKOUT_COMMANDS,
  WORKOUT_LISTENING,
} from "../src/modules/fitness/core/hands-free";

/**
 * WORKOUTS F6, hands-free in workout mode (docs/modules/fitness.md): what
 * workout mode listens for, what each place says can be said, and the coach's
 * words back. The listener itself is shared (tests/voice-commands.test.ts).
 */

describe("what workout mode listens for", () => {
  it("is the two-word phrases he chose, one vocabulary the engine accepts", () => {
    const keywords = keywordsFor(WORKOUT_COMMANDS, WORKOUT_LISTENING);
    expect(keywords.map((k) => k.label)).toEqual(["start", "done", "pause", "resume", "again", "next", "repeat"]);
    const sounds = keywords.flatMap((k) => k.matches.map((m) => m.tokens.join(" ")));
    expect(new Set(sounds).size).toBe(sounds.length);
    expect(WORKOUT_LISTENING.map(commandWords)).toEqual([
      "start set",
      "set done",
      "pause workout",
      "resume",
      "one more set",
      "next exercise",
      "repeat",
    ]);
  });

  it("never listens for a single word that comes up in talk", () => {
    for (const command of WORKOUT_LISTENING) {
      for (const phrase of WORKOUT_COMMANDS[command]) {
        // "resume" and "repeat" are the two single words: measured, and neither fired.
        if (phrase !== "resume" && phrase !== "repeat") expect(phrase.split(" ").length).toBeGreaterThan(1);
        expect(PHRASES[phrase].length).toBeGreaterThan(0);
      }
    }
  });

  it("knows its own labels and nothing else", () => {
    expect(isWorkoutCommand("done")).toBe(true);
    expect(isWorkoutCommand("again")).toBe(true);
    expect(isWorkoutCommand("next-step")).toBe(false);
    expect(isWorkoutCommand("toString")).toBe(false);
  });
});

describe("what the box says can be said", () => {
  it("lists the phrases for each place", () => {
    expect(sayList(sayHere("timed-set"))).toBe("“start set”, “set done”, “pause workout”, “resume” or “repeat”");
    expect(sayList(sayHere("counted-set"))).toBe("“set done” or “repeat”");
    expect(sayList(sayHere("check"))).toBe("“one more set”, “next exercise” or “repeat”");
    expect(sayList(sayHere("check-full"))).toBe("“next exercise” or “repeat”");
    expect(sayList([])).toBe("");
    expect(sayList(["repeat"])).toBe("“repeat”");
  });
});

describe("the coach's words back", () => {
  it("says how far a set is when it is ended too soon", () => {
    expect(notYet(3, 5, "breaths").text).toBe("Not yet: 3 of 5 breaths.");
    expect(notYet(12, 30, "seconds").text).toBe("Not yet: 12 of 30 seconds.");
    expect(notYet(0, 1, "breaths").text).toBe("Not yet: 0 of 1 breath.");
  });

  it("replaces an unsaid older word back, and never waits behind the set's own lines", () => {
    for (const line of Object.values(REPLY)) {
      expect(line.key).toBe("reply");
      expect(line.priority).toBe("normal");
    }
    expect(notYet(1, 5, "breaths").key).toBe("reply");
  });

  it("fetches a timed set's 'not yet' lines ahead, one for each count short of its least, at most thirty", () => {
    expect(notYetLines(3, "breaths")).toEqual([
      "Not yet: 0 of 3 breaths.",
      "Not yet: 1 of 3 breaths.",
      "Not yet: 2 of 3 breaths.",
    ]);
    const hold = notYetLines(60, "seconds");
    expect(hold).toHaveLength(30);
    expect(hold[29]).toBe("Not yet: 29 of 60 seconds.");
    expect(notYetLines(0, "breaths")).toEqual([]);
    expect(recordRequestSchema.safeParse({ voice: "arcas", lines: hold }).success).toBe(true);
  });

  it("fetches every fixed word back ahead, each a line the voice route takes", () => {
    const lines = replyLines();
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).toContain("Paused.");
    expect(lines).toContain("Resumed.");
    expect(lines).toContain("Starting in five.");
    expect(lines.length).toBeLessThanOrEqual(RECORD_BATCH_MAX);
    expect(recordRequestSchema.safeParse({ voice: "arcas", lines }).success).toBe(true);
  });
});
