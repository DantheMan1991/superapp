/**
 * The lookup the app should have been doing. PURE — no imports, no database.
 *
 * **24 ROWS, ONE RIGHT ANSWER, AND THE APP MADE YOU FIND IT.** One real chicken
 * rate sheet prices slaughter as a 4-breed × 6-batch-band grid: 24 cells, all
 * labelled some variation of "Slaughter", and for any given batch exactly one of
 * them is the price. Slice 2a modelled that as a menu, and *a menu is not a
 * rate* was the right call for cutting options and the wrong one for a grid —
 * quartered against eight-piece is a choice somebody makes, and 800 birds of
 * Cornish Cross against 50 is not a choice at all. It is a table, and a table is
 * something a computer reads.
 *
 * **SO THE BREED AND THE BATCH SIZE CAME OUT OF THE LABEL AND BECAME FIELDS.**
 * That is the whole change: `variant` and `[head_min, head_max]` on the price
 * item, and this file resolving them. What is left in the label is what the
 * plant charges for.
 *
 * ── WHAT THIS FILE WILL NOT DO ──────────────────────────────────────────────
 *
 * **IT NEVER FALLS BACK TO THE NEAREST BAND.** A batch no band covers is not an
 * edge case, it is printed on the sheet this was modelled from: *"if you show up
 * with less than 50 chickens, we do not offer cutting, whole birds only."* The
 * nearest band would quote a price the plant has explicitly said it will not
 * offer, at the moment somebody is deciding whether the trip is worth making.
 * It is reported.
 *
 * **AND OVERLAPPING BANDS ARE A DIFFERENT FAILURE, REPORTED DIFFERENTLY.** Two
 * bands covering one batch size is the SHEET being ambiguous — or a row typed
 * wrong — and picking between them would hide a transcription error behind a
 * confident figure. The unique index stops two rows starting at the same head;
 * it cannot stop `50–200` sitting over `101–250`, because those are two
 * different starting points and Postgres has no way to say they collide.
 *
 * **THE BAND IS RESOLVED WHEN THE LINE IS WRITTEN, NOT WHEN THE FEE IS
 * COMPUTED.** `core/fee.ts` never sees any of this. The order line already
 * snapshots `unit_price_cents`, and the band only decides WHICH price gets
 * snapshotted — putting the lookup in the fee would make a rate change move last
 * October's sheet, which is the one thing the snapshot exists to prevent.
 */

/** One priced row, as the resolver needs to see it. */
export interface BandedItem {
  id: string;
  kind: string;
  category: string;
  label: string;
  /** The plant's own qualifier — a breed, usually. Empty means "however they come". */
  variant: string;
  /** The first head this price covers. Nought is "from the first". */
  headMin: number;
  /** The last, inclusive. Null is no ceiling. */
  headMax: number | null;
  priceCents: number | null;
  unit: string;
  minimumCents: number | null;
}

export type BandRefusal = "NO_HEAD_COUNT" | "NO_BAND_COVERS" | "BANDS_OVERLAP";

/**
 * What the screen says instead of a price. Sentences, because each of these is
 * read by somebody who expected the app to have worked it out.
 */
export const BAND_REFUSALS: Record<BandRefusal, string> = {
  NO_HEAD_COUNT:
    "This sheet does not say how many head it covers, so nothing can pick which batch-size price applies. Put the count on the sheet, or choose the band yourself.",
  NO_BAND_COVERS:
    "No band on their sheet covers a batch this size. That is usually the plant saying it will not take one — the smallest bands have a floor under them — so it is reported rather than rounded to the nearest price they did quote.",
  BANDS_OVERLAP:
    "Two of their bands cover a batch this size, so there are two prices and nothing to say which. One of the rows was read or typed wrong; correcting it is the fix, and guessing would hide it.",
};

/** Is this row banded at all, or does it cover every batch? */
export function isBanded(item: BandedItem): boolean {
  return item.headMin > 0 || item.headMax !== null;
}

/** Does this row's band cover a batch of `head`? */
export function bandCovers(item: BandedItem, head: number): boolean {
  if (head < item.headMin) return false;
  return item.headMax === null || head <= item.headMax;
}

/**
 * "50 to 100 head", "1501 head and over", "Up to 49 head", or empty when the row
 * is not banded.
 *
 * **THE TOP BAND READS FROM ITS FLOOR AND NOT FROM THE ONE BELOW IT.** A sheet
 * says "Over 1500"; the row that means is the one starting at 1501, and printing
 * "over 1500" would be this app restating a boundary it would have to infer from
 * a neighbouring row that may not exist.
 */
export function describeBand(item: BandedItem): string {
  if (!isBanded(item)) return "";
  if (item.headMax === null) return `${item.headMin} head and over`;
  if (item.headMin === 0) return `up to ${item.headMax} head`;
  return `${item.headMin} to ${item.headMax} head`;
}

/**
 * What one order line SAYS it asked for, once the band has decided which price.
 *
 * **THE LINE'S LABEL IS A SNAPSHOT AND HAS TO SURVIVE THE PRICE ITEM BEING
 * DELETED**, which `SET NULL (price_item_id)` guarantees the row does and
 * nothing guarantees the meaning of. `Slaughter` on its own, after a rate sheet
 * has been replaced, no longer says which of 24 prices was quoted — so the
 * variant and the band are composed into the label as it is written.
 *
 * That is the opposite of the rule for the price item's own label, deliberately.
 * On the CATALOGUE those belong in fields, so the app can read them; on a LINE
 * they are a decision already made, and a decision is prose.
 */
export function snapshotLabel(item: BandedItem): string {
  const parts = [item.label.trim()];
  if (item.variant.trim() !== "") parts.push(item.variant.trim());
  const band = describeBand(item);
  if (band !== "") parts.push(band);
  return parts.join(" · ");
}

/** Everything a plant charges for one named thing, at one variant. */
export interface BandGroup {
  /** `kind\ncategory\nlabel\nvariant`. Stable, and never shown to anybody. */
  key: string;
  kind: string;
  category: string;
  label: string;
  variant: string;
  /** Every band under it, lowest floor first. One entry means it is not banded. */
  bands: BandedItem[];
  /** The one whose band covers the batch, or null with a reason below. */
  chosen: BandedItem | null;
  refusedBecause: BandRefusal | null;
}

/**
 * Collapse a rate sheet's bands down to one option per thing, resolved against
 * a batch size.
 *
 * **A GROUP OF ONE UNBANDED ROW IS RESOLVED WHATEVER THE HEAD COUNT**, including
 * when there is none. Most of a rate sheet is that: a delivery charge, a vacuum
 * bag, a giblet fee. Only a row that says it applies from some batch size
 * onwards needs a batch size to resolve, so a sheet with no head count on it is
 * still perfectly usable for everything except its bands.
 */
export function resolveBands(
  items: BandedItem[],
  head: number | null,
): BandGroup[] {
  const groups = new Map<string, BandedItem[]>();
  for (const item of items) {
    const key = [item.kind, item.category, item.label, item.variant].join("\n");
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  return [...groups.entries()].map(([key, rows]) => {
    const bands = [...rows].sort((a, b) => a.headMin - b.headMin);
    const first = bands[0];
    const group: BandGroup = {
      key,
      kind: first.kind,
      category: first.category,
      label: first.label,
      variant: first.variant,
      bands,
      chosen: null,
      refusedBecause: null,
    };

    // Not banded at all, and there is only one of it: nothing to resolve.
    if (bands.length === 1 && !isBanded(bands[0])) {
      return { ...group, chosen: bands[0] };
    }
    if (head === null) return { ...group, refusedBecause: "NO_HEAD_COUNT" };

    const covering = bands.filter((b) => bandCovers(b, head));
    if (covering.length === 0) {
      return { ...group, refusedBecause: "NO_BAND_COVERS" };
    }
    if (covering.length > 1) {
      return { ...group, refusedBecause: "BANDS_OVERLAP" };
    }
    return { ...group, chosen: covering[0] };
  });
}
