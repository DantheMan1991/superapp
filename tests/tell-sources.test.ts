import { describe, expect, it } from "vitest";
import {
  checkEntry,
  matchChoice,
  normalizeLabel,
  resolveEntries,
  TELL_MAX_ENTRIES,
  tellToolFor,
  validateProposal,
} from "../src/lib/tell-sources/shape";
import type { TellAction, TellField } from "../src/lib/tell-sources/types";

/**
 * The pure half of telling it something (ADR 0039): the tool built from the
 * actions a tenant has, the loose boundary on what comes back, and the
 * judgement of every field.
 *
 * What this file certifies: the model is offered exactly the tenant's own
 * actions and no others; a word that matches no choice is kept as a HINT
 * rather than guessed or dropped; "the nearest one" is never picked; a date
 * defaults to the tenant's today but a wrong one still says what was heard;
 * and the check a card gets in the box is the one the server runs.
 */

const LOT: TellField = {
  key: "lot",
  label: "Which animals",
  kind: "choice",
  required: true,
  hint: "The pen.",
  choices: [
    { value: "l1", label: "Pen 2" },
    { value: "l2", label: "Pen 3" },
    { value: "l3", label: "Spring broilers" },
  ],
};
const HEAD: TellField = { key: "head", label: "How many", kind: "number", required: true, hint: "How many." };
const ON: TellField = { key: "on", label: "When", kind: "date", required: true, hint: "The day.", defaultToday: true };
const NOTES: TellField = { key: "notes", label: "Notes", kind: "text", hint: "What was seen." };

const record = async () => ({ summary: "done" });
const LOSS: TellAction = {
  slug: "livestock.loss",
  title: "Animals lost",
  about: "Animals died.",
  fields: [LOT, HEAD, ON, NOTES],
  record,
};
const MOVE: TellAction = {
  slug: "livestock.move",
  title: "Moved somewhere",
  about: "Moved onto a paddock.",
  fields: [LOT, { ...LOT, key: "zone", label: "Where to", choices: [{ value: "z1", label: "Creek field" }] }, ON],
  record,
};
const ACTIONS = [LOSS, MOVE];
const TODAY = "2026-09-09";

describe("tellToolFor", () => {
  it("offers exactly the tenant's own actions, with each field and its choices written out", () => {
    const tool = tellToolFor(ACTIONS);
    const schema = tool.input_schema as {
      properties: { entries: { items: { properties: { action: { enum: string[] } } } } };
    };
    expect(schema.properties.entries.items.properties.action.enum).toEqual([
      "livestock.loss",
      "livestock.move",
    ]);
    expect(tool.description).toContain("livestock.loss — Animals lost");
    expect(tool.description).toContain("“Pen 2”");
    expect(tool.description).toContain("“Creek field”");
    // The instruction that keeps a wrong pen out of the herd.
    expect(tool.description).toContain("otherwise the sentence's own words");
  });
});

describe("validateProposal", () => {
  it("holds the model to entries of an action and some fields, and refuses anything else", () => {
    expect(validateProposal({ entries: [{ action: "livestock.loss", fields: { head: 3 } }] })).toEqual([
      { action: "livestock.loss", fields: { head: 3 } },
    ]);
    expect(validateProposal({ entries: [] })).toEqual([]);
    expect(validateProposal({})).toBeNull();
    expect(validateProposal({ entries: [{ fields: {} }] })).toBeNull();
    expect(validateProposal({ entries: [{ action: "x", fields: { a: { b: 1 } } }] })).toBeNull();
    expect(
      validateProposal({
        entries: Array.from({ length: TELL_MAX_ENTRIES + 1 }, () => ({
          action: "livestock.loss",
          fields: {},
        })),
      }),
    ).toBeNull();
  });
});

describe("resolveEntries", () => {
  it("judges each field by its kind and keeps what it could not place as a hint", () => {
    const cards = resolveEntries(
      [
        {
          action: "livestock.loss",
          fields: { lot: "Pen 2", head: "3", on: "2026-09-08", notes: "water was frozen" },
        },
        {
          action: "livestock.loss",
          fields: { lot: "the back pen", head: "a few", on: "yesterday" },
        },
      ],
      ACTIONS,
      TODAY,
    );
    expect(cards[0]).toEqual({
      actionSlug: "livestock.loss",
      values: { lot: "l1", head: 3, on: "2026-09-08", notes: "water was frozen" },
      hints: {},
    });
    // Nothing guessed: the pen, the count and the day all come back as what
    // was heard, and the day falls back to today because the field says so.
    expect(cards[1].values).toEqual({ lot: null, head: null, on: TODAY, notes: null });
    expect(cards[1].hints).toEqual({
      lot: "the back pen",
      head: "a few",
      on: "yesterday",
    });
  });

  it("fills a date with today when the sentence says nothing", () => {
    const [card] = resolveEntries(
      [{ action: "livestock.loss", fields: { lot: "Pen 3", head: 1 } }],
      ACTIONS,
      TODAY,
    );
    expect(card.values.on).toBe(TODAY);
    expect(card.hints).toEqual({});
  });

  it("drops an entry naming an action this tenant does not have", () => {
    expect(
      resolveEntries(
        [
          { action: "livestock.treatment", fields: { lot: "Pen 2" } },
          { action: "livestock.move", fields: { lot: "Pen 2", zone: "Creek field" } },
        ],
        ACTIONS,
        TODAY,
      ).map((c) => c.actionSlug),
    ).toEqual(["livestock.move"]);
  });

  it("caps what one sentence can produce", () => {
    expect(
      resolveEntries(
        Array.from({ length: TELL_MAX_ENTRIES + 4 }, () => ({
          action: "livestock.loss",
          fields: { lot: "Pen 2", head: 1 },
        })),
        ACTIONS,
        TODAY,
      ),
    ).toHaveLength(TELL_MAX_ENTRIES);
  });
});

describe("matchChoice", () => {
  it("matches a label exactly, case and spacing aside", () => {
    expect(matchChoice(LOT, "pen 2")).toBe("l1");
    expect(matchChoice(LOT, "  Pen   3 ")).toBe("l2");
  });

  it("matches a label contained in the words, but only when one fits", () => {
    expect(matchChoice(LOT, "the spring broilers pen")).toBe("l3");
    // "Pen 2" and "Pen 3" are both nowhere in this, and "pen" alone is neither.
    expect(matchChoice(LOT, "the back pen")).toBeNull();
  });

  it("never picks the nearest one", () => {
    expect(matchChoice(LOT, "Pen")).toBeNull();
    expect(matchChoice(LOT, "Pen 4")).toBeNull();
    expect(matchChoice(LOT, "")).toBeNull();
  });

  it("normalises the way the matcher does", () => {
    expect(normalizeLabel("  Creek   Field ")).toBe("creek field");
  });
});

describe("checkEntry", () => {
  it("names the first thing wrong, and passes a complete card", () => {
    expect(checkEntry({ lot: "l1", head: 3, on: TODAY, notes: null }, LOSS)).toBeNull();
    expect(checkEntry({ lot: null, head: 3, on: TODAY }, LOSS)).toBe("Which animals is missing.");
    expect(checkEntry({ lot: "l1", head: null, on: TODAY }, LOSS)).toBe("How many is missing.");
    expect(checkEntry({ lot: "l1", head: "3", on: TODAY }, LOSS)).toBe("How many should be a number.");
    expect(checkEntry({ lot: "l1", head: 3, on: "2026-02-30" }, LOSS)).toBe("When is not a real date.");
    // A choice the tenant does not have, however it got there.
    expect(checkEntry({ lot: "nope", head: 3, on: TODAY }, LOSS)).toBe(
      "Which animals is not one of the choices.",
    );
  });
});
