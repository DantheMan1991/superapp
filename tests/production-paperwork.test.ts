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
  const item = (over: Record<string, unknown> = {}) => ({
    kind: "cattle",
    category: "slaughter",
    label: "Slaughter",
    price: null,
    unit: "head",
    minimum: null,
    notes: "",
    ...over,
  });

  it("takes a well-formed sheet through unchanged", () => {
    const out = validatePriceList({
      items: [item({ price: 105 })],
      animals: [{ kind: "cattle", capacityPerDay: 8, priceNotes: "" }],
      note: "",
    });
    expect(out.items[0]).toMatchObject({
      kind: "cattle",
      category: "slaughter",
      label: "Slaughter",
      price: 105,
      unit: "head",
    });
    expect(out.animals[0]).toMatchObject({ kind: "cattle", capacityPerDay: 8 });
  });

  it("KEEPS AN ITEM WHOSE KIND IT COULD NOT PLACE, with the kind emptied", () => {
    // Dropping it would silently lose a price off the sheet, which is the exact
    // failure this feature exists to prevent. The price is still worth having;
    // the form makes somebody say what it is for.
    const out = validatePriceList({
      items: [item({ kind: "Bison (whole)", price: 250 })],
      animals: [],
      note: "",
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].kind).toBe("");
    expect(out.items[0].price).toBe(250);
  });

  it("normalises a kind the way the slug rule does", () => {
    const kindOf = (kind: string) =>
      validatePriceList({ items: [item({ kind })], animals: [] }).items[0].kind;
    expect(kindOf("Cattle")).toBe("cattle");
    expect(kindOf("dairy cow")).toBe("dairy_cow");
  });

  it("DROPS AN ITEM WITH NO USABLE UNIT, because a price without one is not a price", () => {
    // The one thing that IS dropped, and the exception that proves the rule
    // above. `1.05` with nothing saying whether it is a bird or a pound is the
    // exact ambiguity this table exists to end, and a form cannot ask somebody
    // to supply a unit they would have to guess at either.
    const out = validatePriceList({
      items: [item({ unit: "each", price: 1.05 }), item({ price: 95 })],
      animals: [],
      note: "",
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].price).toBe(95);
  });

  it("drops an item with no label, because a price for something unnamed cannot be checked", () => {
    const out = validatePriceList({
      items: [item({ label: "   ", price: 95 })],
      animals: [],
      note: "",
    });
    expect(out.items).toEqual([]);
  });

  it("falls back to `extra` for a category it does not recognise", () => {
    // The category is an open taxonomy and only has to be a slug. Anything
    // that is not becomes the bucket that means nothing else fitted, rather
    // than dropping a priced line over how the sheet grouped it.
    const out = validatePriceList({
      items: [item({ category: "Smoke House!" })],
      animals: [],
    });
    expect(out.items[0].category).toBe("extra");
  });

  it("refuses a negative price — a plant does not pay you", () => {
    const out = validatePriceList({
      items: [item({ price: -95, minimum: -1 })],
      animals: [],
      note: "",
    });
    expect(out.items[0].price).toBeNull();
    expect(out.items[0].minimum).toBeNull();
  });

  it("keeps a genuine zero, which is not the same as unquoted", () => {
    // A waived fee is a real thing a sheet can say. Only NULL means nobody
    // quoted one.
    const out = validatePriceList({
      items: [item({ price: 0 })],
      animals: [],
      note: "",
    });
    expect(out.items[0].price).toBe(0);
  });

  it("survives every shape of nonsense without throwing", () => {
    for (const junk of [null, undefined, "", 42, [], { items: "no" }]) {
      expect(validatePriceList(junk).items).toEqual([]);
      expect(validatePriceList(junk).animals).toEqual([]);
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
 * plant sheet, was run through the live extractor. These pin the shapes it
 * contains that a naive reader gets WRONG.
 *
 * **TWO OF THEM CHANGED ANSWER WHEN THE MENU GOT A TABLE, AND ONE DID NOT** —
 * which is the distinction worth keeping a test for. A MENU is now a list of
 * items, because each option has its own price and its own unit. A RANGE is
 * still nothing at all, because $0.65-$0.90 names no figure the plant would
 * stand behind, and averaging it would invent one.
 */
describe("what a real rate sheet contains", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    kind: "chicken",
    category: "cutting",
    label: "Quartered",
    price: null,
    unit: "head",
    minimum: null,
    notes: "",
    ...over,
  });

  it("TAKES A MENU AS A LIST OF ITEMS, which it could not do before", () => {
    // Pleasant Valley lists twelve chicken cutting options at nine prices. The
    // old shape had one cutting column, so the only honest answer was to
    // refuse all twelve and leave them as prose nothing could select. Each is
    // now its own row with its own price, and nothing has to pick between
    // them — picking is the farm's job on an order.
    const out = validatePriceList({
      items: [
        item({ label: "Quartered", price: 1.05 }),
        item({ label: "8 Pcs Cut", price: 1.25 }),
        item({ label: "Deboning Thighs", price: 0.65 }),
      ],
      animals: [],
      note: "",
    });
    expect(out.items.map((r) => r.label)).toEqual([
      "Quartered",
      "8 Pcs Cut",
      "Deboning Thighs",
    ]);
    expect(out.items.map((r) => r.price)).toEqual([1.05, 1.25, 0.65]);
    // All per BIRD, which is how poultry plants quote cutting and the reason a
    // single per-pound column could never have held them.
    expect(out.items.every((r) => r.unit === "head")).toBe(true);
  });

  it("TAKES A PRICE MATRIX AS A MATRIX OF ITEMS", () => {
    // The chicken slaughter fee is a 4-breed x 6-batch-band grid — 24 prices.
    // The old shape returned null and put the whole grid in a note, because any
    // one of the 24 is wrong for the other 23. Each cell now has a label that
    // says which cell it is.
    const out = validatePriceList({
      items: [
        item({
          category: "slaughter",
          label: "Slaughter, Cornish Cross, 50-100 birds",
          price: 3.75,
        }),
        item({
          category: "slaughter",
          label: "Slaughter, Cornish Cross, 101-250 birds",
          price: 3.15,
        }),
      ],
      animals: [],
      note: "",
    });
    expect(out.items.map((r) => r.price)).toEqual([3.75, 3.15]);
    expect(out.items[0].label).toContain("50-100");
  });

  it("STILL REFUSES A RANGE, which is not a price however it is itemised", () => {
    // Turkey slaughter on that sheet is $0.65-$0.90 PER POUND with a $10
    // minimum. The unit is now expressible and the minimum has a column — but
    // the price itself is still null, because the sheet names no figure and
    // averaging the two ends would invent one the plant never quoted.
    const out = validatePriceList({
      items: [
        item({
          kind: "turkey",
          category: "slaughter",
          label: "Slaughter",
          price: null,
          unit: "live_lb",
          minimum: 10,
          notes: "$0.65 to $0.90 per lb depending on weight",
        }),
      ],
      animals: [],
      note: "",
    });
    expect(out.items[0].price).toBeNull();
    expect(out.items[0].unit).toBe("live_lb");
    expect(out.items[0].minimum).toBe(10);
    expect(out.items[0].notes).toContain("$0.65 to $0.90");
  });

  it("takes the flat per-bird fees exactly as printed", () => {
    // Ducks, geese and quail ARE flat per head, and the live run returned all
    // three to the cent.
    const out = validatePriceList({
      items: [
        item({ kind: "duck", category: "slaughter", label: "Slaughter", price: 10.55 }),
        item({ kind: "goose", category: "slaughter", label: "Slaughter", price: 11.55 }),
        item({ kind: "quail", category: "slaughter", label: "Slaughter", price: 2.75 }),
      ],
      animals: [],
      note: "",
    });
    expect(out.items.map((r) => r.price)).toEqual([10.55, 11.55, 2.75]);
    expect(out.items.map((r) => r.kind)).toEqual(["duck", "goose", "quail"]);
  });

  it("keeps the two cutting units apart, which is what the unit column is for", () => {
    // Red meat is cut by the pound of hanging weight; poultry is cut by the
    // bird. $1.05 means completely different money depending on which, and the
    // unit now travels with the figure instead of being implied by a column
    // name.
    const out = validatePriceList({
      items: [
        item({ kind: "cattle", label: "Cut and wrap", price: 0.9, unit: "hanging_lb" }),
        item({ kind: "chicken", label: "Quartered", price: 1.05, unit: "head" }),
      ],
      animals: [],
      note: "",
    });
    expect(out.items[0]).toMatchObject({ price: 0.9, unit: "hanging_lb" });
    expect(out.items[1]).toMatchObject({ price: 1.05, unit: "head" });
  });

  it("lets one plant charge per pound AND a flat fee per animal", () => {
    // The arrangement most plants actually quote, and the reason a smaller
    // animal costs more per pound at the same plant: the flat half spreads over
    // less meat. Two items, no rule against either.
    const out = validatePriceList({
      items: [
        item({ kind: "swine", category: "slaughter", label: "Slaughter", price: 65, unit: "head" }),
        item({ kind: "swine", category: "cutting", label: "Cut and wrap", price: 0.85, unit: "hanging_lb" }),
      ],
      animals: [],
      note: "",
    });
    expect(out.items.map((r) => r.unit)).toEqual(["head", "hanging_lb"]);
  });

  it("keeps prose that is not a price on the ANIMAL, not on an item", () => {
    // The sheet's advice about booking ducks and geese by age is not a charge
    // and has no unit. It belongs to the animal, where it stays true when the
    // prices change.
    const out = validatePriceList({
      items: [],
      animals: [
        {
          kind: "goose",
          capacityPerDay: null,
          priceNotes: "Book by age, not by weight",
        },
      ],
      note: "",
    });
    expect(out.animals[0].priceNotes).toContain("Book by age");
  });
});
