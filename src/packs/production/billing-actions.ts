"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { todayInTimezone } from "@/lib/timezone";
import { toResult } from "./action-errors";
import type { ProductionCtx } from "./ops";
import {
  correctRunCost,
  matchBillLineToRuns,
  unmatchBillLineFromRuns,
} from "./billing-ops";

/**
 * Settling what a plant charged.
 *
 * **AUDITED HARDER THAN THE REST OF THIS PACK, and for a reason the other
 * files do not have: every one of these moves money in the books.** Matching
 * decides which liability a bill clears, unpicking undoes it, and the cost
 * correction restates what a batch of meat is worth. The log carries
 * identifiers and figures — never the vendor's prose.
 *
 * **ALL THREE ARE OWNER**, checked again in `billing-ops.ts`. The pack rule is
 * *is this a decision or a chore*, and settling a supplier's invoice against a
 * processing day is the most decision-shaped thing this pack does.
 */

const PACK = "production";
const BASE = "/dashboard/m/production";

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): ProductionCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

export async function matchBillLineAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      billLineId: z.string().uuid(),
      runIds: z.array(z.string().uuid()).min(1).max(50),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => matchBillLineToRuns(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.bill.matched",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "bill_line",
      targetId: parsed.data.billLineId,
      meta: {
        runIds: parsed.data.runIds,
        accruedCents: result.accruedCents,
        varianceCents: result.varianceCents,
      },
    });
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/accounting", "layout");
    return { ok: true, ...result };
  } catch (err) {
    return toResult(err);
  }
}

export async function unmatchBillLineAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ billLineId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => unmatchBillLineFromRuns(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.bill.unmatched",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "bill_line",
      targetId: parsed.data.billLineId,
      meta: { released: result.released },
    });
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/accounting", "layout");
    return { ok: true, ...result };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Move the meat's cost to what the plant actually billed.
 *
 * **THE DATE IS TODAY AND IS NOT A FIELD.** A cost correction is an event that
 * happens when somebody decides it — `adjustLotCost` posts on the day it is
 * made, and backdating it would restate a period that may already be closed.
 * Read from the tenant's own timezone, like every other dated write here.
 */
export async function correctRunCostAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ runId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const occurredOn = todayInTimezone(ctx.tenant.timezone);
    const result = await withTenant(
      ctx.tenant.id,
      (tx) =>
        correctRunCost(tx, ctxOf(ctx), {
          runId: parsed.data.runId,
          occurredOn,
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "production.bill.cost_corrected",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: parsed.data.runId,
      meta: { movedCents: result.movedCents, lots: result.lots, occurredOn },
    });
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/inventory", "layout");
    return { ok: true, ...result };
  } catch (err) {
    return toResult(err);
  }
}
