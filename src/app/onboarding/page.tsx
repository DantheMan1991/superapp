import { auth, clerkClient } from "@clerk/nextjs/server";
import { CreateOrganization, OrganizationSwitcher } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import {
  DuplicatePersonalSpaceError,
  upsertTenantFromOrg,
} from "@/lib/tenant-sync";
import { reconcileTenantMemberships } from "@/lib/membership-sync";
import { PERSONAL_HOME } from "@/lib/personal-space-core";

export const dynamic = "force-dynamic";

/**
 * Self-serve path: signed-in user without an org creates one here; Clerk
 * makes it active and returns to this page, which syncs the tenant row
 * (idempotent — also covers webhook lag) and forwards to the dashboard.
 *
 * A PERSONAL space (ADR 0111) is forwarded to its own home instead. And the
 * two cases that cannot be forwarded anywhere — a personal space that is not
 * the caller's, or a second one of their own — are answered here with the
 * switcher, because every other page would send them straight back.
 */
export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  if (orgId) {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: orgId,
    });
    let tenant: Awaited<ReturnType<typeof upsertTenantFromOrg>>;
    try {
      tenant = await upsertTenantFromOrg({
        id: org.id,
        name: org.name,
        slug: org.slug,
        publicMetadata: org.publicMetadata,
      });
    } catch (err) {
      if (err instanceof DuplicatePersonalSpaceError) {
        return (
          <Elsewhere
            title="You already have a personal space"
            body="This one is a spare that was never finished. Switch to your personal space, or to one of your businesses."
          />
        );
      }
      throw err;
    }
    if (tenant.kind === "personal") {
      if (tenant.personalOwnerClerkUserId !== userId) {
        return (
          <Elsewhere
            title="This is somebody else's personal space"
            body="Only the person it belongs to can open it. Switch to one of your own workspaces."
          />
        );
      }
      // The owner's own membership, as for a business below — it only ever
      // mirrors the owner, anybody else is refused.
      await reconcileTenantMemberships(tenant);
      redirect(PERSONAL_HOME);
    }
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
        {/* Not `PageHeader`: that is a left-aligned title/description/actions
            row for a dashboard page, and this is a centred single-purpose
            screen. It takes the heading type and nothing else. */}
        <h1 className="font-heading text-2xl font-semibold tracking-heading">
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

/** A workspace this person cannot use, and the way out of it. */
function Elsewhere({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <div className="max-w-md text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-heading">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
      <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/dashboard" />
    </div>
  );
}
