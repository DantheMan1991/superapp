import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import type { Tenant } from "@/db/schema";

/**
 * Server-side authorization helpers. Every page/action that touches data goes
 * through one of these — the middleware only guarantees "signed in".
 */

export type TenantRole = "owner" | "staff" | "expert";

export interface TenantContext {
  tenant: Tenant;
  userId: string;
  role: TenantRole;
}

function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True if the signed-in user is the platform owner (god view). */
export async function isSuperAdmin(): Promise<boolean> {
  const user = await currentUser();
  if (!user) return false;
  if (user.publicMetadata?.role === "superadmin") return true;
  const allow = superAdminEmails();
  return user.emailAddresses.some((e) =>
    allow.includes(e.emailAddress.toLowerCase()),
  );
}

/** Gate for /admin. Redirects instead of throwing so it's safe in layouts. */
export async function requireSuperAdmin(): Promise<{ userId: string }> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!(await isSuperAdmin())) redirect("/dashboard");
  return { userId };
}

/**
 * Resolve the caller's active tenant (Clerk active organization → tenants row)
 * and their role in it. Redirects to onboarding when no org is active yet.
 */
export async function requireTenant(): Promise<TenantContext> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  const resolved = await lookupTenantAndRole(userId, orgId, orgRole);

  // Org exists in Clerk but hasn't synced yet (webhook lag) — send through
  // onboarding, which creates the row idempotently.
  if (!resolved) redirect("/onboarding");

  return { ...resolved, userId };
}

/**
 * Tenant + role resolution shared by requireTenant and resolveTenantContext.
 * Clerk owns owner-vs-member: org:admin is always "owner" and can never be an
 * expert. Within members, the local memberships flag decides expert-vs-staff;
 * a missing membership row (webhook lag, fresh dev DB) degrades to staff —
 * never upward.
 */
async function lookupTenantAndRole(
  userId: string,
  orgId: string,
  orgRole: string | null | undefined,
): Promise<{ tenant: Tenant; role: TenantRole } | null> {
  return withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, orgId),
    });
    if (!tenant) return null;
    if (orgRole === "org:admin") return { tenant, role: "owner" };

    const [membership] = await tx
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(
        schema.profiles,
        eq(schema.profiles.id, schema.memberships.profileId),
      )
      .where(
        and(
          eq(schema.memberships.tenantId, tenant.id),
          eq(schema.profiles.clerkUserId, userId),
        ),
      )
      .limit(1);
    const role: TenantRole = membership?.role === "expert" ? "expert" : "staff";
    return { tenant, role };
  });
}

/**
 * Non-redirecting variant of requireTenant for API route handlers, which
 * must answer 401/404 JSON instead of redirecting (session 5: the blob
 * upload token route and the document file route). Null = not signed in,
 * no active org, or org not yet synced.
 */
export async function resolveTenantContext(): Promise<TenantContext | null> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId || !orgId) return null;
  const resolved = await lookupTenantAndRole(userId, orgId, orgRole);
  if (!resolved) return null;
  return { ...resolved, userId };
}

/** Like requireTenant, but restricted to the business owner. */
export async function requireTenantOwner(): Promise<TenantContext> {
  const ctx = await requireTenant();
  if (ctx.role !== "owner") redirect("/dashboard");
  return ctx;
}
