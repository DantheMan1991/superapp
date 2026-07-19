import { OrganizationProfile } from "@clerk/nextjs";
import { requireTenant } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Members and invitations, powered by Clerk's org UI. Clerk enforces who can
 * invite (owners/admins) — staff see the roster read-only. Membership
 * changes sync back to our DB via the Clerk webhook in production and the
 * idempotent onboarding sync locally.
 */
export default async function TeamPage() {
  await requireTenant();

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
    </div>
  );
}
