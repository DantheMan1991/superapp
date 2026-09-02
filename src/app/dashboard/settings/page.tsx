import { requireTenantOwner } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TimezoneForm } from "./timezone-form";
import { PageHeader } from "@/components/app/page-header";

export const dynamic = "force-dynamic";

/**
 * Business-wide settings. Owner-only — everything here changes how the whole
 * workspace behaves, not how one person sees it.
 *
 * Today that is the timezone, which is more load-bearing than it sounds: it is
 * the single answer to "what day is it here", used by the ledger's period
 * cutoffs, by every overdue badge, and by the background jobs that run when
 * nobody is signed in.
 */
export default async function BusinessSettingsPage() {
  const ctx = await requireTenantOwner();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="Business settings"
        description={`Settings that apply to everyone in ${ctx.tenant.name}.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
          <CardDescription>
            Decides what counts as &ldquo;today&rdquo; everywhere in Yosher:
            when an invoice becomes overdue, which month a journal entry closes
            into, and which tasks show up as due. Set it to where the business
            actually operates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <TimezoneForm current={ctx.tenant.timezone} />
          <p className="text-xs text-muted-foreground">
            Right now that makes today{" "}
            <span className="font-medium text-foreground">
              {todayInTimezone(ctx.tenant.timezone)}
            </span>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
