import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "@/lib/attention-sources/types";
import { packContext } from "@/lib/packs/tenant-context";
import { lastCheckedByLot, standingHerd, whoIsDue, withdrawalByLot } from "../ops";
import { roundAttention, withdrawalAttention } from "../core/attention";
import { breedingAttention } from "../core/breeding";

/**
 * What `livestock` says you still owe: the round you have not walked, the
 * clocks that need a person — never looked up, or clearing now — and the
 * calving windows about to open or already shut.
 *
 * The second pack source after `production`'s, and the same rules: it imports
 * `@/lib/attention-sources/types` and its own pack, never the registry and
 * never another module. The arithmetic is in `core/attention.ts` and
 * `core/breeding.ts`, pure and tested; this file only reads.
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
 *     fold every other screen makes (`standingHerd`).
 *  5. **The middle of a calving window.** A herd's window is three months
 *     long; the breeding page carries who is due now. The digest raises the
 *     week before it opens, the day it opens, and a window that has closed
 *     with nothing recorded — `breedingAttention`.
 */
export const livestockAttentionSource: AttentionSource = {
  slug: "livestock-barn",
  moduleSlug: "livestock",
  label: "Livestock",

  async collect(tx: Tx, ctx: AttentionCtx): Promise<AttentionItem[]> {
    const herd = await standingHerd(tx, ctx.tenantId, ctx.today);
    if (herd.lots.length === 0) return [];
    const [lastChecked, withdrawals, tenant] = await Promise.all([
      lastCheckedByLot(tx, ctx.tenantId),
      withdrawalByLot(
        tx,
        ctx.tenantId,
        herd.open.map((l) => l.id),
        ctx.today,
      ),
      // The digest is not a request, so nothing has resolved the tenant's
      // industry for us; the row is readable under the caller's own tx, the
      // same way `packContext` reads its labels.
      tx.query.tenants.findFirst({
        where: eq(schema.tenants.id, ctx.tenantId),
        columns: { industry: true },
      }),
    ]);
    // The gestation for a cycle a check opened on its own comes from the
    // profile; an exposure carries its own figure.
    const pack = await packContext(tx, ctx.tenantId, tenant?.industry ?? "", "livestock");

    // The round is walked by pen: a member is looked at with the pen she
    // lives in, so only top-level lots with animals in them can be stale.
    const round = roundAttention(
      herd.open
        .filter((l) => !herd.parentOf.has(l.id) && (herd.standing.get(l.id) ?? 0) > 0)
        .map((l) => ({
          id: l.id,
          code: herd.codeOf(l.id),
          lastCheckedOn: lastChecked.get(l.id) ?? null,
        })),
      ctx.today,
    );

    // Every record with animals standing in it and a clock on record —
    // a pen's own, or an animal's (which includes what her pen was given
    // while she lived in it: `withdrawalByLot` already folds that in).
    const clocks = withdrawalAttention(
      herd.open
        .filter((l) => (herd.standing.get(l.id) ?? 0) > 0)
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
              code: herd.codeOf(l.id),
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

    // Who is due — the same funnel the breeding page reads, one line per
    // female with a running cycle at the edge of her window.
    const due = breedingAttention(
      (await whoIsDue(tx, ctx.tenantId, ctx.today, pack.config)).map((line) => ({
        id: line.lotId,
        code: line.code,
        cycle: line.cycle,
      })),
      ctx.today,
    );

    return [...(round ? [round] : []), ...clocks, ...due];
  },
};
