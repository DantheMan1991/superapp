"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  EnterpriseError,
  archiveEnterprise,
  createEnterprise,
  restoreEnterprise,
  updateEnterprise,
} from "@/lib/enterprises";

/**
 * The enterprise list's write surface.
 *
 * **OWNER-ONLY, AND IT IS `requireTenantOwner` RATHER THAN A ROLE CHECK IN THE
 * BODY.** Creating one syncs a `dimension_members` row, and
 * `upsertDimensionMember` calls `requireOwnerRole` itself — so a staff caller
 * would fail deep inside core with an error written for a developer. Refusing
 * at the door gives the person a redirect instead of a stack trace, and the
 * inner check stays as the backstop it was written to be.
 *
 * Not `requireModuleEnabled`: an enterprise is Layer 0, like a party. Four packs
 * name one and none of them owns it, so gating on any single pack would hide
 * the list from a farm that had switched that pack off.
 */

const BASE = "/dashboard/settings/enterprises";

function toResult(err: unknown): { error: string } {
  if (err instanceof EnterpriseError) {
    switch (err.code) {
      // Every one of these is written for a person where it is thrown, and each
      // names the thing to do about it. Flattening them to one apology would
      // lose the only useful part.
      case "NOT_FOUND":
      case "NAME_TAKEN":
      case "INVALID_NAME":
      case "INVALID_KIND":
        return { error: err.message };
    }
  }
  console.error("enterprise action failed", err);
  return { error: "Something went wrong saving that." };
}

const enterpriseSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(63).optional(),
  notes: z.string().max(5000).optional(),
});

export async function createEnterpriseAction(input: unknown) {
  const ctx = await requireTenantOwner();
  const parsed = enterpriseSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const enterprise = await withTenant(
      ctx.tenant.id,
      (tx) =>
        createEnterprise(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
          parsed.data,
        ),
      { role: ctx.role },
    );
    await logAudit({
      action: "enterprise.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "enterprise",
      targetId: enterprise.id,
      // Identifiers and the handle, never the notes.
      meta: { slug: enterprise.slug, kind: enterprise.kind },
    });
    revalidatePath(BASE);
    return { ok: true, id: enterprise.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateEnterpriseAction(input: unknown) {
  const ctx = await requireTenantOwner();
  const parsed = enterpriseSchema
    .partial()
    .extend({ id: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        updateEnterprise(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
          id,
          patch,
        ),
      { role: ctx.role },
    );
    await logAudit({
      action: "enterprise.updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "enterprise",
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    // `layout`, because the name is copied into `dimension_members` and every
    // report that groups by enterprise reads that copy.
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function archiveEnterpriseAction(input: unknown) {
  return setStatus(input, "archived");
}

export async function restoreEnterpriseAction(input: unknown) {
  return setStatus(input, "active");
}

async function setStatus(input: unknown, status: "active" | "archived") {
  const ctx = await requireTenantOwner();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => {
        const ledgerCtx = {
          tenantId: ctx.tenant.id,
          userId: ctx.userId,
          role: ctx.role,
        };
        return status === "archived"
          ? archiveEnterprise(tx, ledgerCtx, parsed.data.id)
          : restoreEnterprise(tx, ledgerCtx, parsed.data.id);
      },
      { role: ctx.role },
    );
    await logAudit({
      action: status === "archived" ? "enterprise.archived" : "enterprise.restored",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "enterprise",
      targetId: parsed.data.id,
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
