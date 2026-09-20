import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { upsertDimensionMembers } from "@/modules/accounting/core";
import { codeLabel, JobsError, requireWrite, type JobsCtx } from "./ops";
import { COST_CODE_DIMENSION } from "./vocabulary";
import { planImport, type ImportPlan, type ParsedCostCode } from "./cost-code-import";

/**
 * WRITING A PASTED COST CODE LIST.
 *
 * ── ONE STATEMENT, NOT TWO HUNDRED AND NINETY-ONE ───────────────────────────
 *
 * The pilot's chart is 291 rows and each one is two writes — the code, and the
 * cost object Accounting charges against it. Done a row at a time that is
 * nearly six hundred round trips inside one transaction, which on Neon is a
 * timeout rather than a wait. Both halves are a single upsert.
 *
 * ── NOTHING IS DELETED AND NOTHING IS SWITCHED OFF ──────────────────────────
 *
 * A code already in the set that the paste does not mention is left exactly
 * as it is. It may have a year of costs posted against it, and a paste that
 * adds three rows must never read as an instruction to retire forty. Retiring
 * a code is its own deliberate act, and it already exists.
 *
 * ── A FULL LIST SETS THE ORDER; A PARTIAL ONE ADDS TO THE END ───────────────
 *
 * Order is load-bearing here (`cost-code-import.ts` has the reason: a chart
 * numbered `03.95, 03.100` sorts wrongly as text, so `sort_order` is the only
 * thing holding it). But renumbering a whole chart because somebody pasted
 * three new rows would be a surprise. So the paste decides the order **only
 * when it covers every code already in the set** — the re-paste and
 * first-import case — and otherwise new codes go on the end in the order they
 * were pasted.
 */

export interface ImportResult extends ImportPlan {
  /** Whether the paste set the order of the whole list, and why. */
  reordered: boolean;
  written: number;
}

export async function importCostCodes(
  tx: Tx,
  ctx: JobsCtx,
  setId: string,
  parsed: readonly ParsedCostCode[],
): Promise<ImportResult> {
  requireWrite(ctx, "owner");

  const set = await tx
    .select({ id: schema.jobCostCodeSets.id })
    .from(schema.jobCostCodeSets)
    .where(
      and(
        eq(schema.jobCostCodeSets.tenantId, ctx.tenantId),
        eq(schema.jobCostCodeSets.id, setId),
      ),
    )
    .limit(1);
  if (!set[0]) throw new JobsError("NOT_FOUND", "that cost code list is no longer here");

  const existing = await tx
    .select({
      id: schema.jobCostCodes.id,
      code: schema.jobCostCodes.code,
      name: schema.jobCostCodes.name,
      category: schema.jobCostCodes.category,
      sortOrder: schema.jobCostCodes.sortOrder,
    })
    .from(schema.jobCostCodes)
    .where(
      and(
        eq(schema.jobCostCodes.tenantId, ctx.tenantId),
        eq(schema.jobCostCodes.setId, setId),
      ),
    );

  const plan = planImport(parsed, existing);
  if (parsed.length === 0) return { ...plan, reordered: false, written: 0 };

  const mentioned = new Set(parsed.map((p) => p.code.toLowerCase()));
  const reordered = existing.every((e) => mentioned.has(e.code.trim().toLowerCase()));

  const byCode = new Map(existing.map((e) => [e.code.trim().toLowerCase(), e]));
  const highest = existing.reduce((n, e) => Math.max(n, e.sortOrder), 0);
  let appendAt = highest;

  const values = parsed.map((row, i) => {
    const was = byCode.get(row.code.toLowerCase());
    let sortOrder: number;
    if (reordered) {
      sortOrder = (i + 1) * 10;
    } else if (was) {
      sortOrder = was.sortOrder;
    } else {
      appendAt += 10;
      sortOrder = appendAt;
    }
    return {
      tenantId: ctx.tenantId,
      setId,
      code: row.code,
      name: row.name,
      category: row.category,
      sortOrder,
    };
  });

  /**
   * **ONE UPSERT FOR BOTH HALVES OF THE JOB.** The unique index on
   * `(tenant, set, code)` is what makes a re-paste an update rather than a
   * conflict, so importing the same list twice is safe and says so in the
   * preview. `is_active` and `notes` are deliberately NOT touched: a code
   * somebody retired stays retired, and a note somebody wrote survives a
   * re-import of the list it is on.
   */
  const written = await tx
    .insert(schema.jobCostCodes)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.jobCostCodes.tenantId, schema.jobCostCodes.setId, schema.jobCostCodes.code],
      set: {
        name: sql`excluded.name`,
        category: sql`excluded.category`,
        sortOrder: sql`excluded.sort_order`,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: schema.jobCostCodes.id,
      code: schema.jobCostCodes.code,
      name: schema.jobCostCodes.name,
      isActive: schema.jobCostCodes.isActive,
    });

  /**
   * THE COST OBJECT FOLLOWS THE CODE — the same rule `updateCostCode` states,
   * and the reason a code is usable on a bill the moment it is imported. A
   * code that was already RETIRED keeps its member archived: reviving it is a
   * decision, not a side effect of pasting a list it happens to appear on.
   */
  await upsertDimensionMembers(
    tx,
    ctx,
    COST_CODE_DIMENSION,
    written.filter((c) => c.isActive).map((c) => ({
      packEntityId: c.id,
      displayName: codeLabel(c),
    })),
  );

  return { ...plan, reordered, written: written.length };
}
