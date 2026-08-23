import { describe, expect, it } from "vitest";
import { validateKillSheet } from "../src/packs/production/ai/kill-sheet";
import { validatePriceList } from "../src/packs/production/ai/price-list";
import { readNumber, readText } from "../src/packs/production/ai/paperwork";

/**
 * The validators, which are the layer that decides what a model is ALLOWED to
 * assert. No database and no network — every one of these is a model output
 * that could plausibly arrive, and what the app does with it.
 *
 * **THE PROMPT IS NOT A GUARD.** Every rule the prompts state is re-applied
 * here, because a prompt is a request and this is the thing that is true. The
 * tests that matter most are the ones where a well-formed, confident, WRONG
 * answer comes back — those are the ones a person would not catch on a screen.
 */

describe("validateKillSheet", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    tag: "",
    headCount: 1,
    liveLb: null,
    hangingLb: null,
    condemned: false,
    condemnReason: "",
    ...over,
  });

  it("takes a well-formed sheet through unchanged", () => {
    const out = validateKillSheet({
      lines: [
        line({ headCount: 97, liveLb: 594.5, hangingLb: 472 }),
        line({ headCount: 3, condemned: true, condemnReason: "Airsacculitis" }),
      ],
      note: "Bottom row smudged.",
    });
    expect(out.lines).toHaveLength(2);
    expect(out.lines[0].hangingLb).toBe(472);
    expect(out.lines[1].condemnReason).toBe("Airsacculitis");
    expect(out.note).toBe("Bottom row smudged.");
  });

  it("STRIPS A HANGING WEIGHT OFF A CONDEMNED LINE", () => {
    // The single most important test here. The table's CHECK refuses this, so a
    // proposal carrying it would become a form somebody fills in, presses save
    // on, and gets a constraint violation from. It is also wrong on the merits:
    // nothing off a condemned carcass can be sold, so a weight against one is
    // a number that would find its way into a numerator.
    const out = validateKillSheet({
      lines: [line({ headCount: 3, condemned: true, hangingLb: 18.5 })],
      note: "",
    });
    expect(out.lines[0].hangingLb).toBeNull();
  });

  it("strips a cause off a line that passed", () => {
    // The mirror CHECK. A passed line with a condemnation reason on it is a
    // sentence about an animal nothing happened to.
    const out = validateKillSheet({
      lines: [line({ condemned: false, condemnReason: "Bruising" })],
      note: "",
    });
    expect(out.lines[0].condemnReason).toBe("");
  });

  it("drops a line covering no animals, and keeps the rest", () => {
    // A line is a line because it covers head. Everything else on it may be
    // blank; this may not.
    const out = validateKillSheet({
      lines: [
        line({ headCount: 0 }),
        line({ headCount: -4 }),
        line({ headCount: 2.5 }),
        line({ headCount: "seven" }),
        line({ headCount: 12 }),
      ],
      note: "",
    });
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].headCount).toBe(12);
  });

  it("turns an unreadable weight into null rather than zero", () => {
    // NULL IS NOT ZERO, and on a kill sheet zero is a real value meaning the
    // animal produced nothing. A screen showing an empty box gets it typed in;
    // one showing 0.0 lb does not.
    const out = validateKillSheet({
      lines: [line({ liveLb: "illegible", hangingLb: Number.NaN })],
      note: "",
    });
    expect(out.lines[0].liveLb).toBeNull();
    expect(out.lines[0].hangingLb).toBeNull();
  });

  it("survives every shape of nonsense without throwing", () => {
    // A dialog is open when this runs. An exception here takes the screen down
    // and loses the photograph; zero lines and a note degrades to "type it in".
    for (const junk of [null, undefined, "", 42, [], { lines: "no" }, { lines: [null, 7, "x"] }]) {
      const out = validateKillSheet(junk);
      expect(out.lines).toEqual([]);
    }
  });
});

describe("validatePriceList", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    kind: "cattle",
    capacityPerDay: null,
    killFee: null,
    cutWrapPerLb: null,
    priceNotes: "",
    ...over,
  });

  it("takes a well-formed sheet through unchanged", () => {
    const out = validatePriceList({
      rows: [row({ killFee: 105, cutWrapPerLb: 0.9, capacityPerDay: 8 })],
      note: "",
    });
    expect(out.rows[0]).toMatchObject({
      kind: "cattle",
      killFee: 105,
      cutWrapPerLb: 0.9,
      capacityPerDay: 8,
    });
  });

  it("KEEPS A ROW WHOSE KIND IT COULD NOT PLACE, with the kind emptied", () => {
    // Dropping it would silently lose a price off the sheet, which is the exact
    // failure this feature exists to prevent. The fee is still worth having;
    // the form makes somebody say what it is for.
    const out = validatePriceList({
      rows: [row({ kind: "Bison (whole)", killFee: 250 })],
      note: "",
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].kind).toBe("");
    expect(out.rows[0].killFee).toBe(250);
  });

  it("normalises a kind the way the slug rule does", () => {
    expect(validatePriceList({ rows: [row({ kind: "Cattle" })] }).rows[0].kind)
      .toBe("cattle");
    expect(validatePriceList({ rows: [row({ kind: "dairy cow" })] }).rows[0].kind)
      .toBe("dairy_cow");
  });

  it("refuses a negative fee — a plant does not pay you", () => {
    const out = validatePriceList({
      rows: [row({ killFee: -95, cutWrapPerLb: -1 })],
      note: "",
    });
    expect(out.rows[0].killFee).toBeNull();
    expect(out.rows[0].cutWrapPerLb).toBeNull();
  });

  it("keeps a genuine zero, which is not the same as unquoted", () => {
    // A waived kill fee is a real thing a sheet can say. Only NULL means
    // nobody quoted one.
    const out = validatePriceList({ rows: [row({ killFee: 0 })], note: "" });
    expect(out.rows[0].killFee).toBe(0);
  });

  it("survives every shape of nonsense without throwing", () => {
    for (const junk of [null, undefined, "", 42, [], { rows: "no" }]) {
      expect(validatePriceList(junk).rows).toEqual([]);
    }
  });
});

describe("readNumber", () => {
  it("returns null for anything that is not a number in range", () => {
    expect(readNumber(12)).toBe(12);
    expect(readNumber("12.5")).toBe(12.5);
    // AN EMPTY STRING IS NOT A ZERO. `Number("")` is 0, and this test caught
    // that: a blank cell on a rate sheet would have become a confident $0.00
    // fee reading as "they waived it" rather than "nobody said".
    expect(readNumber("")).toBeNull();
    expect(readNumber("   ")).toBeNull();
    expect(readNumber(null)).toBeNull();
    expect(readNumber(undefined)).toBeNull();
    expect(readNumber({})).toBeNull();
    expect(readNumber(Number.NaN)).toBeNull();
    expect(readNumber(Infinity)).toBeNull();
    expect(readNumber(5, { min: 10 })).toBeNull();
    expect(readNumber(5, { max: 1 })).toBeNull();
    expect(readNumber(1.5, { integer: true })).toBeNull();
  });

  it("keeps zero, which is a real answer and not a missing one", () => {
    expect(readNumber(0)).toBe(0);
  });
});

describe("readText", () => {
  it("gives a string back for anything, so a form can bind to it", () => {
    expect(readText("  hi  ")).toBe("hi");
    expect(readText(null)).toBe("");
    expect(readText(12)).toBe("");
    expect(readText("x".repeat(900), 10)).toHaveLength(10);
  });
});

/**
 * ── WHAT A REAL RATE SHEET DID (2026-08-23) ───────────────────────────────
 *
 * Pleasant Valley Poultry's 2026 price list, a genuine two-page USDA poultry
 * plant sheet, was run through the live extractor. These pin the two shapes it
 * contains that a naive reader gets WRONG, because both were refused correctly
 * and a later prompt change must not start guessing at them.
 */
describe("what a real rate sheet contains", () => {
  it("keeps a banded fee OUT of the number and IN the note", () => {
    // The chicken slaughter fee on that sheet is a 4-breed x 6-batch-band
    // matrix — 24 prices. Any single one of them in `killFee` is wrong for the
    // other 23. The live run returned null and put the whole matrix in the
    // note, which is the only honest answer.
    const out = validatePriceList({
      rows: [
        {
          kind: "chicken",
          capacityPerDay: null,
          killFee: null,
          cutWrapPerLb: null,
          priceNotes:
            "Cornish x $3.75 (50 to 100), $3.15 (101 to 250) ... varies by breed and batch size",
        },
      ],
      note: "",
    });
    expect(out.rows[0].killFee).toBeNull();
    expect(out.rows[0].priceNotes).toContain("varies by breed and batch size");
  });

  it("keeps a PER-POUND slaughter fee out of the per-head field", () => {
    // Turkey on that sheet is $0.65-$0.90 PER POUND with a $10 minimum, not a
    // flat fee per bird. `killFee` is per head, so the only correct value is
    // null — and 0.65 would have looked entirely plausible sitting there.
    const out = validatePriceList({
      rows: [
        {
          kind: "turkey",
          capacityPerDay: null,
          killFee: null,
          cutWrapPerLb: null,
          priceNotes: "charged by weight, not a flat per head fee",
        },
      ],
      note: "",
    });
    expect(out.rows[0].killFee).toBeNull();
  });

  it("takes the flat per-bird fees exactly as printed", () => {
    // Ducks, geese and quail ARE flat per head, and the live run returned all
    // three to the cent.
    const out = validatePriceList({
      rows: [
        { kind: "duck", capacityPerDay: null, killFee: 10.55, cutWrapPerLb: null, priceNotes: "" },
        { kind: "goose", capacityPerDay: null, killFee: 11.55, cutWrapPerLb: null, priceNotes: "" },
        { kind: "quail", capacityPerDay: null, killFee: 2.75, cutWrapPerLb: null, priceNotes: "" },
      ],
      note: "",
    });
    expect(out.rows.map((r) => r.killFee)).toEqual([10.55, 11.55, 2.75]);
    expect(out.rows.map((r) => r.kind)).toEqual(["duck", "goose", "quail"]);
  });
});
