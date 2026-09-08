import "server-only";
import type { Tx } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import { listLots, movementKindsForLots } from "@/packs/inventory/ops";
import {
  lastCheckedByLot,
  listLivestockLots,
  parentByLot,
  withdrawalByLot,
} from "../ops";
import { splitInHead, summariseHead, summarisePen } from "../core/herd";
import { roundAttention, withdrawalAttention } from "../core/attention";

/**
 * What `livestock` says you still owe: the round you have not walked, and the
 * clocks that need a person — never looked up, or clearing now.
 *
 * The second pack source after `production`'s, and the same rules: it imports
 * `@/lib/attention-sources/types` and its own pack, never the registry and
 * never another module. The arithmetic is in `core/attention.ts`, pure and
 * tested; this file only reads.
 *
 * ── IT GOES TO EVERYBODY ────────────────────────────────────────────────────
 *
 * The round is walked by whoever is in the pens and a withdrawal stops
 * whoever is loading the trailer, so nothing here filters on role — the same
 * decision, with the same cost, as production's: a three-person farm gets the
 * line three times, and it disappears for all three the moment one of them
 * acts. The failure the other way is a medicated animal nobody was told
 * about.
 *
 * ── WHAT IS DELIBERATELY NOT AN OBLIGATION ──────────────────────────────────
 *
 *  1. **Today's round before it is walked.** A lot checked yesterday and not
 *     yet today is an ordinary morning; raising it at 7am would raise every
 *     lot every day. Two days gone is the missed round — `ROUND_STALE_AFTER_DAYS`.
 *  2. **A clock with days to run.** The lot page and the round carry the
 *     badge; a digest line every day of a thirty-day withdrawal is the line
 *     somebody stops reading.
 *  3. **A clock that cleared last week.** Finished with.
 *  4. **A closed lot, or one with nothing standing in it.** Nothing to look
 *     at and nothing to process. A pen whose head are all named animals still
 *     counts — its population is what is loose plus what lives in it, the
 *     fold every other screen makes (`summarisePen`).
 */
export const livestockAttentionSource: AttentionSource = {
  slug: "livestock-barn",
  moduleSlug: "livestock",
  label: "Livestock",

  async collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
    const lots = await listLivestockLots(tx, ctx.tenantId);
    if (lots.length === 0) return [];
    const ids = lots.map((l) => l.id);
    const inventoryLotIds = lots.map((l) => l.inventoryLotId);
    const [inventoryLots, movements, lotParents, lastChecked, withdrawals] =
      await Promise.all([
        listLots(tx, ctx.tenantId),
        movementKindsForLots(tx, ctx.tenantId, inventoryLotIds),
        parentByLot(tx, ctx.tenantId, ids, ctx.today),
        lastCheckedByLot(tx, ctx.tenantId),
        withdrawalByLot(tx, ctx.tenantId, ids, ctx.today),
      ]);
    const byInv = new Map(inventoryLots.map((l) => [l.id, l]));
    const byId = new Map(lots.map((l) => [l.id, l]));
    const membersOf = new Map<string, string[]>();
    for (const [memberId, parentId] of lotParents) {
      const list = membersOf.get(parentId) ?? [];
      list.push(memberId);
      membersOf.set(parentId, list);
    }
    const open = lots.filter((l) => byInv.get(l.inventoryLotId)?.status !== "closed");
    const codeOf = (lotId: string) => {
      const lot = byId.get(lotId);
      return (lot && byInv.get(lot.inventoryLotId)?.code) ?? "—";
    };

    // Head standing in each open record: a pen's population, an animal's own.
    const standing = new Map<string, number>();
    for (const lot of open) {
      const own = summariseHead(movements.get(lot.inventoryLotId) ?? []);
      if (lotParents.has(lot.id)) {
        standing.set(lot.id, own.balance);
        continue;
      }
      const members = (membersOf.get(lot.id) ?? []).flatMap((memberId) => {
        const m = byId.get(memberId);
        if (!m) return [];
        const rows = movements.get(m.inventoryLotId) ?? [];
        return [
          {
            summary: summariseHead(rows),
            splitInHead: splitInHead(rows),
            splitFromHere: byInv.get(m.inventoryLotId)?.parentLotId === lot.inventoryLotId,
          },
        ];
      });
      standing.set(lot.id, summarisePen(own, members).balance);
    }

    // The round is walked by pen: a member is looked at with the pen she
    // lives in, so only top-level lots with animals in them can be stale.
    const round = roundAttention(
      open
        .filter((l) => !lotParents.has(l.id) && (standing.get(l.id) ?? 0) > 0)
        .map((l) => ({
          id: l.id,
          code: codeOf(l.id),
          lastCheckedOn: lastChecked.get(l.id) ?? null,
        })),
      ctx.today,
    );

    // Every record with animals standing in it and a clock on record —
    // a pen's own, or an animal's (which includes what her pen was given
    // while she lived in it: `withdrawalByLot` already folds that in).
    const clocks = withdrawalAttention(
      open
        .filter((l) => (standing.get(l.id) ?? 0) > 0)
        .flatMap((l) => {
          const w = withdrawals.get(l.id);
          if (!w || w.treatmentCount === 0) return [];
          // `withdrawalByLot` folds the rows `treatmentsByLot` hands it, so
          // the binding row is a full treatment row at runtime and knows
          // which lot it was recorded against; the core type does not.
          const binding = w.meat.binding as
            | (NonNullable<typeof w.meat.binding> & { livestockLotId?: string })
            | null;
          return [
            {
              id: l.id,
              code: codeOf(l.id),
              state: w.meat.state,
              clearsOn: w.meat.clearsOn,
              product: binding?.product ?? null,
              treatmentId: binding?.id ?? null,
              ownsTreatment: binding?.livestockLotId === l.id,
            },
          ];
        }),
      ctx.today,
    );

    return [...(round ? [round] : []), ...clocks];
  },
};
