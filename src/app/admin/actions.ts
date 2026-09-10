"use server";

import { revalidatePath } from "next/cache";
import { clerkClient, currentUser } from "@clerk/nextjs/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { withSystem, withTenant, schema } from "@/db";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { operatorRefusal } from "@/lib/operator-guard";
import {
  ensureOperatorParty,
  RelationshipError,
  relationshipMessage,
  type EnsureResult,
} from "./relationship";
import {
  attachWorkspaceToParty,
  ProvisionError,
  provisionMessage,
  resolveProvisionTarget,
  type ProvisionTarget,
} from "./provision";
import { endSupportSession, openSupportSession } from "@/lib/support-view";
import { getOperatorTenant } from "@/lib/operator-tenant";
import {
  backfillPlatformRevenue,
  retrySkippedPostings,
  type PostingCounts,
} from "@/lib/platform-revenue";
import { upsertTenantFromOrg } from "@/lib/tenant-sync";
import { provisionAccounting } from "@/modules/accounting/templates/apply";
import { provisionDocuments } from "@/modules/documents/templates/apply";
import { dependencyGraph, getFeature } from "@/lib/features";
import { getIndustryProfile } from "@/industries";
import { applyProfileSeed, type SeedReport } from "./profile-seed";
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

  // The operator tenant's features stay on (ADR 0041): the platform itself
  // will come to depend on them — its CRM is where every lead lands. Checked
  // before the dependency walk, so a refused toggle leaves no trace.
  if (!enabled) {
    const tenant = await withSystem((tx) =>
      tx.query.tenants.findFirst({
        where: eq(schema.tenants.id, tenantId),
        columns: { isOperator: true },
      }),
    );
    const refusal = tenant
      ? operatorRefusal(tenant, "moduleOff")
      : "No such business.";
    if (refusal) return { error: refusal };
  }

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

  // The installed profile's seed for THIS module (back-office slice 7a): a
  // profile installed before Accounting or Documents was switched on has a
  // chart or folders waiting, and this is the moment they can land. After the
  // row is enabled, so the base provisioning above stays the invariant it is;
  // a failure here is reported, not fatal — the module is on, and re-running
  // the install adds what is missing.
  let warning: string | undefined;
  if (enabled && (moduleId === "accounting" || moduleId === "documents")) {
    const tenant = await withSystem((tx) =>
      tx.query.tenants.findFirst({
        where: eq(schema.tenants.id, tenantId),
        columns: { industry: true },
      }),
    );
    const profile = tenant ? getIndustryProfile(tenant.industry) : null;
    if (profile?.seed) {
      try {
        const seeded = await applyProfileSeed(tenantId, profile, [moduleId]);
        if (seeded.accountsCreated > 0 || seeded.foldersCreated > 0) {
          await logAudit({
            action: "profile.seeded",
            tenantId,
            actorClerkUserId: userId,
            targetType: "industry_profile",
            targetId: profile.slug,
            meta: {
              module: moduleId,
              accountsCreated: seeded.accountsCreated,
              foldersCreated: seeded.foldersCreated,
            },
          });
        }
      } catch (err) {
        console.error("profile seed failed", err);
        warning = `${featureName(moduleId)} is on, but the ${profile.name} profile's seed did not land. Re-run the profile install to add it.`;
      }
    }
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin");
  return { ok: true, warning };
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
 * Then the profile's SEED lands (back-office slice 7a): its chart of accounts
 * and folders, for every module the tenant has on, through
 * `applyProfileSeed` — additive, so a re-run adds what is missing and touches
 * nothing else. A module that is off is reported as waiting, and
 * `toggleModule` applies the seed for it when it is switched on.
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
  const enabledAfter = await withSystem(async (tx) => {
    for (const slug of order) {
      if (await enableRow(tx, tenantId, slug, true)) switchedOn.push(slug);
    }
    /**
     * Presentation the profile suggests, COPIED onto the tenant rather than
     * resolved live like labels are. A tenant must be able to change it
     * afterwards without the profile putting it back on the next install — and
     * it must not be overwritten here if somebody already chose one.
     */
    const existing = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, tenantId),
      columns: { currencySymbol: true },
    });
    const currencySymbol =
      existing?.currencySymbol ?? profile.display?.currencySymbol ?? null;

    await tx
      .update(schema.tenants)
      .set({ industry: profile.slug, currencySymbol, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));

    // What is on now, packs just enabled included, for the seed below.
    const rows = await tx
      .select({ moduleId: schema.tenantModules.moduleId })
      .from(schema.tenantModules)
      .where(
        and(
          eq(schema.tenantModules.tenantId, tenantId),
          eq(schema.tenantModules.enabled, true),
        ),
      );
    return rows.map((r) => r.moduleId);
  });

  // After the install commits, in its own transactions: the chart goes in as
  // the tenant (withSystem never writes accounting rows) and the folders under
  // withSystem, which is why this cannot share the transaction above.
  let seeded: SeedReport;
  try {
    seeded = await applyProfileSeed(tenantId, profile, enabledAfter);
  } catch (err) {
    console.error("profile seed failed", err);
    return {
      error: `Profile "${profile.name}" installed, but its seed did not land. Re-run the install to add it.`,
    };
  }

  await logAudit({
    action: "profile.installed",
    tenantId,
    actorClerkUserId: userId,
    targetType: "industry_profile",
    targetId: profile.slug,
    meta: {
      packs: order,
      switchedOn,
      accountsCreated: seeded.accountsCreated,
      foldersCreated: seeded.foldersCreated,
      waitingOn: seeded.waitingOn,
    },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/modules");
  revalidatePath("/admin");
  return { ok: true, installed: order, switchedOn, seeded };
}

const setStatusSchema = z.object({
  tenantId: z.string().uuid(),
  // `prospect` is retired (back-office slice 3): the enum keeps the value
  // because Postgres cannot drop one, and nothing writes it.
  status: z.enum(["onboarding", "active", "paused", "churned"]),
});

export async function setTenantStatus(
  input: z.infer<typeof setStatusSchema>,
) {
  const { userId } = await requireSuperAdmin();
  const parsed = setStatusSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  // The flag is read in the same transaction as the write, so the operator
  // row is refused by what it is now, not by what a page rendered earlier.
  const refused = await withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, parsed.data.tenantId),
      columns: { isOperator: true },
    });
    if (!tenant) return "No such business.";
    const refusal = operatorRefusal(tenant, "status");
    if (refusal) return refusal;
    await tx
      .update(schema.tenants)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(schema.tenants.id, parsed.data.tenantId));
    return null;
  });
  if (refused) return { error: refused };

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

const partySchema = z.object({ tenantId: z.string().uuid() });

type PartyOutcome =
  | { error: string }
  | { ok: true; partyId: string; created: boolean };

/**
 * A client is a party (ADR 0041, back-office slice 1): make this workspace's
 * party in the operator's CRM and point the row at it. Idempotent — a linked
 * workspace answers with its party and writes nothing.
 */
export async function createOperatorPartyAction(
  input: z.infer<typeof partySchema>,
): Promise<PartyOutcome> {
  const { userId } = await requireSuperAdmin();
  const parsed = partySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  let result: EnsureResult;
  try {
    result = await ensureOperatorParty(parsed.data.tenantId, { userId });
  } catch (err) {
    if (err instanceof RelationshipError) {
      return { error: relationshipMessage(err.code) };
    }
    throw err;
  }
  if (result.created) {
    await logAudit({
      action: "tenant.party_linked",
      tenantId: parsed.data.tenantId,
      actorClerkUserId: userId,
      actorLabel: "admin-console",
      targetType: "party",
      targetId: result.partyId,
    });
  }

  revalidatePath(`/admin/tenants/${parsed.data.tenantId}`);
  revalidatePath("/admin");
  return { ok: true, ...result };
}

type BackfillOutcome =
  | { error: string }
  | { ok: true; considered: number; created: number };

/**
 * The backfill: every WORKSPACE (a Clerk organization behind it) with no
 * party yet. Prospect rows are left alone on purpose — slice 3 decides which
 * of them are real and which are test residue, and a party for the residue
 * would be junk in the operator's CRM.
 */
export async function createOperatorPartiesAction(): Promise<BackfillOutcome> {
  const { userId } = await requireSuperAdmin();
  const unlinked = await withSystem((tx) =>
    tx.query.tenants.findMany({
      where: and(
        isNotNull(schema.tenants.clerkOrgId),
        isNull(schema.tenants.operatorPartyId),
        eq(schema.tenants.isOperator, false),
      ),
      columns: { id: true },
    }),
  );

  let created = 0;
  for (const t of unlinked) {
    let result: EnsureResult;
    try {
      result = await ensureOperatorParty(t.id, { userId });
    } catch (err) {
      if (err instanceof RelationshipError) {
        return { error: relationshipMessage(err.code) };
      }
      throw err;
    }
    if (!result.created) continue;
    created += 1;
    await logAudit({
      action: "tenant.party_linked",
      tenantId: t.id,
      actorClerkUserId: userId,
      actorLabel: "admin-console",
      targetType: "party",
      targetId: result.partyId,
      meta: { backfill: true },
    });
  }

  revalidatePath("/admin");
  return { ok: true, considered: unlinked.length, created };
}

const provisionSchema = z.object({
  partyId: z.string().uuid("Pick the business from the CRM"),
  profileSlug: z.string().trim().max(64).optional().or(z.literal("")),
  ownerEmail: z.string().trim().email().optional().or(z.literal("")),
});

/**
 * Provision a workspace FROM a party (ADR 0041, back-office slice 3).
 *
 * The relationship exists first, in the operator's CRM; this makes the thing
 * the platform provides for it: the Clerk organization, the tenant row, the
 * pointer back to the party, a profile when one is chosen, an invitation
 * when an owner's address is given. The prospect row and the convert step
 * that used to live here are gone — a business without a workspace is a
 * party, never a tenant.
 *
 * Clerk is asked for nothing until everything the console can check has
 * been checked (provision.ts), and it is handed an explicit slug — the one
 * a person would type — because the one it makes for an API-created
 * organization is suffixed and the console shows slugs nowhere.
 */
export async function provisionWorkspace(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = provisionSchema.safeParse({
    partyId: formData.get("partyId"),
    profileSlug: formData.get("profileSlug"),
    ownerEmail: formData.get("ownerEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const profileSlug = parsed.data.profileSlug || "";
  const profile = profileSlug ? getIndustryProfile(profileSlug) : null;
  if (profileSlug && !profile) return { error: "No such industry profile." };

  let target: ProvisionTarget;
  try {
    target = await resolveProvisionTarget(parsed.data.partyId);
  } catch (err) {
    if (err instanceof ProvisionError) return { error: provisionMessage(err.code) };
    throw err;
  }

  const client = await clerkClient();
  const me = await currentUser();
  let org;
  try {
    org = await client.organizations.createOrganization({
      name: target.name,
      slug: target.slug,
      createdBy: me?.id,
    });
  } catch (err) {
    // The slug is taken on Clerk's side by an organization this database no
    // longer knows about. Clerk's own suffix beats no workspace.
    console.error("clerk org creation with an explicit slug failed", err);
    try {
      org = await client.organizations.createOrganization({
        name: target.name,
        createdBy: me?.id,
      });
    } catch (again) {
      console.error("clerk org creation failed", again);
      return { error: "Could not create the organization in Clerk." };
    }
  }

  const tenant = await upsertTenantFromOrg({
    id: org.id,
    name: target.name,
    slug: org.slug,
  });
  await attachWorkspaceToParty(tenant.id, target, { userId });

  const warnings: string[] = [];
  if (profile) {
    const installed = await installProfile({ tenantId: tenant.id, profileSlug: profile.slug });
    if ("error" in installed && installed.error) warnings.push(installed.error);
  }

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
      warnings.push("Workspace created, but the email invitation failed to send.");
    }
  }

  await logAudit({
    action: "tenant.created",
    tenantId: tenant.id,
    actorClerkUserId: userId,
    actorLabel: "admin-console",
    targetType: "party",
    targetId: target.partyId,
    meta: {
      partyId: target.partyId,
      profile: profile?.slug ?? null,
      invited: parsed.data.ownerEmail || null,
    },
  });

  revalidatePath("/admin");
  return {
    ok: true,
    tenantId: tenant.id,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined,
  };
}

const supportOpenSchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.string().trim().min(3, "Say why, in a few words").max(500),
});

/**
 * Open a support view of a client's workspace (back-office slice 4): a
 * time-boxed, read-only, audited look as its staff see it. Ends whatever
 * view this superadmin had open. The dashboard then answers as the client's
 * workspace for a GET and refuses everything else — src/lib/auth.ts.
 */
export async function openSupportViewAction(
  input: z.infer<typeof supportOpenSchema>,
): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireSuperAdmin();
  const parsed = supportOpenSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, parsed.data.tenantId),
      columns: { id: true, isOperator: true },
    }),
  );
  if (!tenant) return { error: "No such business." };
  const refusal = operatorRefusal(tenant, "support");
  if (refusal) return { error: refusal };

  const session = await openSupportSession({
    tenantId: tenant.id,
    clerkUserId: userId,
    reason: parsed.data.reason,
  });
  await logAudit({
    action: "support.opened",
    tenantId: tenant.id,
    actorClerkUserId: userId,
    actorLabel: "admin-console",
    targetType: "support_session",
    targetId: session.id,
    meta: { reason: parsed.data.reason, expiresAt: session.expiresAt.toISOString() },
  });
  return { ok: true };
}

/** End this superadmin's support view, whichever workspace it was of. */
export async function endSupportViewAction(): Promise<
  { ok: true; tenantId: string | null } | { error: string }
> {
  const { userId } = await requireSuperAdmin();
  const ended = await endSupportSession(userId);
  if (ended) {
    await logAudit({
      action: "support.ended",
      tenantId: ended.tenantId,
      actorClerkUserId: userId,
      actorLabel: "admin-console",
      targetType: "support_session",
      targetId: ended.id,
      meta: { views: ended.viewCount },
    });
    revalidatePath(`/admin/tenants/${ended.tenantId}`);
  }
  return { ok: true, tenantId: ended?.tenantId ?? null };
}

type RevenueOutcome = ({ ok: true } & PostingCounts) | { error: string };

/**
 * The platform's own revenue, into the operator's books (ADR 0043, slice 5):
 * post every paid Stripe invoice and every hour block the platform knows.
 * Idempotent — running it twice posts nothing twice.
 */
export async function backfillPlatformRevenueAction(): Promise<RevenueOutcome> {
  const { userId } = await requireSuperAdmin();
  const operator = await getOperatorTenant();
  if (!operator) return { error: NO_OPERATOR_MESSAGE };
  const counts = await backfillPlatformRevenue();
  await logAudit({
    action: "billing.revenue_backfilled",
    tenantId: operator.id,
    actorClerkUserId: userId,
    actorLabel: "admin-console",
    meta: { ...counts },
  });
  revalidatePath(`/admin/tenants/${operator.id}`);
  return { ok: true, ...counts };
}

/** Attempt every skipped posting again — a party made since, books started, accounting on. */
export async function retrySkippedPostingsAction(): Promise<RevenueOutcome> {
  const { userId } = await requireSuperAdmin();
  const operator = await getOperatorTenant();
  if (!operator) return { error: NO_OPERATOR_MESSAGE };
  const counts = await retrySkippedPostings();
  await logAudit({
    action: "billing.revenue_retried",
    tenantId: operator.id,
    actorClerkUserId: userId,
    actorLabel: "admin-console",
    meta: { ...counts },
  });
  revalidatePath(`/admin/tenants/${operator.id}`);
  return { ok: true, ...counts };
}

const NO_OPERATOR_MESSAGE =
  "No operator tenant is named yet — run scripts/operator-tenant.ts first.";

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
