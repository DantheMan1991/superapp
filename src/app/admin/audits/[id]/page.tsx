import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { withSystem, withTenant, schema } from "@/db";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { loadParty, PartyError } from "@/lib/parties";
import { OpenInCrmButton } from "../../relationship-controls";
import { AttachAuditForm, DeleteAuditButton } from "../audit-controls";
import { PageHeader } from "@/components/app/page-header";
import type { AuditMessage } from "@/db/schema";
import { AuditWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // The operator's row (ADR 0041, slice 2), read through its own context.
  const operator = await getOperatorTenant();
  if (!operator) notFound();
  const audit = await withTenant(
    operator.id,
    (tx) =>
      tx.query.audits.findFirst({
        where: and(eq(schema.audits.tenantId, operator.id), eq(schema.audits.id, id)),
      }),
    { role: "staff" },
  );
  if (!audit) notFound();

  // The party it is about, the workspace that points at that party (for the
  // link back), and the businesses it could be attached to instead.
  const partyId = audit.partyId;
  const [party, workspace, choices] = await Promise.all([
    partyId
      ? withTenant(
          operator.id,
          (tx) =>
            loadParty(tx, operator.id, partyId).catch((err: unknown) => {
              if (err instanceof PartyError && err.code === "PARTY_NOT_FOUND") return null;
              throw err;
            }),
          { role: "staff" },
        )
      : Promise.resolve(null),
    partyId
      ? withSystem((tx) =>
          tx.query.tenants.findFirst({
            where: eq(schema.tenants.operatorPartyId, partyId),
            columns: { id: true, name: true },
          }),
        )
      : Promise.resolve(null),
    withTenant(
      operator.id,
      (tx) =>
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(
            and(
              eq(schema.parties.tenantId, operator.id),
              eq(schema.parties.kind, "organization"),
              eq(schema.parties.isActive, true),
            ),
          )
          .orderBy(asc(schema.parties.displayName)),
      { role: "staff" },
    ),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/audits"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All discovery
      </Link>

      <PageHeader
        title={audit.businessName}
        description={
          <>
            <span className="capitalize">{audit.industry}</span>
            {audit.contactName && <> · {audit.contactName}</>}
            {" · started "}
            {audit.createdAt.toLocaleDateString()}
            {workspace && (
              <>
                {" · "}
                <Link
                  href={`/admin/tenants/${workspace.id}`}
                  className="underline hover:text-foreground"
                >
                  Workspace
                </Link>
              </>
            )}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {party && (
              <OpenInCrmButton
                partyId={party.id}
                operatorClerkOrgId={operator.clerkOrgId}
              />
            )}
            <DeleteAuditButton auditId={audit.id} />
          </div>
        }
      />

      {!party && (
        <div className="rounded-md border px-3 py-2 text-sm">
          <p className="mb-2 text-muted-foreground">
            {audit.partyId
              ? "The business this record pointed at no longer exists in the operator's CRM."
              : "This record is not attached to a business in the operator's CRM yet."}
          </p>
          <AttachAuditForm auditId={audit.id} parties={choices} />
        </div>
      )}

      <AuditWorkspace
        auditId={audit.id}
        status={audit.status}
        messages={(audit.messages as AuditMessage[]) ?? []}
        report={audit.report}
      />
    </div>
  );
}
