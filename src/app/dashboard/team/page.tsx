import { OrganizationProfile } from "@clerk/nextjs";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { upsertMembership } from "@/lib/tenant-sync";
import { schema, withTenant } from "@/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AccountantToggle } from "./team-roles";

export const dynamic = "force-dynamic";

/**
 * Members and invitations, powered by Clerk's org UI. Clerk enforces who can
 * invite (owners/admins) — staff see the roster read-only. Membership
 * changes sync back to our DB via the Clerk webhook in production and the
 * idempotent onboarding sync locally.
 *
 * Below the roster, owners assign the "Accountant" flag — the local expert
 * role overlay (read + close-review access, never posts).
 */
export default async function TeamPage() {
  const ctx = await requireTenant();

  let members: Array<{
    membershipId: string;
    name: string | null;
    email: string;
    clerkUserId: string;
    role: "owner" | "staff" | "expert";
  }> = [];

  if (ctx.role === "owner" && ctx.tenant.clerkOrgId) {
    // Idempotent sync so the panel works even before the webhook is
    // configured (local dev) — upsertMembership preserves the expert flag.
    try {
      const client = await clerkClient();
      const list = await client.organizations.getOrganizationMembershipList({
        organizationId: ctx.tenant.clerkOrgId,
        limit: 100,
      });
      for (const m of list.data) {
        const userId = m.publicUserData?.userId;
        if (!userId) continue;
        await upsertMembership({
          clerkOrgId: ctx.tenant.clerkOrgId,
          clerkUserId: userId,
          clerkRole: m.role,
        });
      }
    } catch (err) {
      console.error("team membership sync failed", err);
    }

    members = await withTenant(ctx.tenant.id, (tx) =>
      tx
        .select({
          membershipId: schema.memberships.id,
          name: schema.profiles.name,
          email: schema.profiles.email,
          clerkUserId: schema.profiles.clerkUserId,
          role: schema.memberships.role,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.profiles,
          eq(schema.profiles.id, schema.memberships.profileId),
        )
        .where(eq(schema.memberships.tenantId, ctx.tenant.id))
        .orderBy(schema.profiles.email),
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Invite your staff and manage who has access to your workspace.
        </p>
      </div>
      <OrganizationProfile
        routing="hash"
        appearance={{
          elements: {
            rootBox: "w-full",
            cardBox: "w-full max-w-none shadow-none border rounded-lg",
          },
        }}
      />
      {ctx.role === "owner" && members.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Accounting access</CardTitle>
            <CardDescription>
              Mark your outside accountant or bookkeeper. Accountants can read
              everything, review and sign off closes, and export the books —
              they can never post or change anything.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {members.map((m) => (
                <li
                  key={m.membershipId}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.name || m.email}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {m.role === "owner" ? (
                      <Badge variant="secondary">Owner</Badge>
                    ) : m.clerkUserId === ctx.userId ? (
                      <Badge variant="secondary">You</Badge>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">
                          Accountant
                        </span>
                        <AccountantToggle
                          membershipId={m.membershipId}
                          accountant={m.role === "expert"}
                        />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
