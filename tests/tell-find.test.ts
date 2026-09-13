import { describe, expect, it } from "vitest";
import { decide, MAX_OPTIONS } from "../src/lib/tell-sources/find";
import { checkEntry } from "../src/lib/tell-sources/shape";
import type { TellCandidate } from "../src/lib/tell-sources/types";

/**
 * Going and looking, instead of picking off a menu.
 *
 * The old design wrote every lot, paddock and job name into the model's prompt
 * and demanded an exact pick. It failed twice over, and the founder found both:
 * the menu could never hold a business with two thousand customers, and the
 * exact pick meant *"checked the cows"* matched nothing at all.
 *
 * What is tested here is the half that decides, because it is the half that
 * could quietly become "nearest match" again. ADR 0039 refused to guess for a
 * reason, and the reason has not changed — only the mechanism.
 */

const lot = (label: string, detail?: string): TellCandidate => ({
  value: label.toLowerCase().replace(/\s+/g, "-"),
  label,
  detail,
});

describe("deciding between what the search found", () => {
  it("takes the only one there is", () => {
    expect(decide([lot("Meadow")], "the cows")?.label).toBe("Meadow");
  });

  it("takes the one whose name is exactly what was said", () => {
    const found = [lot("Meadow"), lot("Spring broilers"), lot("Pen 3")];
    expect(decide(found, "Meadow")?.label).toBe("Meadow");
    expect(decide(found, "  meadow  ")?.label).toBe("Meadow");
    expect(decide(found, "PEN 3")?.label).toBe("Pen 3");
  });

  it("reads a name through punctuation, since nobody dictates hyphens", () => {
    expect(decide([lot("PEN-1"), lot("PEN-2")], "pen 1")?.label).toBe("PEN-1");
  });

  /** THE ONE THAT MATTERS. */
  it("REFUSES to pick the nearest when several are plausible", () => {
    // "Pen 3" is one character from "Pen 2". Anything ranking by similarity
    // would answer confidently and move animals into the wrong pen, which is
    // exactly what ADR 0039's "never nearest" exists to prevent. Two
    // candidates is a question, and the question gets asked.
    expect(decide([lot("Pen 2"), lot("Pen 3")], "pen")).toBeNull();
    expect(decide([lot("Meadow"), lot("Meadow Two")], "meadow two ish")).toBeNull();
  });

  it("refuses when two things share the name that was said", () => {
    // A farm with two "Rosie"s has a real question and no right answer.
    expect(decide([lot("Rosie"), lot("Rosie")], "Rosie")).toBeNull();
  });

  it("is null for nothing found, which is a dead end and says so", () => {
    expect(decide([], "the cows")).toBeNull();
  });

  it("does not read a name out of a longer phrase", () => {
    // "the meadow cows" containing "Meadow" is a hint, not a decision — the
    // species half of that sentence may point somewhere else entirely, and the
    // pack's own ordering is better placed to judge than a substring test.
    expect(decide([lot("Meadow"), lot("Pen 3")], "the meadow cows")).toBeNull();
  });
});

describe("the shortlist stays a question", () => {
  it("is capped, because a list of thirty is a menu again", () => {
    expect(MAX_OPTIONS).toBeLessThanOrEqual(6);
    expect(MAX_OPTIONS).toBeGreaterThan(1);
  });
});

describe("both sides agree a field is searched", () => {
  /*
   * THE SERVER AND THE BOX SEE DIFFERENT OBJECTS. The server's field carries
   * `find`, a function; the box's carries `searched`, a boolean, because a
   * function cannot cross into a client component. `checkEntry` runs on BOTH,
   * and the first version only understood the server's spelling — so a field
   * that had been found correctly was still rejected, with the answer sitting
   * on the card in front of you.
   */
  const value = "a-real-id-from-the-pack";

  it("accepts a found value on the server, where the field has `find`", () => {
    const action = {
      fields: [
        {
          key: "lot",
          label: "Which animals",
          kind: "choice" as const,
          required: true,
          hint: "",
          find: async () => [],
        },
      ],
    };
    expect(checkEntry({ lot: value }, action)).toBeNull();
  });

  it("accepts it in the box too, where the field only has `searched`", () => {
    const action = {
      fields: [
        {
          key: "lot",
          label: "Which animals",
          kind: "choice" as const,
          required: true,
          hint: "",
          searched: true,
        },
      ],
    };
    expect(checkEntry({ lot: value }, action as never)).toBeNull();
  });

  it("still refuses a value that is not on a REAL list", () => {
    // An enumerated field keeps its guard. Only a searched one is trusted to
    // its own pack's verb.
    const action = {
      fields: [
        {
          key: "reason",
          label: "What happened",
          kind: "choice" as const,
          required: true,
          hint: "",
          choices: [{ value: "death", label: "Died" }],
        },
      ],
    };
    expect(checkEntry({ reason: "death" }, action)).toBeNull();
    expect(checkEntry({ reason: "invented" }, action)).toBe(
      "What happened is not one of the choices.",
    );
  });

  it("still refuses an empty one, searched or not", () => {
    const action = {
      fields: [
        {
          key: "lot",
          label: "Which animals",
          kind: "choice" as const,
          required: true,
          hint: "",
          find: async () => [],
        },
      ],
    };
    expect(checkEntry({ lot: "" }, action)).toBe("Which animals is missing.");
    expect(checkEntry({ lot: null }, action)).toBe("Which animals is missing.");
  });
});
