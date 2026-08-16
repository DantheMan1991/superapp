"use server";

import { revalidatePath } from "next/cache";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem, withTenant, schema } from "@/db";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { uniqueTenantSlug } from "@/lib/slug";
import { upsertTenantFromOrg } from "@/lib/tenant-sync";
import { provisionAccounting } from "@/modules/accounting/templates/apply";
import { provisionDocuments } from "@/modules/documents/templates/apply";
import { dependencyGraph, getFeature } from "@/lib/features";
import { getIndustryProfile } from "@/industries";
import {
  blockingDependents,
  installOrder,
  missingRequirements,
  unlistedRequirements,
} from "@/lib/packs/resolve";

/** All actions here re-verify superadmin server-side before touching data. */

/** Slugs currently switched on for a tenant. */
async function enabledSlugs(tenantId: string): Promise<string[]> {
  const rows = await withSystem((tx) =>
    tx
      .select({ moduleId: schema.tenantModules.moduleId })
      .from(schema.tenantModules)
      .where(
        and(
          eq(schema.tenantModules.tenantId, tenantId),
          eq(schema.tenantModules.enabled, true),
        ),
      ),
  );
  return rows.map((r) => r.moduleId);
}

/** Display name for an error message, falling back to the slug. */
function featureName(slug: string): string {
  return getFeature(slug)?.name ?? slug;
}

/** Enable one feature for one tenant, idempotently. Caller supplies the tx. */
/** Returns whether this actually CHANGED anything, so a caller can say so. */
async function enableRow(
  tx: Parameters<Parameters<typeof withSystem>[0]>[0],
  tenantId: string,
  moduleId: string,
  enabled: boolean,
): Promise<boolean> {
  const existing = await tx.query.tenantModules.findFirst({
    where: and(
      eq(schema.tenantModules.tenantId, tenantId),
      eq(schema.tenantModules.moduleId, moduleId),
    ),
  });
  const changed = existing ? existing.enabled !== enabled : true;
  if (existing) {
    await tx
      .update(schema.tenantModules)
      .set({
        enabled,
        // Matches the behaviour this helper was extracted from: re-enabling
        // restamps the date. Deliberately unchanged — the admin matrix shows
        // this value, and quietly redefining it during a refactor would make
        // every historical tooltip mean something new.
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
  return changed;
}

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

  // Dependency check BEFORE anything else, including provisioning — a refused
  // toggle must leave no trace. Enforced only here, at the moment of enabling:
  // a request that has already reached a pack's page is far too late to learn
  // its dependency is missing, and a check there would be a crash dressed as a
  // guard. See src/packs/types.ts.
  const graph = dependencyGraph();
  const on = await enabledSlugs(tenantId);
  if (enabled) {
    const missing = missingRequirements(moduleId, on, graph);
    if (missing.length > 0) {
      return {
        error: `${featureName(moduleId)} needs ${missing.map(featureName).join(" and ")} switched on first.`,
      };
    }
  } else {
    const dependents = blockingDependents(moduleId, on, graph);
    if (dependents.length > 0) {
      return {
        error: `${dependents.map(featureName).join(" and ")} still need ${featureName(moduleId)}. Switch those off first.`,
      };
    }
  }

  // Provision BEFORE enabling, so an enabled-but-unprovisioned module is
  // unrepresentable. Idempotent, and runs as the tenant (withTenant) — the
  // rule is that withSystem never writes accounting rows.
  let provisioned: { accountsCreated: number } | undefined;
  if (moduleId === "accounting" && enabled) {
    try {
      provisioned = await withTenant(tenantId, (tx) =>
        provisionAccounting(tx, tenantId),
      );
    } catch (err) {
      console.error("accounting provisioning failed", err);
      return { error: "Could not provision the accounting module." };
    }
  }

  // Documents provisions under withSystem, not withTenant: document_settings is
  // member_read-only by policy (platform-governed knobs), so a tenant-context
  // insert would be denied by design. See templates/apply.ts.
  let provisionedDocs: { foldersCreated: number } | undefined;
  if (moduleId === "documents" && enabled) {
    try {
      provisionedDocs = await withSystem((tx) =>
        provisionDocuments(tx, tenantId),
      );
    } catch (err) {
      console.error("documents provisioning failed", err);
      return { error: "Could not provision the documents module." };
    }
  }

  await withSystem((tx) => enableRow(tx, tenantId, moduleId, enabled));

  await logAudit({
    action: enabled ? "module.enabled" : "module.disabled",
    tenantId,
    actorClerkUserId: userId,
    targetType: "module",
    targetId: moduleId,
    meta: provisioned ? { accountsCreated: provisioned.accountsCreated } : {},
  });
  if (provisioned) {
    await logAudit({
      action: "coa.template_applied",
      tenantId,
      actorClerkUserId: userId,
      targetType: "module",
      targetId: moduleId,
      meta: { accountsCreated: provisioned.accountsCreated },
    });
  }
  if (provisionedDocs) {
    await logAudit({
      action: "documents.provisioned",
      tenantId,
      actorClerkUserId: userId,
      targetType: "module",
      targetId: moduleId,
      meta: { foldersCreated: provisionedDocs.foldersCreated },
    });
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin");
  return { ok: true };
}

const installProfileSchema = z.object({
  tenantId: z.string().uuid(),
  profileSlug: z.string().min(1).max(64),
});

/**
 * Apply an industry profile to a tenant.
 *
 * INSTALLS, IT DOES NOT BIND (ADR 0009). This enables the profile's packs and
 * stamps `tenants.industry`; from that moment the tenant's pack set is its own
 * and divergence from the manifest is expected, not a fault. Re-running is
 * safe and additive — it never switches anything off, because a pack the
 * tenant deliberately disabled is a decision, not drift to repair.
 *
 * NOT YET DOING: applying `profile.seed` (chart of accounts, folders, doc
 * kinds). That is the next slice and needs a farm chart of accounts written
 * first. Deliberately shipped in two steps rather than half-seeding.
 */
export async function installProfile(
  input: z.infer<typeof installProfileSchema>,
) {
  const { userId } = await requireSuperAdmin();
  const parsed = installProfileSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { tenantId, profileSlug } = parsed.data;

  const profile = getIndustryProfile(profileSlug);
  if (!profile) return { error: `No such industry profile: ${profileSlug}` };

  const graph = dependencyGraph();

  // A profile listing a pack whose dependency it does not also list is a
  // configuration error, and it is refused rather than repaired. Silently
  // pulling in the missing pack would leave the tenant with something nobody
  // chose — worse than the refusal, and harder to notice.
  const unlisted = unlistedRequirements(profile.packs, graph);
  if (unlisted.length > 0) {
    return {
      error: `Profile "${profile.name}" is misconfigured: it lists packs requiring ${unlisted.join(", ")}, which it does not list.`,
    };
  }

  const unknown = profile.packs.filter((slug) => !getFeature(slug));
  if (unknown.length > 0) {
    return {
      error: `Profile "${profile.name}" lists unregistered packs: ${unknown.join(", ")}.`,
    };
  }

  let order: string[];
  try {
    order = installOrder(profile.packs, graph);
  } catch (err) {
    console.error("profile install order failed", err);
    return { error: `Profile "${profile.name}" has a dependency cycle.` };
  }

  // One transaction: a half-installed profile is a tenant nobody can reason
  // about. Dependencies enable before dependents, so the invariant that
  // `toggleModule` enforces one row at a time also holds at every intermediate
  // step of the install.
  // Which packs this actually switched on, as opposed to which the profile
  // lists. On a re-run those are different, and the difference is the whole
  // point of the button — reporting the list either way said "7 packs switched
  // on" when nothing had changed.
  const switchedOn: string[] = [];
  await withSystem(async (tx) => {
    for (const slug of order) {
      if (await enableRow(tx, tenantId, slug, true)) switchedOn.push(slug);
    }
    await tx
      .update(schema.tenants)
      .set({ industry: profile.slug, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
  });

  await logAudit({
    action: "profile.installed",
    tenantId,
    actorClerkUserId: userId,
    targetType: "industry_profile",
    targetId: profile.slug,
    meta: { packs: order, switchedOn },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/modules");
  revalidatePath("/admin");
  return { ok: true, installed: order, switchedOn };
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
    const tenant = await withSystem(async (tx) => {
      const slug = await uniqueTenantSlug(tx, parsed.data.name);
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

// ------------------------------------------------------------ vocabulary ---

const setLabelsSchema = z.object({
  tenantId: z.string().uuid(),
  /**
   * The whole map, not a patch. A form that submits every field can clear one
   * by emptying it, and a patch shape gives no way to say "back to default".
   */
  labels: z.record(z.string(), z.string()),
});

/**
 * Set a tenant's vocabulary — Layer 3 tailoring, and the half of the extension
 * model that had no way in until now.
 *
 * Superadmin for the moment because it lives on the admin tenant page; the
 * mechanism is a tenant-owner concern and the guard can move when there is a
 * settings surface for it.
 *
 * WRITES THROUGH `withSystem`, deliberately. `tenants` is SELECT-only for
 * members and must stay that way — RLS is row-level, so any member UPDATE
 * policy permissive enough to allow this would also expose `status` (a tenant
 * could flip itself to active and skip billing) and `clerk_org_id`. Same
 * arrangement as `setTenantTimezoneAction`.
 */
export async function setTenantLabels(input: z.infer<typeof setLabelsSchema>) {
  const { userId } = await requireSuperAdmin();
  const parsed = setLabelsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { tenantId, labels } = parsed.data;

  // An empty value means "use the default word", so it is dropped rather than
  // stored — otherwise the override would render as a blank heading.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    const trimmed = value.trim();
    if (trimmed) cleaned[key] = trimmed;
  }

  await withSystem((tx) =>
    tx
      .update(schema.tenants)
      .set({ labels: cleaned, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId)),
  );

  await logAudit({
    action: "tenant.labels_set",
    tenantId,
    actorClerkUserId: userId,
    targetType: "tenant",
    targetId: tenantId,
    // The KEYS, never the words — a tenant's own vocabulary is their business.
    meta: { keys: Object.keys(cleaned).sort() },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true };
}
