"use server";

import { revalidatePath } from "next/cache";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem, schema } from "@/db";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { upsertTenantFromOrg } from "@/lib/tenant-sync";

/** All actions here re-verify superadmin server-side before touching data. */

const toggleModuleSchema = z.object({
  tenantId: z.string().uuid(),
  moduleId: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export async function toggleModule(input: z.infer<typeof toggleModuleSchema>) {
  const { userId } = await requireSuperAdmin();
  const parsed = toggleModuleSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { tenantId, moduleId, enabled } = parsed.data;

  await withSystem(async (tx) => {
    const existing = await tx.query.tenantModules.findFirst({
      where: and(
        eq(schema.tenantModules.tenantId, tenantId),
        eq(schema.tenantModules.moduleId, moduleId),
      ),
    });
    if (existing) {
      await tx
        .update(schema.tenantModules)
        .set({
          enabled,
          enabledAt: enabled ? new Date() : existing.enabledAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.tenantModules.id, existing.id));
    } else {
      await tx.insert(schema.tenantModules).values({
        tenantId,
        moduleId,
        enabled,
        enabledAt: enabled ? new Date() : null,
      });
    }
  });

  await logAudit({
    action: enabled ? "module.enabled" : "module.disabled",
    tenantId,
    actorClerkUserId: userId,
    targetType: "module",
    targetId: moduleId,
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin");
  return { ok: true };
}

const setStatusSchema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(["prospect", "onboarding", "active", "paused", "churned"]),
});

export async function setTenantStatus(
  input: z.infer<typeof setStatusSchema>,
) {
  const { userId } = await requireSuperAdmin();
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  await withSystem((tx) =>
    tx
      .update(schema.tenants)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(schema.tenants.id, parsed.data.tenantId)),
  );

  await logAudit({
    action: "tenant.status_changed",
    tenantId: parsed.data.tenantId,
    actorClerkUserId: userId,
    meta: { status: parsed.data.status },
  });

  revalidatePath(`/admin/tenants/${parsed.data.tenantId}`);
  revalidatePath("/admin");
  return { ok: true };
}

const addNoteSchema = z.object({
  tenantId: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
});

export async function addTenantNote(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = addNoteSchema.safeParse({
    tenantId: formData.get("tenantId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { error: "Note can't be empty" };

  await withSystem((tx) =>
    tx.insert(schema.tenantNotes).values({
      tenantId: parsed.data.tenantId,
      authorClerkUserId: userId,
      body: parsed.data.body,
    }),
  );

  revalidatePath(`/admin/tenants/${parsed.data.tenantId}`);
  return { ok: true };
}

const createClientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  industry: z.string().trim().min(1).max(64),
  ownerEmail: z.string().trim().email().optional().or(z.literal("")),
});

/**
 * Owner-initiated onboarding: create the Clerk org (source of truth), sync
 * the tenant row, optionally invite the client's owner by email.
 */
export async function createClientBusiness(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = createClientSchema.safeParse({
    name: formData.get("name"),
    industry: formData.get("industry"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const client = await clerkClient();
  const me = await currentUser();

  let org;
  try {
    org = await client.organizations.createOrganization({
      name: parsed.data.name,
      createdBy: me?.id,
    });
  } catch (err) {
    console.error("clerk org creation failed", err);
    return { error: "Could not create the organization in Clerk." };
  }

  const tenant = await upsertTenantFromOrg({
    id: org.id,
    name: parsed.data.name,
    slug: org.slug,
  });

  await withSystem((tx) =>
    tx
      .update(schema.tenants)
      .set({ industry: parsed.data.industry, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenant.id)),
  );

  if (parsed.data.ownerEmail) {
    try {
      await client.organizations.createOrganizationInvitation({
        organizationId: org.id,
        emailAddress: parsed.data.ownerEmail,
        role: "org:admin",
        inviterUserId: me?.id,
      });
    } catch (err) {
      console.error("clerk invitation failed", err);
      // Tenant still created; surface a soft warning.
      return {
        ok: true,
        tenantId: tenant.id,
        warning: "Client created, but the email invitation failed to send.",
      };
    }
  }

  await logAudit({
    action: "tenant.created",
    tenantId: tenant.id,
    actorClerkUserId: userId,
    actorLabel: "admin-console",
    meta: { invited: parsed.data.ownerEmail || null },
  });

  revalidatePath("/admin");
  return { ok: true, tenantId: tenant.id };
}
