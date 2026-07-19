import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";
import type { Tenant } from "@/db/schema";

/**
 * Server-side authorization helpers. Every page/action that touches data goes
 * through one of these — the middleware only guarantees "signed in".
 */

export type TenantRole = "owner" | "staff";

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

  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.clerkOrgId, orgId),
    }),
  );

  // Org exists in Clerk but hasn't synced yet (webhook lag) — send through
  // onboarding, which creates the row idempotently.
  if (!tenant) redirect("/onboarding");

  const role: TenantRole = orgRole === "org:admin" ? "owner" : "staff";
  return { tenant, userId, role };
}

/** Like requireTenant, but restricted to the business owner. */
export async function requireTenantOwner(): Promise<TenantContext> {
  const ctx = await requireTenant();
  if (ctx.role !== "owner") redirect("/dashboard");
  return ctx;
}
