"use server";

import { revalidatePath } from "next/cache";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem, schema } from "@/db";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { slugify } from "@/lib/slug";
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
  kind: z.enum(["prospect", "client"]).default("prospect"),
  contactName: z.string().trim().max(120).optional().or(z.literal("")),
  ownerEmail: z.string().trim().email().optional().or(z.literal("")),
});

/**
 * Add a business to the CRM. As a "prospect" it's a CRM-only record (no
 * Clerk org, no platform access) — the discovery stage. As a "client" it
 * gets its Clerk organization immediately and the owner can be invited.
 */
export async function createClientBusiness(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = createClientSchema.safeParse({
    name: formData.get("name"),
    industry: formData.get("industry"),
    kind: formData.get("kind") ?? "prospect",
    contactName: formData.get("contactName"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  if (parsed.data.kind === "prospect") {
    const base = slugify(parsed.data.name);
    const tenant = await withSystem(async (tx) => {
      let slug = base;
      for (let i = 2; ; i++) {
        const clash = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.slug, slug),
        });
        if (!clash) break;
        slug = `${base}-${i}`;
      }
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: null,
          name: parsed.data.name,
          slug,
          industry: parsed.data.industry,
          status: "prospect",
          contactName: parsed.data.contactName || null,
          contactEmail: parsed.data.ownerEmail || null,
        })
        .returning();
      await tx
        .insert(schema.subscriptions)
        .values({ tenantId: row.id })
        .onConflictDoNothing();
      return row;
    });

    await logAudit({
      action: "prospect.created",
      tenantId: tenant.id,
      actorClerkUserId: userId,
      actorLabel: "admin-console",
    });

    revalidatePath("/admin");
    return { ok: true, tenantId: tenant.id };
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
      .set({
        industry: parsed.data.industry,
        contactName: parsed.data.contactName || null,
        contactEmail: parsed.data.ownerEmail || null,
        updatedAt: new Date(),
      })
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

const convertSchema = z.object({
  tenantId: z.string().uuid(),
  ownerEmail: z.string().trim().email().optional().or(z.literal("")),
});

/**
 * Prospect → client: create the Clerk organization and attach it to the
 * SAME CRM row, so audits, notes, and history stay connected.
 */
export async function convertProspectToClient(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = convertSchema.safeParse({
    tenantId: formData.get("tenantId"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, parsed.data.tenantId),
    }),
  );
  if (!tenant) return { error: "Business not found" };
  if (tenant.clerkOrgId) return { error: "Already a client." };

  const client = await clerkClient();
  const me = await currentUser();

  let org;
  try {
    org = await client.organizations.createOrganization({
      name: tenant.name,
      createdBy: me?.id,
    });
  } catch (err) {
    console.error("clerk org creation failed", err);
    return { error: "Could not create the organization in Clerk." };
  }

  // Attach immediately so the org.created webhook's upsert finds this row
  // by clerkOrgId instead of creating a duplicate.
  await withSystem((tx) =>
    tx
      .update(schema.tenants)
      .set({
        clerkOrgId: org.id,
        status: "onboarding",
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, tenant.id)),
  );

  const invite = parsed.data.ownerEmail || tenant.contactEmail;
  let warning: string | undefined;
  if (invite) {
    try {
      await client.organizations.createOrganizationInvitation({
        organizationId: org.id,
        emailAddress: invite,
        role: "org:admin",
        inviterUserId: me?.id,
      });
    } catch (err) {
      console.error("clerk invitation failed", err);
      warning = "Converted, but the email invitation failed to send.";
    }
  }

  await logAudit({
    action: "prospect.converted",
    tenantId: tenant.id,
    actorClerkUserId: userId,
    meta: { invited: invite || null },
  });

  revalidatePath(`/admin/tenants/${tenant.id}`);
  revalidatePath("/admin");
  return { ok: true, warning };
}
