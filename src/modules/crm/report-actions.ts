"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { CrmError, friendlyMessage, roleMayWrite} from "./core/errors";
import type { CrmCtx } from "./core/types";
import { REPORT_TYPE_IDS, parseDefinition } from "./core/reports";
import { FILTER_OPERATORS, MAX_CONDITIONS, VALUE_MAX } from "./core/views";
import {
  REPORT_NAME_MAX,
  createReport,
  deleteReport,
  updateReport,
} from "./report-ops";

/**
 * Saving, sharing and deleting reports.
 *
 * NOT OWNER-ONLY, like the saved-view actions and for the same reason: a report
 * is a question somebody wanted to keep asking, and gating it on the business's
 * owner would mean a rep cannot keep "my pipeline" without permission. The
 * expert (accountant) role is still refused, because this module has no
 * read-only-safe writes.
 *
 * Sharing discloses nothing. A report runs in the reader's own transaction, so
 * two people opening one shared report get different totals — correctly — and
 * nobody needs to vet a report before it is shared.
 */

const BASE = "/dashboard/m/crm";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  if (!roleMayWrite(ctx.role)) {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof CrmError) return { error: friendlyMessage(err) };
  console.error("crm report action failed", err);
  return { error: friendlyMessage(err) };
}

/**
 * Zod proves the shape; `parseDefinition` decides what it means.
 *
 * The two are not redundant. Zod cannot know that `deal_stage` is a grouping
 * only the deal type offers, or that `starts_with` does not apply to a date —
 * those live in the registries, and `parseDefinition` drops whatever does not
 * survive them rather than storing a definition that cannot run.
 */
const definitionSchema = z.object({
  type: z.enum(REPORT_TYPE_IDS),
  filter: z
    .array(
      z.object({
        field: z.string().max(60),
        operator: z.enum(FILTER_OPERATORS),
        value: z.string().max(VALUE_MAX),
      }),
    )
    .max(MAX_CONDITIONS),
  groupBy: z.string().max(60).nullable(),
  measure: z.string().max(60),
  showDetail: z.boolean(),
  chart: z.enum(["none", "bar"]),
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(REPORT_NAME_MAX),
  definition: definitionSchema,
  isShared: z.boolean(),
});

export async function saveReportAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ reportId: string }>> {
  try {
    const ctx = await gate();
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const report = await withTenant(
      ctx.tenantId,
      (tx) =>
        createReport(tx, ctx.tenantId, ctx.userId, {
          name: parsed.data.name,
          definition: parseDefinition(parsed.data.definition),
          isShared: parsed.data.isShared,
        }),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/reports`);
    return { ok: true, data: { reportId: report.id } };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  reportId: z.string().uuid(),
  name: z.string().trim().min(1).max(REPORT_NAME_MAX).optional(),
  definition: definitionSchema.optional(),
  isShared: z.boolean().optional(),
});

export async function updateReportAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) =>
        updateReport(tx, ctx.tenantId, parsed.data.reportId, {
          name: parsed.data.name,
          definition: parsed.data.definition
            ? parseDefinition(parsed.data.definition)
            : undefined,
          isShared: parsed.data.isShared,
        }),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/reports`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteReportAction(input: {
  reportId: string;
}): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = z.object({ reportId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => deleteReport(tx, ctx.tenantId, parsed.data.reportId),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/reports`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
