/**
 * What the Record stock dialog starts on. PURE — no imports, no database.
 *
 * The dialog used to open on `No batch` and `Not recorded` every time, even
 * for an item with exactly one open batch that lives in the one freezer the
 * business has — so every delivery of ground beef was two extra taps, and a
 * receipt whose person skipped them landed in no batch and no place. The
 * defaults here are the two facts the page already holds: which batch is the
 * only one, and where this item went last time.
 *
 * **A DEFAULT IS A SUGGESTION THE PERSON SEES, NOT A FACT THE APP RECORDS
 * BEHIND THEIR BACK.** Both stay visible in the dialog and both can be changed
 * to nothing, which is why neither is applied server-side.
 */

export interface PlacedEntry {
  locationAssetId: string | null;
}

/**
 * Where this item went last time — the first entry, newest first, that named
 * a place. Null when no entry ever did.
 */
export function lastPlaceUsed(newestFirst: readonly PlacedEntry[]): string | null {
  for (const entry of newestFirst) {
    if (entry.locationAssetId) return entry.locationAssetId;
  }
  return null;
}

/**
 * The place to start on: where the item went last time, so long as that place
 * still exists; otherwise the only place there is; otherwise nothing.
 *
 * A retired place is not offered, so a default pointing at one would render
 * a blank picker — hence the check. One place is a default rather than a
 * guess: a business with a single freezer keeps its stock in the freezer.
 */
export function defaultPlace(
  newestFirst: readonly PlacedEntry[],
  placeIds: readonly string[],
): string | null {
  const last = lastPlaceUsed(newestFirst);
  if (last && placeIds.includes(last)) return last;
  if (placeIds.length === 1) return placeIds[0];
  return null;
}

/**
 * The batch to start on: the only open one, or nothing. Two open batches is a
 * choice the person has to make, and a wrong default there is worse than none
 * — stock issued out of the wrong batch re-costs a pen.
 */
export function defaultBatch(openLotIds: readonly string[]): string | null {
  return openLotIds.length === 1 ? openLotIds[0] : null;
}
