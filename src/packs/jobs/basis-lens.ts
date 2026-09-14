import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  BasisLensAdjustment,
  BasisLensProvider,
  BasisLensRequest,
} from "@/lib/basis-lens/types";
import { EMPTY_BASIS_LENS_ADJUSTMENT } from "@/lib/basis-lens/types";
import { WIP_ENTRY_SOURCE } from "./vocabulary";

/**
 * **A WORK-IN-PROGRESS ADJUSTMENT IS NOT CASH.** ADR 0059.
 *
 * Percent-complete revenue is an accrual idea: it moves revenue to the period
 * the work was done in, whatever was invoiced or paid. A business reporting
 * on a cash basis recognises what came in, and an adjustment that trues
 * billings up to earned revenue has no place in that figure — so under the
 * cash lens every entry the jobs pack posted for a WIP period is dropped
 * WHOLE, the adjustment and its reversal alike. Both legs of each go
 * together, which is the one thing a provider may do
 * (`basis-lens/types.ts`).
 *
 * This is the lens doing what it is for. The construction dossier's finding
 * that "percent complete is not a basis lens" stands: a lens may not INVENT
 * the adjustment, which is why the pack posts a real entry; it may say the
 * entry does not belong in a basis, which is this.
 *
 * Cheap on every tenant that has never posted one: a single indexed read
 * that returns nothing, the same posture as inventory's lens.
 */
async function adjust(tx: Tx, request: BasisLensRequest): Promise<BasisLensAdjustment> {
  if (request.basis !== "cash") return EMPTY_BASIS_LENS_ADJUSTMENT;
  const rows = await tx
    .select({ id: schema.journalEntries.id })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, request.tenantId),
        eq(schema.journalEntries.source, WIP_ENTRY_SOURCE),
      ),
    );
  if (rows.length === 0) return EMPTY_BASIS_LENS_ADJUSTMENT;
  return { excludedEntryIds: rows.map((r) => r.id), substitutedLineAccounts: new Map() };
}

export const jobsWipBasisLens: BasisLensProvider<Tx> = { key: "jobs-wip", adjust };
