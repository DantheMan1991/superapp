import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { loadParty } from "@/lib/parties";
import { resolveServicesAccruedAccount } from "@/packs/inventory/ledger-ops";
import { adjustLotCost } from "@/packs/inventory/ops";
import { ProductionError, type ProductionCtx, requireWrite } from "./ops";
import { rollCents } from "./core/roll";

/**
 * **THE PLANT'S BILL, MATCHED TO THE PROCESSING DAY IT PAYS FOR.** Slice 2d.
 *
 * `completeRun` accrues what the plant charged — `Dr consumption / Cr 2060
 * Services Received Not Invoiced` — because the fee went into the meat's cost
 * and nobody had invoiced it yet. **Nothing ever took it off again.** 2c said
 * so plainly and called the growing balance a feature in the meantime: a
 * non-zero 2060 per plant IS the list of processing nobody has billed you for,
 * the same self-surfacing shape `missedBookings` has. It stops being a feature
 * the moment a bill arrives, and this file is the third line of that worked
 * entry:
 *
 * ```
 * accrual        Dr 5000 22370   Cr 2060 22370
 * outputs land   Dr 1300 22370   Cr 5000 22370
 * bill matched   Dr 2060 22370   Dr 5000 1130   Cr AP 23500   ← here
 *                ─────────────────────────────────────────────
 *                1300 = 22370 · 2060 = 0 · 5000 = 1130 · AP = 23500
 * ```
 *
 * **THIS IS `bill_line_stock_allocations` ONE ACCOUNT ALONG.** The shape is
 * copied from `inventory/ledger-ops.ts` deliberately rather than reinvented —
 * upsert the allocations, rebuild the line from ALL of them, split the invoice
 * so the liability clears EXACTLY and a sibling line carries the difference.
 * Every one of those was learned there by a bug; see that file's comments.
 *
 * ── WHERE THIS FILE SITS ────────────────────────────────────────────────────
 *
 * **IT IS THIS PACK'S ONLY FILE THAT TOUCHES CORE'S TABLES**, which is the same
 * boundary `inventory` drew when it split `ledger-ops.ts` out — worth being
 * able to see in the file list. It READS `journal_entries` to find what was
 * accrued and REWRITES `bill_lines` to point at the liability; it posts no entry
 * itself. `approveBill` does that, from the lines, exactly as it does for every
 * other bill — which is why matching sets the account here rather than at
 * approval, where accounting core is industry-blind and must not reach into a
 * pack.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * **IT NEVER CLEARS MORE THAN WAS ACCRUED.** The figure it settles is what the
 * ledger credited when the run finished, stamped onto the allocation at match
 * time — not the run's current fee, which a cost correction may since have
 * moved. Clearing anything else would leave 2060 holding a number no run
 * explains, which is the exact defect that made 2c refuse to put this in 2050.
 *
 * **AND IT DOES NOT MOVE THE MEAT'S COST.** The difference between what was
 * accrued and what was billed goes to the P&L, and the batch keeps what it
 * landed with until somebody deliberately says otherwise — `correctRunCost`
 * below. Decided 2026-08-24, and it is `inventory`'s own split: ADR 0012 §A.5
 * corrects the books when an invoice disagrees with the ticket, §A.4 corrects
 * the stock record, and a delivery that gets both ends up with the right value,
 * the right liability and no net variance.
 */

/** A run's accrual, and how much of it a bill has settled. */
export interface OpenAccrual {
  runId: string;
  runCode: string;
  startedOn: string;
  /** Whose books the accrual posted in. A bill from another company cannot settle it. */
  entityId: string;
  processorId: string | null;
  /** The plant's name, or null on a run done here. */
  processorName: string | null;
  /** What the run's accrual credited to `2060`. */
  accruedCents: number;
  /** Covered by bill lines so far. */
  matchedCents: number;
  /** Still sitting in `2060` for this run. */
  openCents: number;
}

/**
 * **WHAT IS STILL IN `2060`, RUN BY RUN — READ FROM THE LEDGER, NOT FROM THE
 * RUN.**
 *
 * `production_runs.processing_fee_cents` is what somebody typed; the accrual
 * entry is what actually posted, and they can differ for two ordinary reasons:
 * a tenant with stock posting turned off accrues nothing at all, and a fee of
 * zero is a plant that waived it. Building this list off the fee column would
 * offer runs with nothing to settle and then fail at match time.
 *
 * Reading `journal_entries` rather than a production table is also what keeps
 * the two halves honest: this is the account's own contents, grouped by what
 * put them there.
 */
export async function openProcessingAccruals(
  tx: Tx,
  tenantId: string,
  opts: { runIds?: string[]; includeSettled?: boolean } = {},
): Promise<OpenAccrual[]> {
  const accountId = await resolveServicesAccruedAccount(tx, tenantId);

  const entries = await tx.query.journalEntries.findMany({
    where: and(
      eq(schema.journalEntries.tenantId, tenantId),
      eq(schema.journalEntries.source, "production_processing_accrual"),
      eq(schema.journalEntries.status, "posted"),
    ),
    columns: { id: true, sourceId: true, entityId: true },
  });
  if (entries.length === 0) return [];

  const lines = await tx.query.journalLines.findMany({
    where: and(
      eq(schema.journalLines.tenantId, tenantId),
      eq(schema.journalLines.accountId, accountId),
      inArray(
        schema.journalLines.entryId,
        entries.map((e) => e.id),
      ),
    ),
    columns: { entryId: true, amountCents: true },
  });

  // The credit is negative in the ledger's own convention, so the accrued
  // figure is its negation. A run posted twice — which nothing does today, the
  // idempotency key sees to that — would sum, which is the right answer anyway.
  const accruedByRun = new Map<string, number>();
  const entityByRun = new Map<string, string>();
  const entryById = new Map(entries.map((e) => [e.id, e]));
  for (const line of lines) {
    const entry = entryById.get(line.entryId);
    if (!entry?.sourceId) continue;
    accruedByRun.set(
      entry.sourceId,
      (accruedByRun.get(entry.sourceId) ?? 0) - line.amountCents,
    );
    entityByRun.set(entry.sourceId, entry.entityId);
  }

  const wanted = opts.runIds
    ? [...accruedByRun.keys()].filter((id) => opts.runIds?.includes(id))
    : [...accruedByRun.keys()];
  if (wanted.length === 0) return [];

  const [runs, allocations] = await Promise.all([
    tx.query.productionRuns.findMany({
      where: and(
        eq(schema.productionRuns.tenantId, tenantId),
        inArray(schema.productionRuns.id, wanted),
      ),
      columns: { id: true, code: true, startedOn: true, processorId: true },
    }),
    tx.query.productionRunBillAllocations.findMany({
      where: and(
        eq(schema.productionRunBillAllocations.tenantId, tenantId),
        inArray(schema.productionRunBillAllocations.runId, wanted),
      ),
      columns: { runId: true, accruedCents: true },
    }),
  ]);

  const matchedByRun = new Map<string, number>();
  for (const a of allocations) {
    matchedByRun.set(a.runId, (matchedByRun.get(a.runId) ?? 0) + a.accruedCents);
  }

  const names = await processorNames(
    tx,
    tenantId,
    runs.map((r) => r.processorId).filter((id): id is string => id !== null),
  );

  const rows: OpenAccrual[] = [];
  for (const run of runs) {
    const accruedCents = accruedByRun.get(run.id) ?? 0;
    const matchedCents = matchedByRun.get(run.id) ?? 0;
    const openCents = accruedCents - matchedCents;
    if (!opts.includeSettled && openCents <= 0) continue;
    rows.push({
      runId: run.id,
      runCode: run.code,
      startedOn: run.startedOn,
      entityId: entityByRun.get(run.id) ?? "",
      processorId: run.processorId,
      processorName: run.processorId
        ? (names.get(run.processorId) ?? null)
        : null,
      accruedCents,
      matchedCents,
      openCents,
    });
  }
  // Oldest first: the thing that has been waiting longest to be invoiced is the
  // thing somebody should be asking the plant about.
  return rows.sort(
    (a, b) => a.startedOn.localeCompare(b.startedOn) || a.runCode.localeCompare(b.runCode),
  );
}

/** Plant names, in one read. The name lives on the party, never on the processor. */
async function processorNames(
  tx: Tx,
  tenantId: string,
  processorIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (processorIds.length === 0) return out;
  const processors = await tx.query.productionProcessors.findMany({
    where: and(
      eq(schema.productionProcessors.tenantId, tenantId),
      inArray(schema.productionProcessors.id, [...new Set(processorIds)]),
    ),
    columns: { id: true, partyId: true },
  });
  for (const p of processors) {
    const party = await loadParty(tx, tenantId, p.partyId);
    if (party) out.set(p.id, party.displayName);
  }
  return out;
}

/**
 * The sentence a variance line carries, and the key that lets a re-match find
 * its own sibling. Mirrors the one `allocateBillLineToStock` builds.
 */
function varianceDescriptionFor(lineDescription: string): string {
  return `Difference against what was accrued — ${lineDescription}`;
}

/** A line on an unapproved bill from a plant, waiting to be pointed at a run. */
export interface MatchableBillLine {
  billLineId: string;
  billId: string;
  billNumber: string;
  billDate: string;
  vendorName: string;
  entityId: string;
  description: string;
  amountCents: number;
  /** Runs already settled by this line. Empty on an unmatched one. */
  matchedRunCodes: string[];
}

/**
 * **THE OTHER HALF OF THE RECONCILIATION: bill lines with no processing day.**
 *
 * Scoped to vendors that are ALSO processors — matched through the PARTY, which
 * is the whole reason `production_processors` carries no name of its own and
 * hangs off `parties` instead. A farm's payables are mostly feed and fuel, and
 * offering every draft bill line here would bury the two that are a butcher's.
 *
 * **A PLANT THAT IS NOT SET UP AS A VENDOR SIMPLY DOES NOT APPEAR**, and that is
 * honest rather than a gap: a bill has to have a vendor before it can exist, so
 * a processor with no vendor row has no bills to match.
 */
export async function matchableProcessorBillLines(
  tx: Tx,
  tenantId: string,
): Promise<MatchableBillLine[]> {
  const processors = await tx.query.productionProcessors.findMany({
    where: eq(schema.productionProcessors.tenantId, tenantId),
    columns: { id: true, partyId: true },
  });
  if (processors.length === 0) return [];
  const partyIds = new Set(processors.map((p) => p.partyId));

  const vendors = await tx.query.vendors.findMany({
    where: eq(schema.vendors.tenantId, tenantId),
    columns: { id: true, partyId: true, name: true },
  });
  const plantVendors = vendors.filter((v) => partyIds.has(v.partyId));
  if (plantVendors.length === 0) return [];
  const vendorById = new Map(plantVendors.map((v) => [v.id, v]));

  const bills = await tx.query.bills.findMany({
    where: and(
      eq(schema.bills.tenantId, tenantId),
      inArray(
        schema.bills.vendorId,
        plantVendors.map((v) => v.id),
      ),
    ),
    columns: {
      id: true,
      vendorId: true,
      billNumber: true,
      billDate: true,
      entityId: true,
      status: true,
    },
  });
  // Only what can still be matched. An approved bill has posted its entry, and
  // rewriting a line would leave the bill disagreeing with its own journal.
  const open = bills.filter(
    (b) => b.status === "draft" || b.status === "awaiting_approval",
  );
  if (open.length === 0) return [];
  const billById = new Map(open.map((b) => [b.id, b]));

  const lines = await tx.query.billLines.findMany({
    where: and(
      eq(schema.billLines.tenantId, tenantId),
      inArray(
        schema.billLines.billId,
        open.map((b) => b.id),
      ),
    ),
  });
  if (lines.length === 0) return [];

  const allocations = await tx
    .select({
      billLineId: schema.productionRunBillAllocations.billLineId,
      runId: schema.productionRunBillAllocations.runId,
    })
    .from(schema.productionRunBillAllocations)
    .where(
      and(
        eq(schema.productionRunBillAllocations.tenantId, tenantId),
        inArray(
          schema.productionRunBillAllocations.billLineId,
          lines.map((l) => l.id),
        ),
      ),
    );
  const runIds = [...new Set(allocations.map((a) => a.runId))];
  const runs =
    runIds.length === 0
      ? []
      : await tx.query.productionRuns.findMany({
          where: and(
            eq(schema.productionRuns.tenantId, tenantId),
            inArray(schema.productionRuns.id, runIds),
          ),
          columns: { id: true, code: true },
        });
  const codeByRun = new Map(runs.map((r) => [r.id, r.code]));
  const codesByLine = new Map<string, string[]>();
  for (const a of allocations) {
    const list = codesByLine.get(a.billLineId) ?? [];
    list.push(codeByRun.get(a.runId) ?? "");
    codesByLine.set(a.billLineId, list);
  }

  /**
   * **THE VARIANCE SIBLINGS ARE NOT OFFERED FOR MATCHING.** One is the leftover
   * of a match that already happened; matching it would point a second line at
   * `2060` for money no run accrued.
   */
  const varianceDescriptions = new Set(
    lines.map((l) => varianceDescriptionFor(l.description)),
  );

  return lines
    .filter((l) => !varianceDescriptions.has(l.description))
    .map((l) => {
      const bill = billById.get(l.billId)!;
      return {
        billLineId: l.id,
        billId: l.billId,
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        vendorName: vendorById.get(bill.vendorId)?.name ?? "",
        entityId: bill.entityId,
        description: l.description,
        amountCents: l.amountCents,
        matchedRunCodes: (codesByLine.get(l.id) ?? []).filter(Boolean).sort(),
      };
    })
    .sort(
      (a, b) =>
        b.billDate.localeCompare(a.billDate) ||
        a.vendorName.localeCompare(b.vendorName) ||
        a.description.localeCompare(b.description),
    );
}

export interface MatchBillLineInput {
  billLineId: string;
  /**
   * **THE RUNS, AND NOT AN AMOUNT PER RUN.** A processing day is invoiced as a
   * whole: there is no natural unit to settle part of one with, the way a
   * delivery has a quantity. So naming a run settles its whole outstanding
   * accrual, and what the invoice charges beyond that is the variance.
   */
  runIds: string[];
}

export interface MatchBillLineResult {
  allocations: number;
  /** What the line will clear from `2060` when the bill is approved. */
  accruedCents: number;
  /** What the plant charged over (or under) it. Goes to the P&L. */
  varianceCents: number;
}

/**
 * **MATCH A BILL LINE TO THE PROCESSING IT PAYS FOR**, and point it at `2060`
 * so approving the bill clears what completing the run credited.
 *
 * OWNER, the same call `allocateBillLineToStock` makes: settling a liability and
 * deciding what a variance was is a decision, not a chore.
 */
export async function matchBillLineToRuns(
  tx: Tx,
  ctx: ProductionCtx,
  input: MatchBillLineInput,
): Promise<MatchBillLineResult> {
  requireWrite(ctx, "owner");
  const runIds = [...new Set(input.runIds)];
  if (runIds.length === 0) {
    throw new ProductionError(
      "BILL_INVALID",
      "pick at least one processing day for this line",
    );
  }

  const line = await tx.query.billLines.findFirst({
    where: and(
      eq(schema.billLines.tenantId, ctx.tenantId),
      eq(schema.billLines.id, input.billLineId),
    ),
  });
  if (!line) throw new ProductionError("NOT_FOUND", "that bill line is gone");

  /**
   * **THE BILL MUST STILL BE A DRAFT.** Matching rewrites the line's account and
   * amount and `approveBill` builds its entry FROM those lines, so matching an
   * approved bill changes what the bill says without changing what posted — and
   * the bill stops reconciling to its own journal entry.
   */
  const bill = await tx.query.bills.findFirst({
    where: and(
      eq(schema.bills.tenantId, ctx.tenantId),
      eq(schema.bills.id, line.billId),
    ),
    columns: { status: true, entityId: true },
  });
  if (!bill) throw new ProductionError("NOT_FOUND", "that bill is gone");
  if (bill.status !== "draft" && bill.status !== "awaiting_approval") {
    throw new ProductionError(
      "BILL_POSTED",
      "that bill is already approved — match the processing before approving it",
    );
  }

  /**
   * **THE INVOICE AMOUNT, RECONSTRUCTED**, because matching rewrites the line
   * and may already have done so. A matched line carries the accrued total and
   * its sibling carries the rest; reading only the line would shrink the bill a
   * little more on every re-match.
   */
  const varianceDescription = varianceDescriptionFor(line.description);
  const priorSiblings = await tx
    .select({ amountCents: schema.billLines.amountCents })
    .from(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, line.billId),
        eq(schema.billLines.description, varianceDescription),
      ),
    );
  const invoiceTotalCents =
    line.amountCents + priorSiblings.reduce((sum, r) => sum + r.amountCents, 0);

  // Only the runs this call names, and their state as at right now.
  const open = await openProcessingAccruals(tx, ctx.tenantId, { runIds });
  const byRun = new Map(open.map((r) => [r.runId, r]));
  for (const runId of runIds) {
    const accrual = byRun.get(runId);
    if (!accrual) {
      throw new ProductionError(
        "BILL_INVALID",
        "that processing day has nothing left to settle — either it was never accrued, or a bill already covers it",
      );
    }
    /**
     * **A BILL CANNOT SETTLE ANOTHER COMPANY'S PROCESSING.** The accrual posted
     * in whichever company the run's stock belonged to; the bill clears in its
     * own. If those differ the two halves land in different books and neither
     * `2060` ever nets — the same defect `resolveMovementEntity` fixes on the
     * posting side, arriving from the other end. The `Test` tenant keeps two
     * companies, which is why this is checked rather than assumed.
     */
    if (accrual.entityId !== bill.entityId) {
      throw new ProductionError(
        "BILL_INVALID",
        "that processing day belongs to a different company from this bill",
      );
    }
  }

  const shares = runIds.map((runId) => ({
    runId,
    openCents: byRun.get(runId)?.openCents ?? 0,
  }));
  // Split by what each run has outstanding, so a bill covering two kill days
  // charges each in proportion to what it accrued. Largest remainder, so the
  // parts sum to the invoice exactly.
  const billed = rollCents(
    invoiceTotalCents,
    shares.map((s) => ({ key: s.runId, basis: s.openCents })),
  );

  for (const share of shares) {
    await tx
      .insert(schema.productionRunBillAllocations)
      .values({
        tenantId: ctx.tenantId,
        billLineId: input.billLineId,
        runId: share.runId,
        accruedCents: share.openCents,
        billedCents: billed.get(share.runId) ?? 0,
      })
      /**
       * **UPSERT, NOT insert-or-ignore.** A second match against the same pair
       * is a correction to the first — `onConflictDoNothing` would report
       * success, re-point the line, and leave the allocation claiming the old
       * figure. `correctedCents` is deliberately NOT reset: what has already
       * been pushed onto the meat has already posted.
       */
      .onConflictDoUpdate({
        target: [
          schema.productionRunBillAllocations.tenantId,
          schema.productionRunBillAllocations.billLineId,
          schema.productionRunBillAllocations.runId,
        ],
        set: {
          accruedCents: share.openCents,
          billedCents: billed.get(share.runId) ?? 0,
        },
      });
  }

  /**
   * **THE LINE IS REBUILT FROM EVERY ALLOCATION ON IT, not from this call**, so
   * matching one line against two runs in two calls does not overwrite the first
   * with the second and strand an accrual forever.
   */
  const onLine = await tx
    .select({
      accruedCents: schema.productionRunBillAllocations.accruedCents,
    })
    .from(schema.productionRunBillAllocations)
    .where(
      and(
        eq(schema.productionRunBillAllocations.tenantId, ctx.tenantId),
        eq(schema.productionRunBillAllocations.billLineId, input.billLineId),
      ),
    );
  const accruedTotal = onLine.reduce((sum, r) => sum + r.accruedCents, 0);
  const varianceCents = invoiceTotalCents - accruedTotal;

  const accountId = await resolveServicesAccruedAccount(tx, ctx.tenantId);

  /**
   * **THE LINE IS SPLIT SO THAT `2060` CLEARS EXACTLY.** `approveBill` posts
   * each line to its own account at its own amount, so a single line for the
   * invoice total would debit 2060 by more than the run ever credited and leave
   * the difference sitting there meaning nothing. The matched line carries
   * exactly what was accrued; a sibling carries the rest. AP is unaffected — the
   * two still sum to the invoice.
   */
  await tx
    .update(schema.billLines)
    .set({ accountId, amountCents: accruedTotal })
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.id, input.billLineId),
      ),
    );

  // Rebuilt rather than adjusted: one sibling, carrying the whole difference.
  await tx
    .delete(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, line.billId),
        eq(schema.billLines.description, varianceDescription),
      ),
    );
  if (varianceCents !== 0) {
    const siblingNo = await nextLineNo(tx, ctx.tenantId, line.billId);
    await tx.insert(schema.billLines).values({
      tenantId: ctx.tenantId,
      billId: line.billId,
      lineNo: siblingNo,
      description: varianceDescription,
      amountCents: varianceCents,
      /**
       * **UNCODED ON PURPOSE.** A processing overcharge is not obviously a cost
       * of goods — it may be a rate rise, a service nobody asked for, or a
       * mistake to query — and this pack must not decide which. It is left for
       * whoever codes the bill, which is the ordinary path for any line.
       */
      accountId: null,
    });
  }

  return {
    allocations: onLine.length,
    accruedCents: accruedTotal,
    varianceCents,
  };
}

/** The next free line number on a bill. Bill lines are unique per `(bill, no)`. */
async function nextLineNo(
  tx: Tx,
  tenantId: string,
  billId: string,
): Promise<number> {
  const rows = await tx
    .select({ lineNo: schema.billLines.lineNo })
    .from(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, tenantId),
        eq(schema.billLines.billId, billId),
      ),
    );
  return rows.reduce((max, r) => Math.max(max, r.lineNo), 0) + 1;
}

/**
 * Unpick a match.
 *
 * **SOMEBODY WILL MATCH THE WRONG KILL DAY**, and until this the only way out
 * would be SQL. It undoes all three things matching did — the allocations, the
 * sibling line, and the line's own account and amount — because leaving any one
 * of them puts the bill in a state no screen can explain.
 */
export async function unmatchBillLineFromRuns(
  tx: Tx,
  ctx: ProductionCtx,
  input: { billLineId: string },
): Promise<{ released: number }> {
  requireWrite(ctx, "owner");

  const line = await tx.query.billLines.findFirst({
    where: and(
      eq(schema.billLines.tenantId, ctx.tenantId),
      eq(schema.billLines.id, input.billLineId),
    ),
  });
  if (!line) throw new ProductionError("NOT_FOUND", "that bill line is gone");

  const bill = await tx.query.bills.findFirst({
    where: and(
      eq(schema.bills.tenantId, ctx.tenantId),
      eq(schema.bills.id, line.billId),
    ),
    columns: { status: true },
  });
  if (!bill) throw new ProductionError("NOT_FOUND", "that bill is gone");
  if (bill.status !== "draft" && bill.status !== "awaiting_approval") {
    throw new ProductionError(
      "BILL_POSTED",
      "that bill is already approved — its entry has posted, so the match cannot be unpicked",
    );
  }

  /**
   * **A CORRECTION THAT HAS ALREADY POSTED BLOCKS THIS.** Unpicking would put
   * the accrual back as unsettled while the meat keeps a cost that came from
   * this very match — two records disagreeing about one bill. The way back is
   * another correction, which is an event rather than an erasure, the same rule
   * a movement follows.
   */
  const existing = await tx
    .select({
      id: schema.productionRunBillAllocations.id,
      correctedCents: schema.productionRunBillAllocations.correctedCents,
    })
    .from(schema.productionRunBillAllocations)
    .where(
      and(
        eq(schema.productionRunBillAllocations.tenantId, ctx.tenantId),
        eq(schema.productionRunBillAllocations.billLineId, input.billLineId),
      ),
    );
  if (existing.some((a) => a.correctedCents !== 0)) {
    throw new ProductionError(
      "BILL_INVALID",
      "the meat's cost has already been moved to match this bill, so unpicking it would leave the two disagreeing — correct the cost back first",
    );
  }

  const dropped = await tx
    .delete(schema.productionRunBillAllocations)
    .where(
      and(
        eq(schema.productionRunBillAllocations.tenantId, ctx.tenantId),
        eq(schema.productionRunBillAllocations.billLineId, input.billLineId),
      ),
    )
    .returning({ id: schema.productionRunBillAllocations.id });

  // The sibling's amount comes home, so the bill still totals the invoice.
  const varianceDescription = varianceDescriptionFor(line.description);
  const siblings = await tx
    .delete(schema.billLines)
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.billId, line.billId),
        eq(schema.billLines.description, varianceDescription),
      ),
    )
    .returning({ amountCents: schema.billLines.amountCents });
  const returned = siblings.reduce((sum, r) => sum + r.amountCents, 0);

  await tx
    .update(schema.billLines)
    .set({ accountId: null, amountCents: line.amountCents + returned })
    .where(
      and(
        eq(schema.billLines.tenantId, ctx.tenantId),
        eq(schema.billLines.id, input.billLineId),
      ),
    );

  return { released: dropped.length };
}

/** A run whose bill disagreed with its accrual, with the meat not yet moved. */
export interface UnmovedCost {
  runId: string;
  runCode: string;
  startedOn: string;
  processorName: string | null;
  /** Σ accrued across the bill lines that settled it. */
  accruedCents: number;
  /** Σ what those lines actually charged. */
  billedCents: number;
  /** Signed, and never zero on a row that is listed. */
  movedCents: number;
}

/**
 * **RUNS WHOSE BILL DISAGREED, WHERE NOBODY HAS MOVED THE MEAT'S COST YET.**
 *
 * The third question the reconciliation asks, and the only one that is an OFFER
 * rather than an obligation: the books are already right — matching put the
 * difference on the P&L — and this is about whether the batch should carry it
 * too. A farm that never presses it is not wrong, which is why this is a list
 * and not a warning.
 */
export async function runsWithUnmovedCost(
  tx: Tx,
  tenantId: string,
): Promise<UnmovedCost[]> {
  const allocations = await tx
    .select({
      runId: schema.productionRunBillAllocations.runId,
      accruedCents: schema.productionRunBillAllocations.accruedCents,
      billedCents: schema.productionRunBillAllocations.billedCents,
      correctedCents: schema.productionRunBillAllocations.correctedCents,
    })
    .from(schema.productionRunBillAllocations)
    .where(eq(schema.productionRunBillAllocations.tenantId, tenantId));
  if (allocations.length === 0) return [];

  const byRun = new Map<
    string,
    { accrued: number; billed: number; moved: number }
  >();
  for (const a of allocations) {
    const row = byRun.get(a.runId) ?? { accrued: 0, billed: 0, moved: 0 };
    row.accrued += a.accruedCents;
    row.billed += a.billedCents;
    row.moved += a.billedCents - a.accruedCents - a.correctedCents;
    byRun.set(a.runId, row);
  }
  const wanted = [...byRun.entries()].filter(([, v]) => v.moved !== 0);
  if (wanted.length === 0) return [];

  const runs = await tx.query.productionRuns.findMany({
    where: and(
      eq(schema.productionRuns.tenantId, tenantId),
      inArray(
        schema.productionRuns.id,
        wanted.map(([id]) => id),
      ),
    ),
    columns: { id: true, code: true, startedOn: true, processorId: true },
  });
  const names = await processorNames(
    tx,
    tenantId,
    runs.map((r) => r.processorId).filter((id): id is string => id !== null),
  );

  return runs
    .map((run) => {
      const v = byRun.get(run.id)!;
      return {
        runId: run.id,
        runCode: run.code,
        startedOn: run.startedOn,
        processorName: run.processorId
          ? (names.get(run.processorId) ?? null)
          : null,
        accruedCents: v.accrued,
        billedCents: v.billed,
        movedCents: v.moved,
      };
    })
    .sort((a, b) => a.startedOn.localeCompare(b.startedOn));
}

export interface RunCostCorrection {
  /** Signed cents the meat's cost moved by. Negative means the plant billed less. */
  movedCents: number;
  /** How many output batches carried a share of it. */
  lots: number;
}

/**
 * **MOVE THE MEAT'S COST TO WHAT THE PLANT ACTUALLY BILLED.** The second,
 * deliberate half, and it is deliberately not automatic.
 *
 * Matching books the difference to the P&L and leaves the batch carrying what it
 * landed with, because by the time a plant invoices, the meat is frequently sold
 * — and restating a batch's value every time a bill is $11 out, with nobody
 * asked, is not a decision software should make. This is the act somebody takes
 * when the difference is worth carrying onto the product.
 *
 * **IT IS `adjustLotCost` PER OUTPUT BATCH, AND THAT DOES THE HARD PART**: a
 * correction lands partly on stock still on the shelf, which raises its carrying
 * value, and partly on stock already issued, which is expensed — because
 * capitalising it would put an asset back on the balance sheet for meat that has
 * been eaten. The split is stored there, not re-derived here.
 *
 * **IDEMPOTENT BY `corrected_cents`.** Each allocation records how much of its
 * variance has already been pushed onto the meat, so pressing twice moves
 * nothing the second time and the screen can say whether it has been done.
 *
 * Apportioned across the run's outputs **by what each landed carrying**, the
 * same basis the original roll used — so the batch that took the biggest share
 * of the fee takes the biggest share of the correction to it.
 */
export async function correctRunCost(
  tx: Tx,
  ctx: ProductionCtx,
  input: { runId: string; occurredOn: string; notes?: string },
): Promise<RunCostCorrection> {
  requireWrite(ctx, "owner");

  const allocations = await tx
    .select({
      id: schema.productionRunBillAllocations.id,
      accruedCents: schema.productionRunBillAllocations.accruedCents,
      billedCents: schema.productionRunBillAllocations.billedCents,
      correctedCents: schema.productionRunBillAllocations.correctedCents,
      billLineId: schema.productionRunBillAllocations.billLineId,
    })
    .from(schema.productionRunBillAllocations)
    .where(
      and(
        eq(schema.productionRunBillAllocations.tenantId, ctx.tenantId),
        eq(schema.productionRunBillAllocations.runId, input.runId),
      ),
    );
  if (allocations.length === 0) {
    throw new ProductionError(
      "BILL_INVALID",
      "no bill has been matched to this one yet, so there is nothing to move the cost to",
    );
  }

  const outstanding = allocations.map((a) => ({
    ...a,
    move: a.billedCents - a.accruedCents - a.correctedCents,
  }));
  const movedCents = outstanding.reduce((sum, a) => sum + a.move, 0);
  if (movedCents === 0) {
    throw new ProductionError(
      "BILL_INVALID",
      "the meat already carries what the plant billed — there is nothing to move",
    );
  }

  /**
   * **ONLY BATCHES THAT LANDED CARRYING SOMETHING.** An output that landed with
   * no cost — a run whose basis was `none`, where the units could not be
   * compared — has nothing for a correction to be a proportion of, and putting
   * the whole difference on one arbitrary batch would be worse than reporting
   * that it could not be done.
   */
  const outputs = await tx.query.productionRunOutputs.findMany({
    where: and(
      eq(schema.productionRunOutputs.tenantId, ctx.tenantId),
      eq(schema.productionRunOutputs.runId, input.runId),
    ),
    columns: { id: true, lotId: true, inventoryMovementId: true },
  });
  const landed = outputs.filter(
    (o) => o.lotId !== null && o.inventoryMovementId !== null,
  );
  if (landed.length === 0) {
    throw new ProductionError(
      "BILL_INVALID",
      "nothing came out of this one that is on a shelf, so there is no batch to move a cost onto",
    );
  }

  const movements = await tx.query.inventoryMovements.findMany({
    where: and(
      eq(schema.inventoryMovements.tenantId, ctx.tenantId),
      inArray(
        schema.inventoryMovements.id,
        landed.map((o) => o.inventoryMovementId as string),
      ),
    ),
    columns: { id: true, costCents: true },
  });
  const costByMovement = new Map(movements.map((m) => [m.id, m.costCents ?? 0]));

  const shares = landed.map((o) => ({
    key: o.lotId as string,
    basis: costByMovement.get(o.inventoryMovementId as string) ?? 0,
  }));
  // `rollCents` needs a positive pot; a plant that billed LESS moves the cost
  // down, so the magnitude is split and the sign put back on each share.
  const split = rollCents(
    Math.abs(movedCents),
    shares,
  );
  if (split.size === 0) {
    throw new ProductionError(
      "BILL_INVALID",
      "what came out of this one landed carrying nothing, so there is no share for a correction to follow",
    );
  }

  const sign = movedCents < 0 ? -1 : 1;
  let lots = 0;
  for (const [lotId, amount] of split) {
    if (amount === 0) continue;
    await adjustLotCost(tx, ctx, {
      lotId,
      amountCents: sign * amount,
      reason: "processing_bill",
      occurredOn: input.occurredOn,
      notes:
        input.notes ??
        "What the plant billed, against what was accrued when the run finished",
    });
    lots += 1;
  }

  for (const a of outstanding) {
    if (a.move === 0) continue;
    await tx
      .update(schema.productionRunBillAllocations)
      .set({ correctedCents: a.correctedCents + a.move })
      .where(
        and(
          eq(schema.productionRunBillAllocations.tenantId, ctx.tenantId),
          eq(schema.productionRunBillAllocations.id, a.id),
        ),
      );
  }

  return { movedCents, lots };
}
