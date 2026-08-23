/**
 * **THE SLOT: something outside accounting may change what a BASIS LENS
 * recognises.** Types only, so filling it drags nothing into a bundle —
 * primitive P5, the shape `production/core/handler.ts` set.
 *
 * ## Why this exists rather than accounting core just asking inventory
 *
 * `accounting` is a Layer 1 core module and **must not learn that inventory
 * exists**. Slice 3b already paid for that rule once: `approveBill` copies a
 * bill line's account verbatim, and the `inventory` pack sets that account at
 * MATCH time, precisely so the bill path never has to know what a stock receipt
 * is. Teaching `getBalances` about `item_kind` would undo it in the one place
 * every report goes through.
 *
 * So core names a slot in vocabulary that is true of any lens — some entries do
 * not belong in this basis, some lines belong under a different account — and a
 * registry under `src/lib/` is the only thing that knows a pack fills it. Same
 * direction of dependency as `mail-extensions` and `attention-sources`: core →
 * lib → pack, never core → pack.
 *
 * ## What a provider may and may not do
 *
 * It may drop an entry WHOLE and it may re-point a line. It may not change an
 * amount, invent a line, or move a date. That is not a courtesy: **an entry
 * dropped by one leg or a line re-priced would unbalance the report**, which
 * [ADR 0007](../../../docs/decisions/0007-cash-basis-reporting.md) names as the
 * failure to design against, and the trial balance is the only thing that would
 * notice.
 */

/** Which books, over which window, on which basis. */
export interface BasisLensRequest {
  tenantId: string;
  /** The report's own basis. A provider that only speaks to one checks this. */
  basis: "accrual" | "cash";
  asOf?: string;
  from?: string;
  to?: string;
}

export interface BasisLensAdjustment {
  /**
   * Entries to leave out of the base ENTIRELY, both legs together.
   *
   * **Both legs or neither.** Dropping one side of an entry is how a report
   * stops balancing, and nothing downstream would catch it.
   */
  excludedEntryIds: string[];
  /**
   * `journalLineId` → the account that line should be recognised under instead.
   *
   * **The amount is untouched and the control leg is untouched.** A
   * substitution moves a line sideways in the chart; it is not a re-pricing and
   * it is not a reclassification of the document.
   */
  substitutedLineAccounts: Map<string, string>;
}

export const EMPTY_BASIS_LENS_ADJUSTMENT: BasisLensAdjustment = {
  excludedEntryIds: [],
  substitutedLineAccounts: new Map(),
};

export interface BasisLensProvider<TTx> {
  /** Stable identifier, used only in the error a failing provider produces. */
  key: string;
  /**
   * **MAY THROW, AND A THROW MUST NOT BE SWALLOWED.** See `resolve.ts`: a
   * provider that fails silently produces a report on the wrong treatment with
   * nothing to say so.
   */
  adjust(tx: TTx, request: BasisLensRequest): Promise<BasisLensAdjustment>;
}
