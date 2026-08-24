import "server-only";
import {
  callPaperworkModel,
  preparePaperwork,
  readNumber,
  readText,
  type PaperworkFile,
} from "./paperwork";
import { isPriceUnit, isValidSlug } from "../vocabulary";

/**
 * A photographed price list, read into proposed rows.
 *
 * **THE FOUNDER'S ASK, 2026-08-23**, and the second consumer of the path in
 * `paperwork.ts` rather than a second path. A plant sends a rate sheet once a
 * year; retyping it is the chore the *compute-and-commit* pattern exists for.
 *
 * **IT PROPOSES; IT NEVER RECORDS.** These rows are the terms of a commercial
 * relationship, and a fee changed by an extraction nobody read is worse than a
 * fee nobody typed, because it looks like it was agreed. A person confirms and
 * `setHandle` / `setPriceItem` write — with the same audit entries, carrying
 * the quoted price, that they write when somebody types them.
 *
 * ── WHAT CHANGED WHEN THE MENU GOT A TABLE ──────────────────────────────────
 *
 * The first version had three fee slots and a rule that a MENU IS NOT A RATE:
 * twelve chicken cutting options at nine prices had no single cutting fee, so
 * both cutting slots were left null and the figures went into prose. That
 * refusal was correct and it threw away most of a rate sheet.
 *
 * **THE RULE HAS NOT CHANGED; THE SHAPE HAS.** Every priced line is now its own
 * row with its own UNIT, so quartered $1.05 and eight-piece $1.25 are two rows
 * and nothing has to pick between them — picking is the farm's job on an order,
 * not the reader's job on a sheet. What survives unchanged is the refusal
 * underneath it: **a range is still not a price**, and $0.65–$0.90 a pound
 * comes back null with the range in the note, because averaging it would invent
 * a figure the plant never quoted.
 *
 * ── AND RULE 5 WENT HALF WRONG, WHICH IS WORTH KNOWING ──────────────────────
 *
 * It said a matrix of prices is a matrix of items and *the label must say what
 * tells them apart*: `Slaughter, Cornish Cross, 25-49 birds`. The first half
 * still holds — it is still one item per cell. The second half made the app
 * unable to read its own data: a batch of 800 birds cannot be compared against
 * words, so the farm was handed 24 siblings and told to find the right one.
 *
 * **WHAT TELLS THEM APART IS NOW FIELDS: `variant`, `headMin`, `headMax`** —
 * asked for in the tool schema rather than parsed back out of a label
 * afterwards, because a regex over a plant's own prose is a second reader with
 * none of the first one's judgement. The label is what is being charged for and
 * is the same across the whole matrix.
 */

/**
 * **THE KINDS ARE PASSED IN, NOT KNOWN.** This pack has no list of species and
 * must not acquire one; the profile's `processorHandles` is the vocabulary, and
 * the prompt is told to map onto it rather than to invent its own words. A rate
 * sheet saying "hogs" against a profile that says `swine` should come back as
 * `swine`, and one saying "bison" against a profile that has never heard of one
 * should come back with the kind left empty for a person to decide.
 */
function systemPrompt(kinds: string[]): string {
  const vocabulary =
    kinds.length > 0
      ? `This farm's own words for the animals are: ${kinds.join(", ")}. Map what the sheet says onto one of these where it plainly means the same thing — "hogs" and "pigs" are swine, "beef" and "cattle" and "steers" are cattle, "lambs" are sheep.

ALWAYS PICK THE MOST SPECIFIC WORD THE LIST OFFERS. If the list has both a general one and a particular one — "poultry" as well as "chicken", "turkey", "duck", "goose", "quail" — and the sheet is talking about a particular bird, use the particular one. "Broilers", "fryers" and "roasters" are chicken. Only use a general word when the sheet itself is being general, and only leave kind empty when the charge genuinely is not about an animal at all — a delivery fee, a container, a disposal charge.

IF ONE LINE ON THE SHEET COVERS SEVERAL ANIMALS, REPEAT IT ONCE PER ANIMAL. "Duck & Geese: Quartered $1.05 per bird" is TWO items, identical except that one says duck and the other says goose. Do not invent a combined word and do not put the animals in the label — the label is what they charge for, the kind is which animal, and a farm looking at its chickens must not have to read past its ducks.`
      : `This farm has not listed its animals, so put the sheet's own word in kind, lowercased, with underscores instead of spaces.`;

  return `You are reading a meat processor's price list so a farmer does not have to retype it into their records. Fill in the tool with what the page actually says.

${vocabulary}

WHAT A PRICE LIST IS. It is what a plant charges, usually as a slaughter fee plus a menu of cutting, packaging and extra options. Sheets also carry minimums, capacities, and advice about booking.

THERE ARE TWO LISTS TO FILL IN, AND THEY ARE DIFFERENT THINGS.

- ITEMS are the prices. One row per priced thing on the sheet. This is where nearly everything goes.
- ANIMALS is one row per kind of animal the sheet shows the plant will take, carrying only their daily capacity if the sheet states one, and any prose about that animal that is not a price — booking advice, seasonal notes, conditions.

RULES, IN ORDER OF IMPORTANCE.

1. LEAVE OUT WHAT YOU CANNOT READ, and leave out what is not there. Null beats a guess every time: a farmer seeing an empty price types it in, a farmer seeing a confident wrong price agrees to it. An item with a label and no price is still worth recording — the farmer will ring them.

2. NEVER CALCULATE, CONVERT OR AVERAGE. Do not turn a per-quarter price into a per-pound one, do not average a range, do not add a minimum into a price. If a sheet gives a range like "$0.65-$0.90 per lb", the price is null, the unit is still per pound, and the range goes in that item's note. A range is not a price.

3. EVERY PRICE CARRIES A UNIT, AND THE UNIT IS THE MOST IMPORTANT FIELD ON THE ROW. $1.05 is a completely different amount of money depending on which it is. The units are:
   - head — per bird, per animal
   - live_lb — per pound of live weight, before slaughter
   - hanging_lb — per pound of hanging or carcass weight. What red-meat plants quote cutting against
   - finished_lb — per pound of the finished, packaged product
   - package — per package, pack or vacuum bag
   - box — per box
   - flat — charged once for the whole drop-off, whatever went
   - hour — per hour of labour
   Use the unit the sheet states. If the sheet does not state one, DO NOT INFER IT FROM THE SIZE OF THE NUMBER — leave the whole item out and describe it in the note instead.

4. A MENU IS A LIST OF ITEMS, NOT ONE PRICE. Quartered $1.05, eight-piece $1.25, deboned $1.30 is three items, each with its own label and price. Never pick one of them, never average them, and never fold them into a single cutting fee.

5. IF THE SHEET PRICES THE SAME THING SEVERAL WAYS — by breed, by batch size, by weight band — each priced cell is STILL its own item, and what tells the cells apart goes in the FIELDS, not in the label. A matrix of prices is a matrix of items.
   - variant is the qualifier: the breed, the grade, whatever the column of the table is headed with. "Cornish Cross", "Freedom Ranger", "Heritage", "Boneless". The plant's own words. Empty when the sheet does not distinguish.
   - headMin and headMax are the batch size the price applies to, in head. "25-49 birds" is headMin 25 and headMax 49. "1-24" is headMin 1 and headMax 24. "Over 1500" is headMin 1501 and headMax null. A price that applies whatever the batch size has headMin null and headMax null.
   - The label stays the same across the whole matrix, because it is the same thing being charged for: all 24 cells of a 4-breed by 6-batch-size slaughter grid have the label "Slaughter".
   DO NOT put the breed or the batch size in the label as well, and DO NOT REPEAT THEM IN THE NOTE. It is being read by an app that looks the price up and then prints the band itself: a batch of 800 Cornish Cross has to find exactly one row, words in a label cannot be compared against a number of birds, and a note saying "over 1500" under a row already reading "1501 head and over" is the same thing said twice. A note is for what the fields cannot hold — a season, a condition, a qualification. Only do this where the sheet gives a definite price per cell; a range is still rule 2.

6. THE LABEL IS THE PLANT'S OWN WORDS for what is being charged for, short enough to read in a list. Do not translate it, do not tidy it, do not invent a category name for it. LEAVE THE ANIMAL OUT OF IT — "Duck & Geese: Quartered" is a label of "Quartered" on a duck item and a goose item. Leave the breed and the batch size out of it too — those are rule 5's fields.

7. CATEGORY GROUPS THE SHEET the way the paper does: slaughter, cutting, packaging, giblets, extra. Use one of those five where it fits and "extra" where nothing does.

8. AMOUNTS ARE IN DOLLARS, as decimals — 95 for $95.00, 0.9 for 90 cents. Never cents, never strings with symbols.

9. A MINIMUM IS A FLOOR, NOT A PRICE. "$0.65 per lb, $10 minimum" is one item priced at 0.65 per live_lb with a minimum of 10. Do not make it two items and do not put the 10 in the price.

If the page is not a price list at all, return nothing in either list and say so in the note.`;
}

const TOOL = {
  name: "record_price_list",
  description:
    "Report the prices written on a processor's price list, and nothing that is not written on it.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        description: "One entry per priced thing on the sheet.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              description:
                "The farm's own word for the animal this price is for, lowercase with underscores. The MOST SPECIFIC word the farm's list offers. A line covering several animals is repeated once per animal. Empty only when the charge is genuinely not about an animal.",
            },
            category: {
              type: "string",
              description:
                "One of: slaughter, cutting, packaging, giblets, extra.",
            },
            label: {
              type: "string",
              description:
                "What is being charged for, in the plant's own words. NOT the breed and NOT the batch size — those are variant, headMin and headMax. Every cell of one matrix shares one label.",
            },
            variant: {
              type: "string",
              description:
                "The qualifier that tells this priced cell apart from its siblings — the breed, the grade, whatever heads the column. The plant's own words. Empty when the sheet does not price the same thing several ways.",
            },
            headMin: {
              type: ["integer", "null"],
              description:
                "The smallest batch, in head, this price applies to. 25 for \"25-49 birds\", 1501 for \"over 1500\". Null when the price does not depend on batch size.",
            },
            headMax: {
              type: ["integer", "null"],
              description:
                "The largest batch, in head, this price applies to, inclusive. 49 for \"25-49 birds\". Null for the top band and for a price that does not depend on batch size.",
            },
            price: {
              type: ["number", "null"],
              description:
                "The price for ONE unit, in dollars. Null if the sheet gives a range, says to ring, or cannot be read.",
            },
            unit: {
              type: "string",
              enum: [
                "head",
                "live_lb",
                "hanging_lb",
                "finished_lb",
                "package",
                "box",
                "flat",
                "hour",
              ],
              description:
                "What the price is per, exactly as the sheet states it. Never inferred from the size of the number.",
            },
            minimum: {
              type: ["number", "null"],
              description:
                "The floor in dollars, if the sheet states one for this item. Not a price.",
            },
            notes: {
              type: "string",
              description:
                "Conditions on this one price that the other fields cannot hold — a range, a season, a qualification. NOT the batch size and NOT the variant, which have fields of their own and are printed from them.",
            },
          },
          required: [
            "kind",
            "category",
            "label",
            "variant",
            "headMin",
            "headMax",
            "price",
            "unit",
            "minimum",
            "notes",
          ],
        },
      },
      animals: {
        type: "array",
        description:
          "One entry per kind of animal the sheet shows they will take. NO PRICES — those are items.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              description:
                "The farm's own word for this animal, lowercase with underscores.",
            },
            capacityPerDay: {
              type: ["integer", "null"],
              description:
                "Head they can take in a day, if the sheet says. Usually it does not.",
            },
            priceNotes: {
              type: "string",
              description:
                "Prose about this animal that is not a price: booking advice, seasons, conditions.",
            },
          },
          required: ["kind", "capacityPerDay", "priceNotes"],
        },
      },
      note: {
        type: "string",
        description:
          "Anything a person should know before accepting this — what was unreadable or ambiguous, what was left out for want of a unit, or that the page is not a price list.",
      },
    },
    required: ["items", "animals", "note"],
  },
} as const;

/** A priced line, as proposed. Dollars — the action converts to cents. */
export interface ProposedPriceItem {
  kind: string;
  category: string;
  label: string;
  /** The breed or qualifier, in the plant's own words. Empty when unbanded. */
  variant: string;
  /** The band's floor, in head. Null is "from the first". */
  headMin: number | null;
  /** The band's ceiling, in head, inclusive. Null is "no ceiling". */
  headMax: number | null;
  price: number | null;
  unit: string;
  minimum: number | null;
  notes: string;
}

/** What they take, as proposed. Carries no price — see the header. */
export interface ProposedHandle {
  kind: string;
  capacityPerDay: number | null;
  priceNotes: string;
}

export interface PriceListProposal {
  items: ProposedPriceItem[];
  animals: ProposedHandle[];
  note: string;
}

/**
 * Never throws on shape — a malformed answer is zero rows and a note, and the
 * screen falls back to typing it in.
 *
 * **A KIND THAT IS NOT A VALID SLUG BECOMES EMPTY RATHER THAN THE ROW BEING
 * DROPPED.** The row still carries a price somebody may want, and the form makes
 * them say what it is for. Dropping it would silently lose a price off the
 * sheet, which is the failure this whole feature exists to prevent.
 *
 * **AN ITEM WITH NO USABLE UNIT IS THE ONE THING THAT IS DROPPED**, and it is
 * the exception that proves the rule above. A price with no unit is not a
 * price — `1.05` with nothing saying whether it is a bird or a pound is the
 * exact ambiguity this table was built to end, and a form cannot ask a person to
 * supply a unit they would have to guess at either. The prompt is told to
 * describe such a line in the note instead, so it is reported rather than
 * silently gone. An item with no LABEL goes the same way and for the same
 * reason: a price for something unnamed cannot be checked against the paper.
 */
export function validatePriceList(raw: unknown): PriceListProposal {
  if (!raw || typeof raw !== "object") {
    return { items: [], animals: [], note: "" };
  }
  const source = raw as Record<string, unknown>;

  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items: ProposedPriceItem[] = [];
  for (const entry of rawItems.slice(0, 200)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const unit = readText(row.unit, 63).toLowerCase();
    if (!isPriceUnit(unit)) continue;
    const label = readText(row.label, 200);
    if (!label) continue;
    const kindRaw = readText(row.kind, 63).toLowerCase().replace(/\s+/g, "_");
    const categoryRaw = readText(row.category, 63)
      .toLowerCase()
      .replace(/\s+/g, "_");
    /**
     * **A BAND THAT ENDS BEFORE IT BEGINS IS DROPPED BACK TO NO BAND**, rather
     * than the row being lost. `25-19` is a misread of `25-49` and the price on
     * it is still worth putting in front of somebody; a row nothing can ever
     * resolve to would sit on the list looking like a price and behaving like a
     * hole in the ladder. The form makes them supply it.
     */
    const headMin = readNumber(row.headMin, {
      min: 0,
      max: 1_000_000,
      integer: true,
    });
    const headMaxRaw = readNumber(row.headMax, {
      min: 0,
      max: 1_000_000,
      integer: true,
    });
    const headMax =
      headMaxRaw !== null && headMin !== null && headMaxRaw < headMin
        ? null
        : headMaxRaw;
    items.push({
      kind: isValidSlug(kindRaw) ? kindRaw : "",
      category: isValidSlug(categoryRaw) ? categoryRaw : "extra",
      label,
      // Free text and the plant's own words, so nothing is validated beyond a
      // length — a variant is not a slug and this pack does not know what a
      // breed is.
      variant: readText(row.variant, 100),
      headMin,
      headMax,
      // Money, in dollars, and never negative. A plant does not pay you.
      price: readNumber(row.price, { min: 0, max: 1_000_000 }),
      unit,
      minimum: readNumber(row.minimum, { min: 0, max: 1_000_000 }),
      notes: readText(row.notes, 2000),
    });
  }

  const rawAnimals = Array.isArray(source.animals) ? source.animals : [];
  const animals: ProposedHandle[] = [];
  for (const entry of rawAnimals.slice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const kindRaw = readText(row.kind, 63).toLowerCase().replace(/\s+/g, "_");
    animals.push({
      kind: isValidSlug(kindRaw) ? kindRaw : "",
      capacityPerDay: readNumber(row.capacityPerDay, {
        min: 1,
        max: 1_000_000,
        integer: true,
      }),
      priceNotes: readText(row.priceNotes, 2000),
    });
  }

  return { items, animals, note: readText(source.note, 2000) };
}

export async function readPriceList(
  file: PaperworkFile,
  kinds: string[],
  callModel = callPaperworkModel,
): Promise<PriceListProposal> {
  const payload = await preparePaperwork(file);
  const raw = await callModel(payload, systemPrompt(kinds), TOOL as never);
  return validatePriceList(raw);
}
