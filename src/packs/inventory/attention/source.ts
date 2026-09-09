import "server-only";
import type { Tx } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import {
  expiringLots,
  lineCountsByCount,
  listCounts,
  listItems,
  listLocations,
  onHandByItem,
} from "../ops";
import { inventoryTreatmentOf, unbilledReceipts } from "../ledger-ops";
import {
  GOES_OFF_WITHIN_DAYS,
  belowZeroAttention,
  goingOffAttention,
  lowStockAttention,
  plusDays,
  staleCountAttention,
  unbilledAttention,
} from "../core/attention";

/**
 * What `inventory` says you still owe: stock below zero, a batch past its
 * date or about to be, an item down to its reorder point, a count walked and
 * never posted, and deliveries that have waited two months for an invoice.
 *
 * The third pack source after `production`'s and `livestock`'s, and the same
 * rules: it imports `@/lib/attention-sources/types` and its own pack, never
 * the registry and never another module. The arithmetic is in
 * `core/attention.ts`, pure and tested; this file only reads — the same reads
 * the hub, the counts page and the matching page make.
 *
 * ── WHO GETS WHAT ───────────────────────────────────────────────────────────
 *
 * Four of the five go to everybody: stock is used up, counted and reordered
 * by whoever is in the stockroom, and a batch going off is found by whoever
 * opens the freezer. The invoice line goes to OWNERS only — matching a bill
 * to a delivery is the owner's act, and it is only raised once stock is on
 * the balance sheet, because before that there is no GRNI balance for a late
 * invoice to leave standing.
 *
 * ── WHAT IS DELIBERATELY NOT AN OBLIGATION ──────────────────────────────────
 *
 *  1. **A batch going off in the middle of the hub's six weeks.** That is a
 *     shelf to use first, and the hub says so; the digest raises the week.
 *  2. **An empty draft count.** It cannot be posted and cannot be deleted, so
 *     the line would never clear.
 *  3. **An item nothing was ever recorded for**, whatever its reorder point.
 *     Never counted is not the same fact as out.
 *  4. **An unpriced delivery.** It credited nothing, so no invoice is owed
 *     against it; the valuation screen's caveat card carries it.
 */
export const inventoryAttentionSource: AttentionSource = {
  slug: "inventory-stock",
  moduleSlug: "inventory",
  label: "Inventory",

  async collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
    const [items, onHand, dated, counts, lineCounts, locations, treatment] =
      await Promise.all([
        listItems(tx, ctx.tenantId, { status: "active" }),
        onHandByItem(tx, ctx.tenantId),
        // No lower bound, deliberately: a batch past its date is the first
        // thing this should say. Empty batches are already dropped.
        expiringLots(tx, ctx.tenantId, {
          onOrBefore: plusDays(ctx.today, GOES_OFF_WITHIN_DAYS),
          limit: 200,
        }),
        listCounts(tx, ctx.tenantId, { status: "draft" }),
        lineCountsByCount(tx, ctx.tenantId),
        listLocations(tx, ctx.tenantId),
        inventoryTreatmentOf(tx, ctx.tenantId),
      ]);

    const levels = items.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.stockingUnit,
      onHand: onHand.get(i.id) ?? null,
      reorderPoint: i.reorderPoint,
    }));
    const placeNames = new Map(locations.map((l) => [l.id, l.name]));
    const drafts = counts.map((c) => ({
      id: c.id,
      countedOn: c.countedOn,
      where: c.locationAssetId
        ? (placeNames.get(c.locationAssetId) ?? "—")
        : "Everywhere",
      lines: lineCounts.get(c.id) ?? 0,
    }));
    // Owners, and only once stock is on the balance sheet — see the header.
    const unbilled =
      ctx.role === "owner" && treatment === "capitalise"
        ? (await unbilledReceipts(tx, ctx.tenantId, { limit: 200 })).filter(
            (r) => r.openCostCents > 0,
          )
        : [];

    return [
      ...belowZeroAttention(levels),
      ...goingOffAttention(
        /**
         * **SKIPPED, NOT DEFAULTED.** `expiringLots` filters nulls today, so
         * the column is never null here — but defaulting a missing date to
         * today would turn every undated batch into a `today`-urgency line
         * asserting a date the business never entered, the strongest
         * non-overdue badge the page has behind the least information. The
         * invariant belongs in this file, not in a WHERE clause two modules
         * away.
         */
        dated.flatMap((row) =>
          row.lot.expiresOn
            ? [
                {
                  lotId: row.lot.id,
                  code: row.lot.code,
                  itemId: row.lot.itemId,
                  itemName: row.itemName,
                  unit: row.unit,
                  balance: row.balance,
                  expiresOn: row.lot.expiresOn,
                },
              ]
            : [],
        ),
        ctx.today,
      ),
      ...lowStockAttention(levels),
      ...staleCountAttention(drafts, ctx.today),
      ...unbilledAttention(unbilled, ctx.today),
    ];
  },
};
