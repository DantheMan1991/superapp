import { auth, clerkClient } from "@clerk/nextjs/server";
import { CreateOrganization } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { upsertTenantFromOrg } from "@/lib/tenant-sync";
import { reconcileTenantMemberships } from "@/lib/membership-sync";

export const dynamic = "force-dynamic";

/**
 * Self-serve path: signed-in user without an org creates one here; Clerk
 * makes it active and returns to this page, which syncs the tenant row
 * (idempotent — also covers webhook lag) and forwards to the dashboard.
 */
export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  if (orgId) {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: orgId,
    });
    const tenant = await upsertTenantFromOrg({
      id: org.id,
      name: org.name,
      slug: org.slug,
    });
    /**
     * The roster too, not just the tenant. This page is the documented
     * idempotent fallback for webhook lag, but it only ever covered the
     * tenants row — so the founder who just created the org had no membership
     * of it until a webhook landed or somebody opened the Team page. Nothing
     * surfaced that, because requireTenant reads their owner-ness from Clerk.
     * A background job reading this table would simply not have found them.
     */
    await reconcileTenantMemberships(tenant);
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up your business
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Name your business to create its workspace. You&apos;ll be able to
          invite your team afterward.
        </p>
      </div>
      <CreateOrganization
        afterCreateOrganizationUrl="/onboarding"
        skipInvitationScreen
      />
    </div>
  );
}
