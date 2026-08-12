import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { CrmNav } from "@/modules/crm/components/crm-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listFieldDefs } from "@/modules/crm/field-ops";
// `EMPTY_RECORD` from `core/types`, not the form — see its header. A server
// component may import COMPONENTS from a `"use client"` module, never values.
import { EMPTY_RECORD } from "@/modules/crm/core/types";
import { RecordForm } from "@/modules/crm/components/record-form";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/crm";

export default async function NewRecordPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");

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
