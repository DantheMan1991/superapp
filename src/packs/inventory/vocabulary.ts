/**
 * Inventory vocabulary. NO IMPORTS AND NO DIRECTIVE, deliberately — client
 * components read this, and importing from `src/db/schema` would drag drizzle
 * into that bundle. Same reason `assets/vocabulary.ts` and
 * `land/vocabulary.ts` exist.
 */

/**
 * SUGGESTIONS, NOT A CONSTRAINT. `inventory_items.item_kind` is an open
 * taxonomy: the database checks the format and never the values.
 *
 * Ordered by how often a farm reaches for them, NOT alphabetically — `land`
 * paid for that lesson when sorting put `building_site` at the top of the use
 * picker and made it the default answer for a paddock.
 */
export const SUGGESTED_ITEM_KINDS = [
  "feed",
  "produce",
  "meat",
  "egg",
  "supply",
  "livestock",
  "seed",
  "medicine",
] as const;

/**
 * What a place has to be for the thing to keep. Open, because the walk-in that
 * holds eggs, aging beef and fresh product is not a cold freezer and somebody
 * will need a word for whatever they actually have.
 */
export const STORAGE_REQUIREMENTS = [
  "frozen",
  "refrigerated",
  "dry",
  "ambient",
] as const;

/** Where a lot came from. CLOSED — each behaves differently once cost arrives. */
export const LOT_SOURCES = ["purchased", "raised", "produced"] as const;
export type LotSource = (typeof LOT_SOURCES)[number];

export const LOT_SOURCE_LABELS: Record<LotSource, string> = {
  purchased: "Bought",
  raised: "Raised here",
  produced: "Made here",
};

export function isLotSource(value: string): value is LotSource {
  return (LOT_SOURCES as readonly string[]).includes(value);
}

/**
 * Movement kinds this pack writes itself. The column is an open taxonomy, so
 * `livestock` adds `death` and `placement` without a migration — these are only
 * the ones inventory's own screens produce.
 */
export const MOVEMENT_KINDS = [
  "receipt",
  "issue",
  "transfer_in",
  "transfer_out",
  "split_out",
  "split_in",
  "merge_out",
  "merge_in",
  "adjustment",
] as const;

export const MOVEMENT_KIND_LABELS: Record<string, string> = {
  receipt: "Received",
  issue: "Used",
  transfer_in: "Moved in",
  transfer_out: "Moved out",
  split_out: "Split out",
  split_in: "Split in",
  merge_out: "Merged out",
  merge_in: "Merged in",
  adjustment: "Adjusted",
  placement: "Placed",
  death: "Died",
};

export function movementKindLabel(kind: string): string {
  return MOVEMENT_KIND_LABELS[kind] ?? slugLabel(kind);
}

/**
 * **THE REASON AN ADJUSTMENT HAPPENED, and it is a diagnostic rather than a
 * correction.** The design's own line: *sustained feed shrinkage is not an
 * accounting problem, it is a rodent problem.*
 *
 * SUGGESTIONS, NOT A CONSTRAINT — `inventory_movements.reason` is an open
 * taxonomy and the database checks only the format. Ordered by how often a farm
 * reaches for them, NOT alphabetically, for the reason `land` paid for once:
 * sorting put `building_site` at the top of a picker and made it the default
 * answer for a paddock.
 *
 * Every one of these is industry-neutral on purpose. A bakery loses flour to
 * spillage and a workshop loses fasteners to breakage; neither needs its own
 * vocabulary, and a pack that shipped `rodent_damage` would be naming an
 * industry.
 */
export const SUGGESTED_ADJUSTMENT_REASONS = [
  "spoilage",
  "shrinkage",
  "damage",
  "found",
  "waste",
  "personal_use",
  "theft",
  "correction",
] as const;

export const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  spoilage: "Went off",
  shrinkage: "Shrinkage",
  damage: "Damaged",
  found: "Found",
  waste: "Thrown away",
  personal_use: "Taken for the house",
  theft: "Missing",
  correction: "Correcting an entry",
  count_variance: "Found by counting",
};

export const ADJUSTMENT_REASON_NOTES: Record<string, string> = {
  spoilage: "It went bad. Once is a wasted bag; every month is a freezer or a barn that is not keeping things.",
  shrinkage: "Gone, and nobody knows where. The reason worth watching: a pattern here is usually vermin, spillage or a leaking bin.",
  damage: "Broken, torn or spilled in handling.",
  found: "It was there and the record did not know. Arrives at no cost, because nobody paid for it.",
  waste: "Deliberately thrown away — past its date, or not fit to sell.",
  personal_use: "Taken out of the business for the household. Not a loss, but not a sale either.",
  theft: "Believed taken. Kept separate from shrinkage because one is a suspicion and the other is a gap.",
  correction: "An entry was wrong and this puts it right. Prefer counting, which records what is actually there.",
  count_variance: "The difference a physical count found between the record and the shelf.",
};

/**
 * **WHY A BATCH'S COST WAS RE-STATED.** ADR 0012 §A.4.
 *
 * A different list from `SUGGESTED_ADJUSTMENT_REASONS` on purpose, and the
 * difference is the whole point of the two tables: those reasons are about
 * QUANTITY — how much is actually there — and these are about MONEY, with the
 * quantity untouched. A bag that spoiled and a ticket that was mis-keyed are
 * not two flavours of the same event, and one picker offering both would invite
 * somebody to record a spoiled bag as a cost correction, which changes what the
 * stock is carried at and leaves the bag on the shelf.
 *
 * SUGGESTIONS, NOT A CONSTRAINT — the column checks the format and never the
 * values. Ordered by how often somebody reaches for them, not alphabetically.
 * Industry-neutral, like every other list here: a bakery is mis-invoiced for
 * flour the same way a farm is for feed.
 */
export const COST_ADJUSTMENT_REASONS = [
  "ticket_wrong",
  "freight_omitted",
  "no_price_on_ticket",
  "wrong_unit",
  "discount_applied",
  "correction",
] as const;

export const COST_ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  ticket_wrong: "The ticket was wrong",
  freight_omitted: "Freight was left out",
  no_price_on_ticket: "The ticket had no price",
  wrong_unit: "Priced in the wrong unit",
  discount_applied: "A discount came off",
  correction: "Correcting an entry",
};

export const COST_ADJUSTMENT_REASON_NOTES: Record<string, string> = {
  ticket_wrong:
    "The delivery ticket said one thing and the delivery cost another. Nothing about how much arrived changes.",
  freight_omitted:
    "The goods were entered and the carrier billed separately. This puts the carriage onto the batch it carried.",
  no_price_on_ticket:
    "It arrived with nothing on the paperwork, so it was recorded uncosted. This is what supplies the cost.",
  wrong_unit:
    "Entered per bag against a price per pound, or the other way round. The quantity is right; the money was not.",
  discount_applied:
    "The supplier took something off after the fact. Use a negative amount.",
  correction: "Something else was keyed wrong and this puts it right.",
};

export function costAdjustmentReasonLabel(reason: string): string {
  return COST_ADJUSTMENT_REASON_LABELS[reason] ?? slugLabel(reason);
}

/**
 * The reason a posted count writes. **Separate from `shrinkage` on purpose**: a
 * count variance means the record drifted, while shrinkage means stock actually
 * went missing, and one number covering both would hide each of them.
 */
export const COUNT_VARIANCE_REASON = "count_variance";

export function adjustmentReasonLabel(reason: string): string {
  return ADJUSTMENT_REASON_LABELS[reason] ?? slugLabel(reason);
}

/** A count is being walked, or it has been posted. CLOSED — there is no third state. */
export const COUNT_STATUSES = ["draft", "posted"] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

export const COUNT_STATUS_LABELS: Record<CountStatus, string> = {
  draft: "Being counted",
  posted: "Posted",
};

/** Mirrors the `_format` CHECKs. Kept in sync by tests/inventory.test.ts. */
export const SLUG_FORMAT = /^[a-z][a-z0-9_]{0,62}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_FORMAT.test(value);
}

/** "building_site" → "Building site". Slugs are for machines. */
export function slugLabel(slug: string): string {
  const spaced = slug.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * How a line of stock got its number, in words.
 *
 * **THE LABELS ARE LOAD-BEARING, not decoration.** One of these three is a
 * measurement, one is an average over a fungible item, and one is an admission
 * that nobody knows — and a reader looking at a balance sheet figure is entitled
 * to be told which. Flattening them to a single "Valued" column would put the
 * measured and the guessed-at side by side looking identical.
 */
export const VALUATION_METHOD_NOTES: Record<
  "carried" | "average" | "none",
  { label: string; note: string }
> = {
  carried: {
    label: "This batch",
    note: "What went into this batch and has not left it",
  },
  average: {
    label: "Average",
    note: "No batch, so the item's average of what came in priced",
  },
  none: {
    label: "No cost recorded",
    note: "Raised with no purchase price, and nothing entered against it",
  },
};

export const ITEM_STATUSES = ["active", "archived"] as const;
export const LOT_STATUSES = ["open", "closed"] as const;
