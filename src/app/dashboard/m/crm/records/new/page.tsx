import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { CrmNav } from "@/modules/crm/components/crm-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listFieldDefs } from "@/modules/crm/field-ops";
// `EMPTY_RECORD` from `core/types`, not the form — see its header. A server
// component may import COMPONENTS from a `"use client"` module, never values.
import { EMPTY_RECORD } from "@/modules/crm/core/types";
import { RecordForm } from "@/modules/crm/components/record-form";
import { roleMayWrite } from "@/modules/crm/core/errors";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

export default async function NewRecordPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

  /**
   * **THIS PAGE EXISTS ONLY TO CREATE**, so a read-only rendering of it would
   * be a form with nothing to do. An accountant is refused the whole screen and
   * told why, the way `duplicates` refuses a non-owner. Recorded 2026-09-03 as
   * *`/dashboard/m/crm/records/new` has no role check at all*.
   */
  if (!roleMayWrite(ctx.role)) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <PageHeader title="Add a record" />
        <CrmNav />
        <Panel>
          <EmptyState
            icon={<Lock />}
            title="Accountant access is read-only"
            description="You can open every record in the CRM and read everything on it. Adding one is not something this role does."
          />
        </Panel>
      </div>
    );
  }

  const fieldDefs = await withTenant(
    ctx.tenant.id,
    (tx) => listFieldDefs(tx, ctx.tenant.id, "party"),
    { role: ctx.role, userId: ctx.userId },
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All records
      </Link>

      <PageHeader
        title="Add a record"
        description="A company or a person. Anyone already invoiced or paid through Accounting is here already — search before adding."
      />

      <CrmNav />

      <RecordForm
        mode="create"
        initial={EMPTY_RECORD}
        isOwner={ctx.role === "owner"}
        fieldDefs={fieldDefs}
      />
    </div>
  );
}
