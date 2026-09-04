"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { CrmError, friendlyMessage, roleMayWrite} from "./core/errors";
import type { CrmCtx } from "./core/types";
import {
  FILTER_OPERATORS,
  MAX_CONDITIONS,
  SORT_FIELDS,
  VALUE_MAX,
  conditionProblem,
  type FilterCondition,
} from "./core/views";
import { VIEW_NAME_MAX, createView, deleteView, pinView, updateView } from "./view-ops";

/**
 * Saving, sharing and pinning list views.
 *
 * NOT OWNER-ONLY, unlike the merge and collaborator actions next door. A view
 * is somebody's own way of working — the equivalent of how they sort their
 * desk — and gating it on the business's owner would mean a rep cannot keep
 * "the accounts I am chasing" without asking permission. The expert
 * (accountant) role is still refused, because this module has no read-only-safe
 * writes.
 *
 * WHAT MAKES THAT SAFE IS THAT A VIEW IS A QUESTION, NOT DATA. Sharing one
 * discloses nothing: it runs in the reader's own transaction, where RLS has
 * already removed the rows they may not see. Anybody may therefore share a view
 * with the tenant without an owner vetting it first.
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
  console.error("crm view action failed", err);
  return { error: friendlyMessage(err) };
}

/**
 * Zod proves the SHAPE; `conditionProblem` decides whether the condition means
 * anything. Two validators, deliberately, and the split is the same one the
 * custom-field actions make: Zod cannot know that `starts_with` does not apply
 * to a date, because that lives in the field registry.
 */
const conditionSchema = z.object({
  field: z.string().max(60),
  operator: z.enum(FILTER_OPERATORS),
  value: z.string().max(VALUE_MAX),
});

const sortSchema = z.object({
  field: z.enum(SORT_FIELDS),
  direction: z.enum(["asc", "desc"]),
});

const saveSchema = z.object({
  name: z.string().trim().min(1).max(VIEW_NAME_MAX),
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS),
  sort: sortSchema,
  isShared: z.boolean(),
});

/** Refuse the whole save if any condition is nonsense, rather than dropping it. */
function checked(conditions: FilterCondition[]): FilterCondition[] {
  for (const condition of conditions) {
    const problem = conditionProblem(condition);
    if (problem) throw new CrmError("VIEW_FILTER_INVALID", problem);
  }
  return conditions;
}

export async function saveViewAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ viewId: string }>> {
  try {
    const ctx = await gate();
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const view = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createView(tx, ctx.tenantId, ctx.userId, {
          name: parsed.data.name,
          conditions: checked(parsed.data.conditions),
          sort: parsed.data.sort,
          isShared: parsed.data.isShared,
        });
        // Saving a view is choosing to work in it, so it becomes the one that
        // opens. Making somebody save it and then pin it would be two steps for
        // one intention.
        await pinView(tx, ctx.tenantId, ctx.userId, created.id);
        return created;
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    return { ok: true, data: { viewId: view.id } };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  viewId: z.string().uuid(),
  name: z.string().trim().min(1).max(VIEW_NAME_MAX).optional(),
  conditions: z.array(conditionSchema).max(MAX_CONDITIONS).optional(),
  sort: sortSchema.optional(),
  isShared: z.boolean().optional(),
});

export async function updateViewAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) =>
        updateView(tx, ctx.tenantId, parsed.data.viewId, {
          name: parsed.data.name,
          conditions: parsed.data.conditions
            ? checked(parsed.data.conditions)
            : undefined,
          sort: parsed.data.sort,
          isShared: parsed.data.isShared,
        }),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteViewAction(
  input: { viewId: string },
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = z.object({ viewId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => deleteView(tx, ctx.tenantId, parsed.data.viewId),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Which view opens by default, for this person.
 *
 * The id is NOT validated against anything here on purpose — `resolveView`
 * falls back when it names nothing, so a pin can survive the view being
 * deleted, unshared, or retired from the built-ins by a later release. Storing
 * an id that may stop resolving is the design, not an oversight.
 */
export async function pinViewAction(
  input: { viewId: string },
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = z
      .object({ viewId: z.string().min(1).max(120) })
      .safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      (tx) => pinView(tx, ctx.tenantId, ctx.userId, parsed.data.viewId),
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
