import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  RunConsumeInput,
  RunHandlerCtx,
  RunInputBlock,
  RunInputHandler,
} from "@/packs/production/core/handler";
import { removeHead, treatmentsByLot } from "./ops";
import {
  blocksProcessing,
  describeWithdrawal,
  formatWithdrawal,
  lotWithdrawal,
} from "./core/withdrawal";

/**
 * **THE ENFORCEMENT POINT SLICE 3 WAS BUILT FOR, and the only place head leaves
 * for a run.**
 *
 * Livestock's own dossier has said this was coming since 2026-08-20, in the
 * plainest terms it could:
 *
 * > NOTHING REFUSES AN ACTION ON WITHDRAWAL YET, because the actions it should
 * > refuse do not exist. … When slice 6 lands it must consult `blocksProcessing`
 * > before booking anything — that is the enforcement point this slice was built
 * > for.
 *
 * This is that. `production` names the slot (`production/core/handler.ts`) and
 * this file fills it, which is the sanctioned P5 shape: neither pack requires
 * the other, and `src/packs/run-handlers.ts` is the only file that knows both
 * exist.
 *
 * Two things live here and nowhere else:
 *
 *   1. **The refusal.** `blocksProcessing` is true for a lot under a period AND
 *      for one whose period nobody has looked up, because both mean the same
 *      thing to somebody about to load a trailer. **There is no override.** A
 *      farm that genuinely knows the period enters it, which is the same act as
 *      overriding and leaves a record instead of a hole.
 *   2. **The removal.** Head leaves through `removeHead`, which is livestock's
 *      own verb writing into the one ledger `inventory` keeps — not a second
 *      one, and not a movement `production` wrote itself.
 */

/** The meat clock, because that is the one a processing run is against. */
const CLOCK = "meat" as const;

export const livestockRunHandler: RunInputHandler<Tx> = {
  slug: "livestock",

  async claims(tx, tenantId, lotIds) {
    const claimed = new Set<string>();
    if (lotIds.length === 0) return claimed;
    const rows = await tx
      .select({ inventoryLotId: schema.livestockLots.inventoryLotId })
      .from(schema.livestockLots)
      .where(
        and(
          eq(schema.livestockLots.tenantId, tenantId),
          inArray(schema.livestockLots.inventoryLotId, lotIds),
        ),
      );
    for (const row of rows) claimed.add(row.inventoryLotId);
    return claimed;
  },

  /**
   * The species in each lot, for `production`'s exemption counter.
   *
   * **THIS PACK ANSWERS "poultry"; IT DOES NOT KNOW WHY IT WAS ASKED.** The cap
   * — a thousand birds a year on the pilot — is the profile's, in
   * `packConfig.production.exemptions`, and the counting is production's. All
   * this side owns is the fact that these animals are birds, which is the one
   * thing neither of the other two can see.
   */
  async kinds(tx, tenantId, lotIds) {
    const out = new Map<string, string>();
    if (lotIds.length === 0) return out;
    const rows = await tx
      .select({
        inventoryLotId: schema.livestockLots.inventoryLotId,
        species: schema.livestockLots.species,
      })
      .from(schema.livestockLots)
      .where(
        and(
          eq(schema.livestockLots.tenantId, tenantId),
          inArray(schema.livestockLots.inventoryLotId, lotIds),
        ),
      );
    for (const row of rows) out.set(row.inventoryLotId, row.species);
    return out;
  },

  async blocks(tx, tenantId, lotIds, today) {
    const out = new Map<string, RunInputBlock>();
    if (lotIds.length === 0) return out;

    // The slot speaks in INVENTORY lot ids — the spine, the same identity
    // `land` indexes occupancy on — so the biology row has to be looked up to
    // reach its treatments. One query, whatever the lot count.
    const lots = await tx
      .select({
        id: schema.livestockLots.id,
        inventoryLotId: schema.livestockLots.inventoryLotId,
      })
      .from(schema.livestockLots)
      .where(
        and(
          eq(schema.livestockLots.tenantId, tenantId),
          inArray(schema.livestockLots.inventoryLotId, lotIds),
        ),
      );
    if (lots.length === 0) return out;

    const treatments = await treatmentsByLot(
      tx,
      tenantId,
      lots.map((l) => l.id),
    );
    for (const lot of lots) {
      const status = lotWithdrawal(treatments.get(lot.id) ?? [], today)[CLOCK];
      if (!blocksProcessing(status)) continue;
      out.set(lot.inventoryLotId, {
        slug: "livestock",
        headline: formatWithdrawal(status),
        // Verbatim. A withdrawal message is a legal statement about whether meat
        // may lawfully be sold, and it is written where the clock is understood.
        reason: describeWithdrawal(status),
        clearsOn: status.clearsOn,
      });
    }
    return out;
  },

  async consume(tx: Tx, ctx: RunHandlerCtx, input: RunConsumeInput) {
    const movement = await removeHead(tx, ctx, {
      itemId: input.itemId,
      inventoryLotId: input.lotId,
      head: input.quantity,
      reason: "processed",
      occurredOn: input.occurredOn,
      locationAssetId: input.locationAssetId ?? null,
      costCents: input.costCents ?? null,
      notes: input.notes,
    });
    return movement.id;
  },
};
