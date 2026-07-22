import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, FileText } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listLinksForDocument } from "@/modules/accounting/documents/links";
import { readExtraction } from "@/modules/accounting/ai/extract-validate";
import { formatCents } from "@/modules/accounting/lib/money";
import {
  DocumentRowActions,
  type AccountOption,
  type DocumentRowData,
} from "../receipts-controls";
import { DetachLinkButton } from "./detail-controls";

export const dynamic = "force-dynamic";

export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const { id } = await params;

  const data = await withTenant(tenantId, async (tx) => {
    const doc = await tx.query.documents.findFirst({
      where: and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.id, id),
      ),
    });
    if (!doc) return null;
    const links = await listLinksForDocument(tx, tenantId, id);
    const accounts = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    return { doc, links, accounts };
  });
  if (!data) notFound();
  const { doc, links } = data;

  const extraction = readExtraction(doc.extraction);
  const isOwner = ctx.role === "owner";
  const accountOptions: AccountOption[] = data.accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    accountType: a.accountType,
    subtype: a.subtype,
  }));
  const row: DocumentRowData = {
    id: doc.id,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    source: doc.source,
    emailFrom: doc.emailFrom,
    status: doc.status,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    hasBlob: !!doc.blobPathname,
    extractionStatus: doc.extractionStatus,
    vendorName: extraction?.fields.vendorName.value ?? null,
    totalCents: extraction?.fields.totalCents.value ?? null,
    documentDate: extraction?.fields.documentDate.value ?? null,
    docType: extraction?.docType ?? null,
  };

  const fields: Array<{ label: string; value: string | null; confidence: number }> =
    extraction
      ? [
          {
            label: "Vendor",
            value: extraction.fields.vendorName.value,
            confidence: extraction.fields.vendorName.confidence,
          },
          {
            label: "Date",
            value: extraction.fields.documentDate.value,
            confidence: extraction.fields.documentDate.confidence,
          },
          {
            label: "Total",
            value:
              extraction.fields.totalCents.value !== null
                ? `$${formatCents(Math.abs(extraction.fields.totalCents.value))}`
                : null,
            confidence: extraction.fields.totalCents.confidence,
          },
          {
            label: "Tax",
            value:
              extraction.fields.taxCents.value !== null
                ? `$${formatCents(Math.abs(extraction.fields.taxCents.value))}`
                : null,
            confidence: extraction.fields.taxCents.confidence,
          },
          {
            label: "Currency",
            value: extraction.fields.currency.value,
            confidence: extraction.fields.currency.confidence,
          },
          {
            label: "Number",
            value: extraction.fields.documentNumber.value,
            confidence: extraction.fields.documentNumber.confidence,
          },
        ]
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/m/accounting/receipts"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Receipts
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {row.vendorName ?? doc.fileName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {doc.source === "email"
              ? `Emailed by ${doc.emailFrom || "unknown sender"}${doc.emailSubject ? ` · “${doc.emailSubject}”` : ""}`
              : "Uploaded"}
            {" · "}
            {doc.createdAt.toISOString().slice(0, 10)}
            {doc.status === "trashed" && " · in trash"}
          </p>
        </div>
        <DocumentRowActions row={row} accounts={accountOptions} isOwner={isOwner} />
      </div>

      <AccountingNav />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {!doc.blobPathname ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" /> This email arrived with no
                readable attachment — kept for the paper trail.
              </p>
            ) : doc.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/accounting/documents/${doc.id}/file`}
                alt={doc.fileName}
                className="max-h-[70vh] w-full rounded-md border object-contain"
              />
            ) : (
              <iframe
                src={`/api/accounting/documents/${doc.id}/file`}
                title={doc.fileName}
                className="h-[70vh] w-full rounded-md border"
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What we read</CardTitle>
            </CardHeader>
            <CardContent>
              {doc.extractionStatus === "done" && extraction ? (
                <dl className="space-y-2">
                  {fields.map((f) => (
                    <div
                      key={f.label}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <dt className="text-muted-foreground">{f.label}</dt>
                      <dd className="flex items-center gap-2">
                        <span>{f.value ?? "—"}</span>
                        {f.value !== null && (
                          <Badge
                            variant={f.confidence >= 0.8 ? "secondary" : "outline"}
                            className="text-[10px]"
                          >
                            {Math.round(f.confidence * 100)}%
                          </Badge>
                        )}
                      </dd>
                    </div>
                  ))}
                  {extraction.lineItems.length > 0 && (
                    <div className="pt-2">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        Line items
                      </p>
                      <ul className="space-y-1 text-xs">
                        {extraction.lineItems.map((li, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="truncate">{li.description}</span>
                            <span className="font-mono">
                              {li.amountCents !== null
                                ? `$${formatCents(Math.abs(li.amountCents))}`
                                : "—"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {doc.extractionStatus === "pending"
                    ? "Not read yet — use the Read button."
                    : doc.extractionStatus === "failed"
                      ? "We couldn't read this document automatically."
                      : "Nothing to read for this record."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Attached to</CardTitle>
            </CardHeader>
            <CardContent>
              {links.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Not attached to anything yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {links.map((view) => (
                    <li
                      key={view.link.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate">{view.label}</span>
                      <DetachLinkButton linkId={view.link.id} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
