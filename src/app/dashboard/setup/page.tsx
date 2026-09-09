import { requireTenantOwner } from "@/lib/auth";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { currentInterview } from "@/lib/setup-interview/session";
import { SetupChat } from "./setup-chat";

export const dynamic = "force-dynamic";

/**
 * The setup interview (ADR 0040) — the last of the onboarding plan's slices.
 *
 * OWNERS ONLY, by `requireTenantOwner`, which redirects rather than 404s: a
 * staff member who follows a link here is not being told a page is missing,
 * they are being told this is not theirs. Same call the Billing page makes.
 */
export default async function SetupInterviewPage() {
  const ctx = await requireTenantOwner();
  const interview = await withTenant(
    ctx.tenant.id,
    (tx) => currentInterview(tx, ctx.tenant.id),
    { role: ctx.role, userId: ctx.userId },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Let's get you set up"
        description="A few questions about how the business runs, then a plan for setting it up here."
      />
      <SetupChat initial={interview} />
    </div>
  );
}
