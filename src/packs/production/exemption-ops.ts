import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { RUN_INPUT_HANDLERS } from "@/packs/run-handlers";
import {
  exemptionStanding,
  type ExemptionRule,
  type ExemptionStanding,
} from "./vocabulary";

/**
 * The on-farm processing exemption, counted.
 *
 * **A COUNTABLE ANNUAL LIMIT, AND THE DESIGN SAYS THE PILOT IS ALREADY MANAGED
 * TO IT** — *"the pilot sits at exactly 1,000 birds — i.e. already managed to a
 * line. Recording processing runs yields the year-to-date count for free, so the
 * app can warn as the cap approaches."* This file is the "for free" part: no
 * counter is kept anywhere, and none can drift.
 *
 * **NOTHING HERE KNOWS WHAT A BIRD IS.** Three parties, none of which knows more
 * than it should:
 *
 *   - `livestock` says which SPECIES is in a lot, through the P5 slot. It is not
 *     told why.
 *   - the installed profile says which kinds carry a cap and what it is
 *     (`packConfig.production.exemptions`), because a limit is a jurisdiction's
 *     fact rather than a software one.
 *   - this file multiplies the two.
 *
 * A tenant with no livestock has no handler claiming a lot, every kind comes
 * back empty, and the whole feature is silently inert — which is the correct
 * behaviour for a bakery.
 *
 * **WHAT COUNTS: head that went IN, on a COMPLETE run, with NO processor, in the
 * year.** Four choices, each of which could have gone the other way:
 *
 *   1. **Inputs, not outputs.** The limit is on birds processed, not on boxes
 *      produced. One bird can become four packages.
 *   2. **Complete runs only.** An open run has not processed anything yet, and
 *      counting it would tell a farm it had used capacity it can still choose
 *      not to.
 *   3. **`processor_id IS NULL`.** That is the on-farm path. Anything sent out
 *      was inspected by somebody and is not what the exemption covers.
 *   4. **`started_on`, not `completed_on`.** The bird was killed on the day the
 *      run started; a run finished in January over birds processed in December
 *      belongs to December's count.
 */

export interface ExemptionUsage extends ExemptionRule {
  used: number;
  standing: ExemptionStanding;
}

/**
 * Year-to-date usage for every declared exemption.
 *
 * Returns a row per RULE, including the ones sitting at zero — a farm needs to
 * see that it has 1,000 left as much as it needs to see it has 40, and a list
 * that appears only once you are close is one nobody plans against.
 */
export async function exemptionUsage(
  tx: Tx,
  tenantId: string,
  rules: ExemptionRule[],
  year: number,
): Promise<ExemptionUsage[]> {
  if (rules.length === 0) return [];

  const rows = await tx
    .select({
      lotId: schema.inventoryMovements.lotId,
      /**
       * THE QUANTITY IS ON THE MOVEMENT, not on the input row. The input is
       * "a JOIN, not a second ledger" — its only own column is `weight_lb` —
       * and head is just a unit of measure in `inventory`. It is SIGNED, and
       * an issue is negative, so the sum is negated below.
       */
      quantity: schema.inventoryMovements.quantity,
    })
    .from(schema.productionRunInputs)
    .innerJoin(
      schema.productionRuns,
      and(
        eq(schema.productionRuns.tenantId, schema.productionRunInputs.tenantId),
        eq(schema.productionRuns.id, schema.productionRunInputs.runId),
      ),
    )
    .innerJoin(
      schema.inventoryMovements,
      and(
        eq(
          schema.inventoryMovements.tenantId,
          schema.productionRunInputs.tenantId,
        ),
        eq(
          schema.inventoryMovements.id,
          schema.productionRunInputs.inventoryMovementId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.productionRunInputs.tenantId, tenantId),
        eq(schema.productionRuns.status, "complete"),
        isNull(schema.productionRuns.processorId),
        gte(schema.productionRuns.startedOn, `${year}-01-01`),
        lte(schema.productionRuns.startedOn, `${year}-12-31`),
      ),
    );

  const lotIds = [
    ...new Set(rows.map((r) => r.lotId).filter((id): id is string => !!id)),
  ];

  // Ask every handler what is in these lots. A lot nobody claims has no kind
  // and counts toward nothing — a sack of flour is not a bird.
  const kindByLot = new Map<string, string>();
  for (const handler of RUN_INPUT_HANDLERS) {
    const claimed = await handler.claims(tx, tenantId, lotIds);
    if (claimed.size === 0) continue;
    const kinds = await handler.kinds(tx, tenantId, [...claimed]);
    for (const [lotId, kind] of kinds) kindByLot.set(lotId, kind);
  }

  const usedByKind = new Map<string, number>();
  for (const row of rows) {
    if (!row.lotId) continue;
    const kind = kindByLot.get(row.lotId);
    if (!kind) continue;
    // Negated: stock LEAVING is a negative movement, and a count of birds
    // processed is a positive number of birds.
    usedByKind.set(kind, (usedByKind.get(kind) ?? 0) - Number(row.quantity));
  }

  return rules.map((rule) => {
    // Head is a whole number. A pen is never 99.7 birds, but the quantity
    // column is numeric because inventory stocks things by weight too, and a
    // float dragged through a sum should not put "999.9999999" on a screen that
    // is about a legal limit.
    const used = Math.round(usedByKind.get(rule.kind) ?? 0);
    return { ...rule, used, standing: exemptionStanding(used, rule.annualHead) };
  });
}
