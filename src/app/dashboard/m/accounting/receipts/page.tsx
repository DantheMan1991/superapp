import Link from "next/link";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { FileText, Inbox } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listDocuments } from "@/modules/accounting/documents/documents";
import { readExtraction } from "@/modules/accounting/ai/extract-validate";
import { formatCents } from "@/modules/accounting/lib/money";
import {
  DocumentRowActions,
  EmailInCard,
  UploadButton,
  type AccountOption,
  type DocumentRowData,
} from "./receipts-controls";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "inbox", label: "Inbox" },
  { key: "filed", label: "Filed" },
  { key: "trash", label: "Trash" },
] as const;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;
  const tab = (["inbox", "filed", "trash"].includes(sp.tab ?? "")
    ? sp.tab
    : "inbox") as "inbox" | "filed" | "trash";

  const data = await withTenant(tenantId, async (tx) => {
    const documents = await listDocuments(tx, tenantId, tab);
    const counts = await tx
      .select({
        status: schema.documents.status,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.documents)
      .where(eq(schema.documents.tenantId, tenantId))
      .groupBy(schema.documents.status);
    const settings = await tx.query.accountingSettings.findFirst({
      where: eq(schema.accountingSettings.tenantId, tenantId),
    });
    const accounts = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    const linkCounts =
      tab === "filed"
        ? await tx
            .select({
              documentId: schema.documentLinks.documentId,
              n: sql<number>`count(*)::int`,
            })
            .from(schema.documentLinks)
            .innerJoin(
              schema.documents,
              and(
                eq(schema.documents.tenantId, schema.documentLinks.tenantId),
                eq(schema.documents.id, schema.documentLinks.documentId),
              ),
            )
            .where(
              and(
                eq(schema.documentLinks.tenantId, tenantId),
                isNotNull(schema.documentLinks.documentId),
              ),
            )
            .groupBy(schema.documentLinks.documentId)
        : [];
    return { documents, counts, settings, accounts, linkCounts };
  });

  const countOf = new Map(data.counts.map((c) => [c.status, c.n]));
  const isOwner = ctx.role === "owner";
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN ?? "";

  const accountOptions: AccountOption[] = data.accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    accountType: a.accountType,
    subtype: a.subtype,
  }));

  const rows: DocumentRowData[] = data.documents.map((doc) => {
    const extraction = readExtraction(doc.extraction);
    return {
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
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Bills &amp; Receipts
          </h1>
          <p className="text-sm text-muted-foreground">
            Bills and receipts for {ctx.tenant.name} — captured by upload or
            email, read automatically, attached to your books.
          </p>
        </div>
        <UploadButton tenantId={tenantId} />
      </div>

      <AccountingNav />

      {isOwner && (
        <EmailInCard
          address={
            data.settings?.inboundEmailToken && inboundDomain
              ? `receipts-${data.settings.inboundEmailToken}@${inboundDomain}`
              : null
          }
          configured={!!inboundDomain}
        />
      )}

      <div className="flex gap-1 border-b pb-px">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/dashboard/m/accounting/receipts?tab=${t.key}`}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-muted-foreground">
              {countOf.get(t.key === "trash" ? "trashed" : t.key) ?? 0}
            </span>
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {tab === "inbox"
                ? "Nothing waiting"
                : tab === "filed"
                  ? "Nothing filed yet"
                  : "Trash is empty"}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {tab === "inbox"
                ? "Upload a bill or receipt — or forward one to your email-in address — and it will land here, read and ready to file."
                : tab === "filed"
                  ? "Documents attached to transactions show up here."
                  : "Trashed documents can be restored any time — nothing is ever permanently deleted."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y rounded-md border">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2.5"
            >
              <Link
                href={`/dashboard/m/accounting/receipts/${row.id}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                {row.hasBlob && row.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/accounting/documents/${row.id}/file`}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded border object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {row.vendorName ?? row.fileName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.source === "email"
                      ? `Email · ${row.emailFrom || "unknown sender"}`
                      : "Upload"}
                    {" · "}
                    {row.createdAt.slice(0, 10)}
                  </span>
                </span>
              </Link>

              <span className="flex items-center gap-2">
                {row.extractionStatus === "done" && row.totalCents !== null && (
                  <Badge variant="secondary" className="font-mono">
                    ${formatCents(Math.abs(row.totalCents))}
                  </Badge>
                )}
                {row.extractionStatus === "done" && row.documentDate && (
                  <Badge variant="outline">{row.documentDate}</Badge>
                )}
                {row.extractionStatus === "pending" && (
                  <Badge variant="outline">Not read yet</Badge>
                )}
                {row.extractionStatus === "failed" && (
                  <Badge variant="destructive">Couldn&apos;t read</Badge>
                )}
              </span>

              <DocumentRowActions
                row={row}
                accounts={accountOptions}
                isOwner={isOwner}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
