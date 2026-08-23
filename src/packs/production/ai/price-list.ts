import "server-only";
import {
  callPaperworkModel,
  preparePaperwork,
  readNumber,
  readText,
  type PaperworkFile,
} from "./paperwork";
import { isValidSlug } from "../vocabulary";

/**
 * A photographed price list, read into proposed `handles` rows.
 *
 * **THE FOUNDER'S ASK, 2026-08-23**, and the second consumer of the path in
 * `paperwork.ts` rather than a second path. A plant sends a rate sheet once a
 * year; retyping it into six columns is the chore the *compute-and-commit*
 * pattern exists for.
 *
 * **IT PROPOSES; IT NEVER RECORDS.** These rows are the terms of a commercial
 * relationship, and a fee changed by an extraction nobody read is worse than a
 * fee nobody typed, because it looks like it was agreed. A person confirms and
 * `setHandle` writes — with the same audit entry, carrying the quoted price,
 * that it writes when somebody types it.
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
      ? `This farm's own words for the animals are: ${kinds.join(", ")}. Map what the sheet says onto one of these where it plainly means the same thing — "hogs" and "pigs" are swine, "beef" and "cattle" and "steers" are cattle, "chickens" and "broilers" are poultry, "lambs" are sheep. If a row is about something not in that list, leave kind empty.`
      : `This farm has not listed its animals, so put the sheet's own word in kind, lowercased, with underscores instead of spaces.`;

  return `You are reading a meat processor's price list so a farmer does not have to retype it into their records. Fill in the tool with what the page actually says.

${vocabulary}

WHAT A PRICE LIST IS. It is what a plant charges. The two figures that matter are the SLAUGHTER FEE, charged per head, and CUT AND WRAP, charged per pound of hanging weight. Sheets also carry minimums, extras (smoking, sausage-making, vacuum packing), and sometimes a daily capacity.

RULES, IN ORDER OF IMPORTANCE.

1. LEAVE OUT WHAT YOU CANNOT READ, and leave out what is not there. Null beats a guess every time: a farmer seeing an empty fee types it in, a farmer seeing a confident wrong fee agrees to it. A row with only a kill fee is a perfectly good row.

2. NEVER CALCULATE, CONVERT OR AVERAGE. Do not turn a per-quarter price into a per-pound one, do not average a range, do not add a minimum into a fee. If a sheet gives a range like "$95-$120", report null and put the range in the price note.

3. THERE ARE THREE FEE SLOTS AND THEY ARE NOT INTERCHANGEABLE. killFee is SLAUGHTER, per head. cutWrapPerLb is CUTTING, per pound of hanging weight. cutFeePerHead is CUTTING, per bird or per animal. Red-meat plants quote cutting per pound; poultry plants quote it per bird. Put a cutting rate in whichever slot matches the unit the sheet states, and if the sheet does not state a unit, leave it null — do not infer one from the size of the number.

4. A MENU IS NOT A RATE. If a sheet lists several cutting options at different prices — quartered $1.05, eight-piece $1.25, deboned $1.30 — there is no single cutting fee, so leave BOTH cutting slots null and put the menu in the price note. Only fill a cutting slot when the sheet names one price for cutting that animal.

5. ONE ROW PER ANIMAL. If a sheet prices beef, pork and lamb, that is three rows. If it gives one price for everything, that is one row with kind empty.

6. AMOUNTS ARE IN DOLLARS, as decimals — 95 for $95.00, 0.9 for 90 cents. Never cents, never strings with symbols.

7. PUT EVERYTHING ELSE IN THE PRICE NOTE, in the sheet's own words: minimums, extras, surcharges, disposal fees, deposit terms. Do not try to model them.

If the page is not a price list at all, return no rows and say so in the note.`;
}

const TOOL = {
  name: "record_price_list",
  description:
    "Report the rates written on a processor's price list, and nothing that is not written on it.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        description: "One entry per kind of animal priced on the sheet.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              description:
                "The farm's own word for this animal, lowercase with underscores. Empty when the sheet's subject is not one of them.",
            },
            capacityPerDay: {
              type: ["integer", "null"],
              description:
                "Head they can take in a day, if the sheet says. Usually it does not.",
            },
            killFee: {
              type: ["number", "null"],
              description:
                "Slaughter fee PER HEAD, in dollars. Null if not given or ambiguous.",
            },
            cutWrapPerLb: {
              type: ["number", "null"],
              description:
                "Cutting PER POUND of hanging weight, in dollars. How red-meat plants quote. Null if not given, ambiguous, or if the sheet lists a menu of cutting options rather than one price.",
            },
            cutFeePerHead: {
              type: ["number", "null"],
              description:
                "Cutting PER BIRD or per animal, in dollars. How poultry plants quote. Null if not given, ambiguous, or if the sheet lists a menu of cutting options rather than one price.",
            },
            priceNotes: {
              type: "string",
              description:
                "Minimums, extras and surcharges for this animal, in the sheet's own words.",
            },
          },
          required: [
            "kind",
            "capacityPerDay",
            "killFee",
            "cutWrapPerLb",
            "cutFeePerHead",
            "priceNotes",
          ],
        },
      },
      note: {
        type: "string",
        description:
          "Anything a person should know before accepting this — what was unreadable or ambiguous, or that the page is not a price list.",
      },
    },
    required: ["rows", "note"],
  },
} as const;

export interface ProposedHandle {
  kind: string;
  capacityPerDay: number | null;
  killFee: number | null;
  cutWrapPerLb: number | null;
  cutFeePerHead: number | null;
  priceNotes: string;
}

export interface PriceListProposal {
  rows: ProposedHandle[];
  note: string;
}

/**
 * Never throws on shape — a malformed answer is zero rows and a note, and the
 * screen falls back to typing it in.
 *
 * **A KIND THAT IS NOT A VALID SLUG BECOMES EMPTY RATHER THAN BEING DROPPED.**
 * The row still carries a fee somebody may want, and the form makes them pick
 * what it is for. Dropping it would silently lose a price off the sheet, which
 * is the failure this whole feature exists to prevent.
 */
export function validatePriceList(raw: unknown): PriceListProposal {
  if (!raw || typeof raw !== "object") return { rows: [], note: "" };
  const source = raw as Record<string, unknown>;
  const rawRows = Array.isArray(source.rows) ? source.rows : [];

  const rows: ProposedHandle[] = [];
  for (const entry of rawRows.slice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const kindRaw = readText(row.kind, 63).toLowerCase().replace(/\s+/g, "_");
    rows.push({
      kind: isValidSlug(kindRaw) ? kindRaw : "",
      capacityPerDay: readNumber(row.capacityPerDay, {
        min: 1,
        max: 1_000_000,
        integer: true,
      }),
      // Money, in dollars, and never negative. A plant does not pay you.
      killFee: readNumber(row.killFee, { min: 0, max: 1_000_000 }),
      cutWrapPerLb: readNumber(row.cutWrapPerLb, { min: 0, max: 1_000_000 }),
      cutFeePerHead: readNumber(row.cutFeePerHead, { min: 0, max: 1_000_000 }),
      priceNotes: readText(row.priceNotes, 2000),
    });
  }
  return { rows, note: readText(source.note, 2000) };
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
