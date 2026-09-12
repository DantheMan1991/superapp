import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { listGrants } from "@/lib/device-grants/ops";
import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PhoneControls, type PhoneRow } from "./phone-controls";

export const dynamic = "force-dynamic";

/**
 * Your phone — the phones allowed to speak to this workspace without the app
 * being open (ADR 0048).
 *
 * `requireTenant()`, not `requireTenantOwner()`, unlike every sibling under
 * `/dashboard/settings`: those change how the business behaves, this changes
 * how one person's own phone behaves. The rows are scoped to the caller by
 * policy, so there is nothing here to filter and nothing of anybody else's to
 * see — which is also the gap recorded in the dossier, because an owner
 * cannot see the whole workspace's phones from here either.
 */
export default async function PhoneSettingsPage() {
  const ctx = await requireTenant();

  const grants = await withTenant(ctx.tenant.id, (tx) => listGrants(tx), {
    role: ctx.role,
    userId: ctx.userId,
  });

  const phones: PhoneRow[] = grants.map((g) => ({
    id: g.id,
    label: g.label,
    platform: g.platform,
    lastUsedAt: g.lastUsedAt ? g.lastUsedAt.toISOString().slice(0, 10) : null,
    expiresAt: g.expiresAt.toISOString().slice(0, 10),
  }));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="Your phone"
        description={`Phones that can record things in ${ctx.tenant.name} without opening the app.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Talking to Yosher</CardTitle>
          <CardDescription>
            Set a phone up here and it can record what happened while your
            hands are full — a move, a loss, a check — without unlocking
            anything. Yosher reads back what it understood and writes nothing
            until you say yes. It can never see money, and it can never do the
            things only an owner can do, however you are set up here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneControls phones={phones} />
        </CardContent>
      </Card>
    </div>
  );
}
