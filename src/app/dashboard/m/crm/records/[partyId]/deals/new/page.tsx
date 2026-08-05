import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { CrmError } from "@/modules/crm/core/errors";
import { loadRecord } from "@/modules/crm/party-ops";
import { listFieldDefs } from "@/modules/crm/field-ops";
import { DealForm } from "@/modules/crm/components/deal-form";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

/**
 * New deal, always started FROM a record.
 *
 * There is no standalone "new deal" route, and that is deliberate: a deal must
 * have a party, and a form that opened with an empty company picker invites
 * somebody to type a name that already exists three rows down in the records
 * list. Starting from the record makes the duplicate impossible rather than
 * merely discouraged.
 */
export default async function NewDealPage({
  params,
}: {
  params: Promise<{ partyId: string }>;
}) {
  const { partyId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      record: await loadRecord(tx, ctx.tenant.id, partyId),
      fieldDefs: await listFieldDefs(tx, ctx.tenant.id, "deal"),
    }),
    { role: ctx.role, userId: ctx.userId },
  ).catch((err) => {
    if (err instanceof CrmError && err.code === "RECORD_NOT_FOUND") notFound();
    throw err;
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Link
        href={`${BASE}/records/${partyId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {data.record.party.displayName}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a deal</h1>
        <p className="text-sm text-muted-foreground">
          It starts in the first stage of the default pipeline. You can move it
          from the board.
        </p>
      </div>

      <DealForm
        mode="create"
        partyId={partyId}
        partyName={data.record.party.displayName}
        fieldDefs={data.fieldDefs}
        initial={{ title: "", amount: "", expectedCloseOn: "" }}
      />
    </div>
  );
}
