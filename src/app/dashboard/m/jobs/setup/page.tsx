import Link from "next/link";
import { ChevronLeft, SlidersHorizontal } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { allowsWrite } from "@/lib/packs/authorize";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { tabsInUse } from "@/packs/jobs/tab-rows";
import { tabsOffFrom } from "@/packs/jobs/tabs";
import { TabSettingsForm } from "@/packs/jobs/components/tab-settings-form";
import { PACK } from "@/packs/jobs/vocabulary";

/**
 * WHICH PARTS OF A JOB THIS BUSINESS DOES.
 *
 * Eleven tabs and no construction business uses all eleven: a commercial
 * contractor never picks a tile, a framing sub has no warranty period, a
 * remodeler who bids on an envelope has no use for Estimates. This is where
 * they say so, and the reasoning is in `packs/jobs/tabs.ts`.
 *
 * **THE PACK'S OWN SETTINGS SCREEN, NOT BUSINESS SETTINGS.** Layer 0's settings
 * page would have to know what a job tab is to draw this, and a core surface
 * that learns one pack's shape learns every pack's next. The pack owns its
 * settings, at its own route, exactly as it owns its cost codes.
 *
 * Owner-only to write — it changes what the whole team sees — and readable by
 * anybody, so a foreman can find out why a tab they remember is not there.
 */
export default async function JobsSetupPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const isOwner = allowsWrite(ctx.role, "owner");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK);
      return { config: pack.config, labels: pack.labels, inUse: await tabsInUse(tx, ctx.tenant.id) };
    },
    { role: ctx.role },
  );
  const projectWord = labelFor(data.labels, "project", "Project");

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> All {projectWord.toLowerCase()}s
      </Link>
      <PageHeader
        icon={<SlidersHorizontal />}
        title="What you use"
        description={`Every ${projectWord.toLowerCase()} has the same sections. Turn off the ones this business does not do and they come off every ${projectWord.toLowerCase()}'s tab strip.`}
      />
      <Panel className="p-5">
        {!isOwner && (
          <p className="mb-3 text-sm text-muted-foreground">
            An owner sets this. You are seeing what it is set to.
          </p>
        )}
        <TabSettingsForm
          tabsOff={tabsOffFrom(data.config)}
          inUse={data.inUse}
          canEdit={isOwner}
        />
        <p className="mt-4 border-t border-divider pt-4 text-sm text-muted-foreground">
          Overview, Contracts and Job cost are always there — a {projectWord.toLowerCase()} with
          a number, what it is worth and what it is costing is what this is.{" "}
          <strong>Nothing you turn off is deleted or hidden</strong>: a{" "}
          {projectWord.toLowerCase()} that already has work on a section keeps that section,
          so you never lose sight of a warranty call or a change order because of a
          setting.
        </p>
      </Panel>
    </div>
  );
}
