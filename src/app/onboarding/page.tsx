import { auth, clerkClient } from "@clerk/nextjs/server";
import { CreateOrganization } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { upsertTenantFromOrg } from "@/lib/tenant-sync";

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
    await upsertTenantFromOrg({ id: org.id, name: org.name, slug: org.slug });
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
