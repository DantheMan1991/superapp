import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withSystem, schema, type Tx } from "@/db";
import type { SupportSession, Tenant } from "@/db/schema";
import {
  endSupportSession,
  liveSupportSessionInTx,
  recordSupportView,
  type SupportView,
} from "@/lib/support-view";
import { decideSupportView } from "@/lib/support-view-decide";
import { shouldStampSeen } from "@/lib/last-seen";

/**
 * Server-side authorization helpers. Every page/action that touches data goes
 * through one of these — the middleware only guarantees "signed in".
 */

export type TenantRole = "owner" | "staff" | "expert";

export interface TenantContext {
  tenant: Tenant;
  userId: string;
  role: TenantRole;
  /**
   * Non-null when a superadmin is looking at this workspace as SUPPORT
   * (back-office slice 4): a live, unexpired session, honoured for a GET and
   * for nothing else — see `resolveSupport`. The role is `staff`, the least a
   * member can be, so owners-only pages and folders stay closed; the marker
   * is for the banner and for the few renders that would otherwise write.
   */
  support: SupportView | null;
}

/**
 * A server action or a non-GET route was called while a support session is
 * live. Refused outright rather than answered under the superadmin's own
 * workspace (a client's ids in the wrong tenant) or the client's (a write).
 */
export class SupportViewError extends Error {
  constructor() {
    super(
      "You are viewing this workspace as support; nothing can be changed from here. End the support view to work in your own workspace.",
    );
    this.name = "SupportViewError";
  }
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
 *
 * A live support session comes first (below): it is answered before the
 * active organization is even looked at, because a support view needs no
 * organization of the viewer's own.
 */
export async function requireTenant(): Promise<TenantContext> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");

  const found = await lookup(userId, orgId ?? null, orgRole);
  const support = await resolveSupport(userId, found.session);
  if (support.kind === "refuse") throw new SupportViewError();
  if (support.kind === "view") return support.ctx;

  if (!orgId) redirect("/onboarding");
  // Org exists in Clerk but hasn't synced yet (webhook lag) — send through
  // onboarding, which creates the row idempotently.
  if (!found.resolved) redirect("/onboarding");

  await stampSeen(found.resolved.membership);
  return {
    tenant: found.resolved.tenant,
    role: found.resolved.role,
    userId,
    support: null,
  };
}

/** What one lookup answers for the ordinary path. */
interface Resolved {
  tenant: Tenant;
  role: TenantRole;
  /** The caller's own membership row, for the last-seen stamp; null when unsynced. */
  membership: { id: string; lastSeenAt: Date | null } | null;
}

/**
 * Tenant + role resolution shared by requireTenant and resolveTenantContext,
 * in ONE transaction with the support-session lookup so a request costs the
 * round trips it did before slice 4. Clerk owns owner-vs-member: org:admin is
 * always "owner" and can never be an expert. Within members, the local
 * memberships flag decides expert-vs-staff; a missing membership row (webhook
 * lag, fresh dev DB) degrades to staff — never upward.
 */
async function lookup(
  userId: string,
  orgId: string | null,
  orgRole: string | null | undefined,
): Promise<{
  session: SupportSession | null;
  resolved: Resolved | null;
}> {
  return withSystem(async (tx) => {
    const session = await liveSupportSessionInTx(tx, userId);
    if (!orgId) return { session, resolved: null };
    const resolved = await lookupTenantAndRole(tx, userId, orgId, orgRole);
    return { session, resolved };
  });
}

async function lookupTenantAndRole(
  tx: Tx,
  userId: string,
  orgId: string,
  orgRole: string | null | undefined,
): Promise<Resolved | null> {
  const tenant = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.clerkOrgId, orgId),
  });
  if (!tenant) return null;

  // The membership row is read for every role now — an owner's too — because
  // the last-seen stamp (slice 6) needs it. Clerk still owns owner-vs-member:
  // org:admin is "owner" whatever the row says.
  const [membership] = await tx
    .select({
      id: schema.memberships.id,
      role: schema.memberships.role,
      lastSeenAt: schema.memberships.lastSeenAt,
    })
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
  const role: TenantRole =
    orgRole === "org:admin"
      ? "owner"
      : membership?.role === "expert"
        ? "expert"
        : "staff";
  return {
    tenant,
    role,
    membership: membership ? { id: membership.id, lastSeenAt: membership.lastSeenAt } : null,
  };
}

/**
 * Last seen (back-office slice 6): a member's own request stamps their
 * membership at most once an hour — `shouldStampSeen` decides — and once per
 * request, `cache` collapsing the layout's and the page's calls. Only the
 * ordinary path calls this: a support view is the superadmin's request, not
 * the client's sign-in, and never stamps.
 */
const stampSeenOnce = cache(async (membershipId: string) => {
  await withSystem((tx) =>
    tx
      .update(schema.memberships)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.memberships.id, membershipId)),
  );
});

async function stampSeen(
  membership: { id: string; lastSeenAt: Date | null } | null,
): Promise<void> {
  if (membership && shouldStampSeen(membership.lastSeenAt, new Date())) {
    await stampSeenOnce(membership.id);
  }
}

/**
 * The support half of resolution (back-office slice 4). With no live session
 * this is a no-op. With one: the decision is pure (`decideSupportView`) and
 * turns on facts the MIDDLEWARE stamped — `x-yosher-method`, `x-yosher-path`,
 * overwriting anything a client sent — plus the `next-action` header a server
 * action carries. A GET is answered as the client's workspace, as `staff`,
 * and audited with the path once per request; anything else is refused. A
 * viewer who is no longer a superadmin, or a session whose tenant is gone,
 * ends the session and falls through to the ordinary path.
 */
async function resolveSupport(
  userId: string,
  session: SupportSession | null,
): Promise<{ kind: "none" } | { kind: "refuse" } | { kind: "view"; ctx: TenantContext }> {
  if (!session) return { kind: "none" };
  const h = await headers();
  const decision = decideSupportView(session, {
    method: h.get("x-yosher-method") ?? "",
    isAction: h.has("next-action"),
    now: new Date(),
  });
  if (decision.kind === "none") return { kind: "none" };
  if (decision.kind === "refuse") return { kind: "refuse" };

  if (!(await isSuperAdmin())) {
    await endSupportSession(userId);
    return { kind: "none" };
  }
  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({ where: eq(schema.tenants.id, session.tenantId) }),
  );
  if (!tenant) {
    await endSupportSession(userId);
    return { kind: "none" };
  }
  await recordViewOnce(session.id, tenant.id, userId, h.get("x-yosher-path") ?? "");
  return {
    kind: "view",
    ctx: {
      tenant,
      userId,
      role: "staff",
      support: {
        sessionId: session.id,
        tenantId: tenant.id,
        tenantName: tenant.name,
        reason: session.reason,
        openedAt: session.openedAt,
        expiresAt: session.expiresAt,
      },
    },
  };
}

/**
 * One audit row per request, not per component: a render calls
 * `requireTenant()` from the layout, the page and whatever else asks, and
 * `cache` collapses those into one write for the same session and path.
 */
const recordViewOnce = cache(
  async (sessionId: string, tenantId: string, clerkUserId: string, path: string) =>
    recordSupportView({ sessionId, tenantId, clerkUserId, path }),
);

/**
 * Non-redirecting variant of requireTenant for API route handlers, which
 * must answer 401/404 JSON instead of redirecting (session 5: the blob
 * upload token route and the document file route). Null = not signed in,
 * no active org, or org not yet synced — and, under a live support session,
 * anything but a GET.
 */
export async function resolveTenantContext(): Promise<TenantContext | null> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return null;
  const found = await lookup(userId, orgId ?? null, orgRole);
  const support = await resolveSupport(userId, found.session);
  if (support.kind === "refuse") return null;
  if (support.kind === "view") return support.ctx;
  if (!found.resolved) return null;
  await stampSeen(found.resolved.membership);
  return {
    tenant: found.resolved.tenant,
    role: found.resolved.role,
    userId,
    support: null,
  };
}

/** Like requireTenant, but restricted to the business owner. */
export async function requireTenantOwner(): Promise<TenantContext> {
  const ctx = await requireTenant();
  if (ctx.role !== "owner") redirect("/dashboard");
  return ctx;
}
