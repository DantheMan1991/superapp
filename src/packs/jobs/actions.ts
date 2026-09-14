"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  createCostCode,
  createCostCodeSet,
  createProject,
  JobsError,
  setDefaultCostCodeSet,
  updateProject,
  type JobsCtx,
} from "./ops";
import { PACK, PROJECT_STATUSES } from "./vocabulary";

/**
 * The jobs write surface.
 *
 * Every action does the three things AGENTS.md requires of a pack: it
 * re-verifies the tenant server-side, checks the pack is switched ON, and works
 * inside `withTenant` with the caller's OWN role, so RLS and the pack's
 * decision-or-chore rule both apply. The role is never taken from the client and
 * never widened — `{ role: ctx.role }` is passed through so a policy that can
 * tell an owner from staff sees the truth.
 */

const BASE = "/dashboard/m/jobs";

async function gate(): Promise<JobsCtx> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  return {
    tenantId: tenant.tenant.id,
    userId: tenant.userId,
    role: tenant.role,
  };
}

/** A JobsError as the flat shape every form here returns. */
function toResult(err: unknown): { error: string } {
  if (err instanceof JobsError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change a project." };
      case "NOT_FOUND":
        return { error: "That project no longer exists." };
      case "INVALID_STATUS":
        return { error: "That is not something this project can do next." };
      case "INVALID_DELIVERY_METHOD":
        return {
          error:
            "A kind of work must be lowercase letters, numbers and underscores.",
        };
      case "NUMBER_TAKEN":
        return { error: "That job number is already in use. Pick another." };
      case "NAME_TAKEN":
        return { error: "A list with that name already exists." };
      case "SET_IN_USE":
        return { error: "Projects are budgeted against that list, so it cannot go." };
      case "STALE_VERSION":
        return {
          error: "Somebody changed this while you had it open. Reload and try again.",
        };
    }
  }
  /**
   * The unique indexes are the backstop for a duplicate number or list name,
   * and they are what speaks when two people save at once — the pre-check above
   * cannot see an uncommitted row. Translated here rather than left as a
   * Postgres string, because "duplicate key value violates unique constraint" is
   * not a sentence for a person.
   */
  const message = err instanceof Error ? err.message : "";
  if (message.includes("job_projects_tenant_number_idx")) {
    return { error: "That job number is already in use. Pick another." };
  }
  if (message.includes("job_cost_code_sets_tenant_name_idx")) {
    return { error: "A list with that name already exists." };
  }
  if (message.includes("job_cost_codes_set_code_idx")) {
    return { error: "That code is already in this list." };
  }
  console.error("jobs action failed", err);
  return { error: "Something went wrong. Try again." };
}

const optionalUuid = z
  .union([z.string().uuid(), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

const projectSchema = z.object({
  entityId: z.string().uuid(),
  number: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  status: z.enum(PROJECT_STATUSES).optional(),
  /**
   * Accepted as free text and checked for FORMAT only, never against a list —
   * ADR 0056. The suggestions a screen offers come from the installed profile.
   */
  deliveryMethod: z
    .union([z.string().trim().max(63), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  enterpriseId: optionalUuid,
  partyId: optionalUuid,
  costCodeSetId: optionalUuid,
  address: z.string().trim().max(300).optional(),
  startsOn: optionalDate,
  endsOn: optionalDate,
  notes: z.string().trim().max(2000).optional(),
});

export async function createProjectAction(input: unknown) {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const project = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createProject(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "project.created",
          targetType: "project",
          targetId: created.id,
          // Identifiers only, never the client's name or a value.
          meta: {
            number: created.number,
            deliveryMethod: created.deliveryMethod,
            entityId: created.entityId,
          },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(BASE);
    return { ok: true as const, projectId: project.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateProjectAction(input: unknown) {
  const schema = projectSchema.partial().extend({
    id: z.string().uuid(),
    version: z.number().int().positive().optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  const { id, ...patch } = parsed.data;
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const updated = await updateProject(tx, ctx, id, patch);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "project.updated",
          targetType: "project",
          targetId: updated.id,
          meta: { number: updated.number, status: updated.status },
        });
        return updated;
      },
      { role: ctx.role },
    );
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${id}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const costCodeSetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCostCodeSetAction(input: unknown) {
  const parsed = costCodeSetSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const set = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await createCostCodeSet(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "cost_code_set.created",
          targetType: "cost_code_set",
          targetId: created.id,
          meta: { isDefault: created.isDefault },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const, setId: set.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function setDefaultCostCodeSetAction(input: unknown) {
  const parsed = z.object({ setId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const set = await setDefaultCostCodeSet(tx, ctx, parsed.data.setId);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "cost_code_set.default_set",
          targetType: "cost_code_set",
          targetId: set.id,
        });
        return set;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const costCodeSchema = z.object({
  setId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  sortOrder: z.number().int().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCostCodeAction(input: unknown) {
  const parsed = costCodeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => createCostCode(tx, ctx, parsed.data),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/cost-codes`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}
