import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withSystem, schema } from "@/db";
import type { AuditMessage } from "@/db/schema";
import { AuditWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const audit = await withSystem((tx) =>
    tx.query.audits.findFirst({ where: eq(schema.audits.id, id) }),
  );
  if (!audit) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/audits"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All discovery
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {audit.businessName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="capitalize">{audit.industry}</span>
          {audit.contactName && <> · {audit.contactName}</>}
          {" · started "}
          {audit.createdAt.toLocaleDateString()}
          {audit.tenantId && (
            <>
              {" · "}
              <Link
                href={`/admin/tenants/${audit.tenantId}`}
                className="underline hover:text-foreground"
              >
                CRM record
              </Link>
            </>
          )}
        </p>
      </div>

      <AuditWorkspace
        auditId={audit.id}
        status={audit.status}
        messages={(audit.messages as AuditMessage[]) ?? []}
        report={audit.report}
      />
    </div>
  );
}
