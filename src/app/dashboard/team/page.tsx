import { OrganizationProfile } from "@clerk/nextjs";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { reconcileTenantMemberships } from "@/lib/membership-sync";
import { schema, withTenant } from "@/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AccountantToggle, MemberAccessButton } from "./team-roles";
import { listAccessLevels } from "@/lib/access/levels";
import { PageHeader } from "@/components/app/page-header";

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
    accessLevelId: string | null;
    accessLevelName: string | null;
    entityIds: string[];
  }> = [];
  let levels: { id: string; name: string }[] = [];
  let companies: { id: string; name: string }[] = [];

  if (ctx.role === "owner" && ctx.tenant.clerkOrgId) {
    // Idempotent sync so the panel works even before the webhook is configured
    // (local dev). This used to be a hand-rolled loop here; it is now the
    // shared reconcile, which additionally backfills missing profiles, drops
    // people who have left the org, and records any role it had to correct.
    // Best-effort by contract — a Clerk outage leaves the roster below stale
    // rather than blanking the page.
    await reconcileTenantMemberships(ctx.tenant);

    members = await withTenant(ctx.tenant.id, (tx) =>
      tx
        .select({
          membershipId: schema.memberships.id,
          name: schema.profiles.name,
          email: schema.profiles.email,
          clerkUserId: schema.profiles.clerkUserId,
          role: schema.memberships.role,
          accessLevelId: schema.memberships.accessLevelId,
          accessLevelName: schema.accessLevels.name,
          entityIds: schema.memberships.entityIds,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.profiles,
          eq(schema.profiles.id, schema.memberships.profileId),
        )
        // LEFT, because most people are on no level and must still be listed.
        .leftJoin(
          schema.accessLevels,
          eq(schema.accessLevels.id, schema.memberships.accessLevelId),
        )
        .where(eq(schema.memberships.tenantId, ctx.tenant.id))
        .orderBy(schema.profiles.email),
    );
    levels = (
      await withTenant(
        ctx.tenant.id,
        (tx) => listAccessLevels(tx, ctx.tenant.id),
        { role: ctx.role },
      )
    ).map((l) => ({ id: l.id, name: l.name }));
    /**
     * Every company, read AS AN OWNER — who is never scoped, so this is the
     * whole list even once other people are limited to part of it.
     */
    companies = await withTenant(
      ctx.tenant.id,
      (tx) =>
        tx
          .select({ id: schema.entities.id, name: schema.entities.name })
          .from(schema.entities)
          .where(eq(schema.entities.tenantId, ctx.tenant.id))
          .orderBy(schema.entities.name),
      { role: ctx.role },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Invite your staff and manage who has access to your workspace."
      />
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

      {/*
        WHAT EACH PERSON CAN REACH (ADR 0093).
        
        Only once a level exists: a card offering a choice with one option in it
        is furniture, and a workspace that has never wanted this should not have
        to learn the idea. The link is how they get the first one.
      */}
      {ctx.role === "owner" && members.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>What people can reach</CardTitle>
            <CardDescription>
              Everyone reaches every tool you have switched on, and every
              company&rsquo;s books. A <strong className="font-medium">level</strong>{" "}
              takes tools away — gone from their menu, and the pages answer as if
              they were not there. <strong className="font-medium">Companies</strong>{" "}
              takes books away, and that one is enforced underneath: entries,
              invoices and reports for a company they are not on are not returned
              to them at all. Owners always reach everything.{" "}
              <Link href="/dashboard/settings/access" className="underline">
                Manage levels
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            {levels.length === 0 && companies.length < 2 ? (
              <p className="text-sm text-muted-foreground">
                No levels yet. Make one under{" "}
                <Link href="/dashboard/settings/access" className="underline">
                  Access
                </Link>{" "}
                and it will appear here for every member.
              </p>
            ) : (
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
                    {m.role === "owner" ? (
                      <Badge variant="secondary">Reaches everything</Badge>
                    ) : m.clerkUserId === ctx.userId ? (
                      <Badge variant="secondary">You</Badge>
                    ) : (
                      <MemberAccessButton
                        membershipId={m.membershipId}
                        name={m.name || m.email}
                        levelId={m.accessLevelId}
                        levelName={m.accessLevelName}
                        entityIds={m.entityIds}
                        levels={levels}
                        companies={companies}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
