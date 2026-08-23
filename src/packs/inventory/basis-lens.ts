import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  BasisLensAdjustment,
  BasisLensProvider,
  BasisLensRequest,
} from "@/lib/basis-lens/types";
import { EMPTY_BASIS_LENS_ADJUSTMENT } from "@/lib/basis-lens/types";
import { resolveTaxRule, type TaxRuleRow } from "./core/tax-rules";

/**
 * **APPLYING A RECORDED TAX DECISION TO A REPORT.** Slice 3d iii,
 * [ADR 0013](../../../docs/decisions/0013-inventory-tax-treatment.md) §A.4.
 *
 * Stage 3d ii built the place a decision gets recorded. This is the part that
 * acts on one, and it is the only file in the pack that knows a report exists.
 *
 * ## What a substituting rule does, in two moves
 *
 * Under `consumed` the books already say the right thing and this does nothing
 * at all. Under `paid`:
 *
 * 1. **Every stock entry for that category is dropped WHOLE.** The receipt
 *    (`Dr Inventory / Cr GRNI`) and the issue (`Dr Consumption / Cr Inventory`)
 *    both go, both legs, so the stock never reaches the balance sheet and its
 *    cost never lands at consumption. Under a paid rule this also prevents a
 *    real error: **shrinkage would otherwise be deducted twice**, once when the
 *    stock was paid for and again when it spoiled.
 * 2. **The bill line that settled it is re-pointed** from Goods Received Not
 *    Invoiced to the category's expense account.
 *
 * **THE DATE NEEDS NO WORK, AND THAT SURPRISED ME.** `cashBasisAdjustment`
 * already recognises a document's lines against the PAYMENT that lands in the
 * window — the deltas carry no dates of their own, the window decides. So under
 * a cash basis `paid` is a change of ACCOUNT, not a change of timing, and the
 * hard part of the ADR's §A.4 table turns out to be free. That is only true for
 * `paid`; see the bottom of this file for the rules it is not true of.
 *
 * ## Cash basis only, and that is an open question rather than a decision
 *
 * ADR 0013's own "least sure of" asks whether treatment is genuinely orthogonal
 * to basis in every combination "or whether some pairs are incoherent and
 * should be refused rather than rendered". `paid` on an ACCRUAL report is the
 * most likely incoherent pair, and `getBalances` documents the accrual path as
 * byte-identical to before. Answering that quietly, in code, is not this
 * slice's business — so the lens declines on accrual and the question stays
 * where it is.
 */

/** Entry sources whose `source_id` names an `inventory_movements` row. */
const MOVEMENT_SOURCES = [
  "inventory_receipt",
  "inventory_issue",
  "inventory_adjustment",
] as const;

/**
 * The rules this lens can act on TODAY. Narrower than
 * `isSubstitutingRule`, which says which rules would need an account at all —
 * every rule but `consumed`. That one is shared with `setTaxRule`; this one is
 * the lens's own, and `IMPLEMENTED_TIMING_RULES` is what stops the two
 * diverging by refusing anything else on the way in.
 */
const APPLIED_RULES = new Set(["paid"]);

async function adjust(
  tx: Tx,
  request: BasisLensRequest,
): Promise<BasisLensAdjustment> {
  if (request.basis !== "cash") return EMPTY_BASIS_LENS_ADJUSTMENT;

  const rules = await tx
    .select({
      itemKind: schema.inventoryTaxTreatments.itemKind,
      timingRule: schema.inventoryTaxTreatments.timingRule,
      expenseAccountId: schema.inventoryTaxTreatments.expenseAccountId,
    })
    .from(schema.inventoryTaxTreatments)
    .where(eq(schema.inventoryTaxTreatments.tenantId, request.tenantId));

  // The overwhelmingly common case, and it must stay cheap: nobody has recorded
  // anything, so every category resolves to `consumed` and there is no lens.
  if (!rules.some((r) => APPLIED_RULES.has(r.timingRule))) {
    return EMPTY_BASIS_LENS_ADJUSTMENT;
  }

  const stored: TaxRuleRow[] = rules.map((r) => ({
    itemKind: r.itemKind,
    timingRule: r.timingRule,
    expenseAccountId: r.expenseAccountId,
  }));

  /**
   * **RESOLVED PER ITEM, NOT PER RULE ROW.** A category inherits the tenant
   * default when it has no row of its own, so the set of items a substituting
   * rule covers is not the set of items whose kind was written down. Walking
   * the items and asking `resolveTaxRule` is the only way to get that right,
   * and it is the same function the screen shows.
   */
  const items = await tx
    .select({
      id: schema.inventoryItems.id,
      itemKind: schema.inventoryItems.itemKind,
    })
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.tenantId, request.tenantId));

  const expenseByItem = new Map<string, string>();
  for (const item of items) {
    const resolved = resolveTaxRule(item.itemKind, stored);
    if (!APPLIED_RULES.has(resolved.timingRule)) continue;
    if (!resolved.expenseAccountId) {
      /**
       * **REFUSES RATHER THAN PICKING ONE.** A substituting rule has to
       * substitute TO something, and ADR 0013 §A.5 is explicit that "everything
       * to cost of goods" produces a report that balances and is useless at
       * return time. Falling back to any account would be exactly that, and it
       * would be invisible.
       */
      throw new Error(
        `"${item.itemKind}" is set to be deducted when it is paid for, but no expense account has been recorded for it. A report cannot move that cost somewhere nobody has chosen.`,
      );
    }
    expenseByItem.set(item.id, resolved.expenseAccountId);
  }
  if (expenseByItem.size === 0) return EMPTY_BASIS_LENS_ADJUSTMENT;

  const itemIds = [...expenseByItem.keys()];

  /**
   * Movements of those items, and the entries this pack posted for them.
   *
   * `inventory_cost_adjustment` is deliberately absent from `MOVEMENT_SOURCES`
   * — its `source_id` names an `inventory_cost_adjustments` row rather than a
   * movement, so it needs its own join. Handled below.
   */
  const movements = await tx
    .select({ id: schema.inventoryMovements.id })
    .from(schema.inventoryMovements)
    .where(
      and(
        eq(schema.inventoryMovements.tenantId, request.tenantId),
        inArray(schema.inventoryMovements.itemId, itemIds),
      ),
    );
  const corrections = await tx
    .select({ id: schema.inventoryCostAdjustments.id })
    .from(schema.inventoryCostAdjustments)
    .where(
      and(
        eq(schema.inventoryCostAdjustments.tenantId, request.tenantId),
        inArray(schema.inventoryCostAdjustments.itemId, itemIds),
      ),
    );

  const sourceIds = [
    ...movements.map((m) => m.id),
    ...corrections.map((c) => c.id),
  ];

  const excludedEntryIds: string[] = [];
  if (sourceIds.length > 0) {
    const entries = await tx
      .select({ id: schema.journalEntries.id })
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.tenantId, request.tenantId),
          inArray(schema.journalEntries.source, [
            ...MOVEMENT_SOURCES,
            "inventory_cost_adjustment",
          ]),
          inArray(schema.journalEntries.sourceId, sourceIds),
        ),
      );
    excludedEntryIds.push(...entries.map((e) => e.id));
  }

  /**
   * **THE BILL LINES THAT SETTLED THAT STOCK**, found through the allocation
   * rather than by looking at what account they carry.
   *
   * Reading the account would be the obvious way and it is wrong twice: a line
   * pointed at GRNI by hand is impossible (`isCodableAccount` refuses it), and
   * more importantly the account cannot say WHICH item the line bought, which
   * is what decides the rule and the destination. The allocation names the
   * receipt movement, and the movement names the item.
   */
  const lines = await tx
    .selectDistinct({
      lineId: schema.billLineStockAllocations.billLineId,
      itemId: schema.inventoryMovements.itemId,
    })
    .from(schema.billLineStockAllocations)
    .innerJoin(
      schema.inventoryMovements,
      and(
        eq(
          schema.inventoryMovements.tenantId,
          schema.billLineStockAllocations.tenantId,
        ),
        eq(
          schema.inventoryMovements.id,
          schema.billLineStockAllocations.inventoryMovementId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.billLineStockAllocations.tenantId, request.tenantId),
        inArray(schema.inventoryMovements.itemId, itemIds),
      ),
    );

  /**
   * The substitution is keyed by JOURNAL LINE, not by bill line, because that
   * is what the recognition query has in its hand. One bill line posts one
   * journal line under `approveBill`, but the mapping has to be made rather
   * than assumed — so it is looked up.
   */
  const substitutedLineAccounts = new Map<string, string>();
  const billLineIds = lines.map((l) => l.lineId);
  if (billLineIds.length > 0) {
    const expenseByBillLine = new Map(
      lines.map((l) => [l.lineId, expenseByItem.get(l.itemId)!]),
    );
    const billLines = await tx
      .select({
        id: schema.billLines.id,
        billId: schema.billLines.billId,
        accountId: schema.billLines.accountId,
        amountCents: schema.billLines.amountCents,
      })
      .from(schema.billLines)
      .where(
        and(
          eq(schema.billLines.tenantId, request.tenantId),
          inArray(schema.billLines.id, billLineIds),
        ),
      );
    const billIds = [...new Set(billLines.map((l) => l.billId))];
    const journalLines =
      billIds.length === 0
        ? []
        : await tx
            .select({
              lineId: schema.journalLines.id,
              accountId: schema.journalLines.accountId,
              amountCents: schema.journalLines.amountCents,
              sourceId: schema.journalEntries.sourceId,
            })
            .from(schema.journalLines)
            .innerJoin(
              schema.journalEntries,
              and(
                eq(schema.journalEntries.tenantId, schema.journalLines.tenantId),
                eq(schema.journalEntries.id, schema.journalLines.entryId),
              ),
            )
            .where(
              and(
                eq(schema.journalLines.tenantId, request.tenantId),
                eq(schema.journalEntries.source, "bill"),
                inArray(schema.journalEntries.sourceId, billIds),
              ),
            );

    for (const bl of billLines) {
      const to = expenseByBillLine.get(bl.id);
      if (!to || !bl.accountId) continue;
      /**
       * **MATCHED BY ACCOUNT AND AMOUNT WITHIN THE BILL'S OWN ENTRY.**
       * `approveBill` copies each line verbatim, so the journal line carrying
       * this bill line is the one with the same account and the same amount.
       * Where a bill has two lines identical in both, either is the right
       * answer: they resolve to the same item and therefore the same account.
       */
      const match = journalLines.find(
        (jl) =>
          jl.sourceId === bl.billId &&
          jl.accountId === bl.accountId &&
          jl.amountCents === bl.amountCents &&
          !substitutedLineAccounts.has(jl.lineId),
      );
      if (match) substitutedLineAccounts.set(match.lineId, to);
    }
  }

  return { excludedEntryIds, substitutedLineAccounts };
}

export const inventoryBasisLens: BasisLensProvider<Tx> = {
  key: "inventory",
  adjust,
};

/**
 * **WHAT THIS DOES NOT DO YET, AND WHY EACH ONE IS ITS OWN PROBLEM.**
 *
 * `IMPLEMENTED_TIMING_RULES` in `core/tax-rules.ts` is what stops any of these
 * being recorded, so none of them can be silently wrong. Widen it only
 * alongside the work here.
 *
 * - **`billed`** needs a line to stay on the BILL's date while the rest of the
 *   document moves to the payment date. An entry has ONE control leg shared
 *   across mixed lines, so that means splitting the leg pro rata — the problem
 *   `paid` turned out not to have.
 * - **`sold`** needs the recognition to land on a retail sale, which is neither
 *   the document nor the payment the adjustment is built around.
 * - **`later_of_*`** needs two dates compared per line and the result placed in
 *   whichever window it falls in. The adjustment carries no per-line dates at
 *   all today; it produces window-scoped totals.
 */
