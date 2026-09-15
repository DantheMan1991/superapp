import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { attachmentsForRecord, splitAttachments } from "@/modules/documents/attachments";
import { roleMayWrite } from "@/modules/documents/core/errors";
import type { RecordFile, RecordPhoto } from "@/modules/documents/components/record-photos";
import { listOpenWork } from "@/lib/work/entity-work";
import { subcontractorStanding, type StandingState } from "@/packs/jobs/compliance-ops";
import { AskForDocumentButton, PartyDocumentForm } from "@/packs/jobs/components/party-document-form";
import {
  PACK,
  PARTY_DOCUMENT_ENTITY,
  PARTY_DOCUMENT_STATUS_LABELS,
  PARTY_ENTITY,
  isPartyDocumentStatus,
  partyDocumentKindLabel,
  requiredPartyDocumentsFrom,
} from "@/packs/jobs/vocabulary";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** What each state says, and whether it is a gap. */
function stateWord(state: StandingState, expiresOn: string | null): { text: string; gap: boolean; warn: boolean } {
  switch (state) {
    case "ok":
      return { text: expiresOn ? `On file, expires ${expiresOn}` : "On file", gap: false, warn: false };
    case "expiring":
      return { text: `Expires ${expiresOn}`, gap: false, warn: true };
    case "expired":
      return { text: `Expired ${expiresOn}`, gap: true, warn: false };
    default:
      return { text: "Not on file", gap: true, warn: false };
  }
}

/**
 * Every subcontractor and supplier with an order on a live job, and where
 * each stands on the documents the business requires — the insurance
 * audit's own view (ADR 0068). Missing, expired and expiring are worked out
 * against today and the required list; nothing is stored.
 */
export default async function SubcontractorsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");
  const asOf = today();

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK);
      const required = requiredPartyDocumentsFrom(pack.config);
      const [rows, openWork] = await Promise.all([
        subcontractorStanding(tx, ctx.tenant.id, required, asOf),
        listOpenWork(tx, { tenantId: ctx.tenant.id }),
      ]);
      const photos = new Map<string, RecordPhoto[]>();
      const files = new Map<string, RecordFile[]>();
      if (documentsOn) {
        const docs = rows.flatMap((r) => [...r.required.map((q) => q.document), ...r.others]).filter((d) => d !== null);
        for (const d of docs) {
          const attachments = await attachmentsForRecord(tx, ctx.tenant.id, {
            extensionSlug: PACK,
            entityType: PARTY_DOCUMENT_ENTITY,
            entityId: d.id,
          });
          const split = splitAttachments(attachments);
          photos.set(d.id, split.photos);
          files.set(d.id, split.files);
        }
      }
      /** Chases open per party, from Work's own read, filtered to this pack's party links. */
      const chasing = new Map<string, string[]>();
      for (const item of openWork) {
        for (const link of item.links) {
          if (link.entityType === PARTY_ENTITY) {
            chasing.set(link.entityId, [...(chasing.get(link.entityId) ?? []), item.title]);
          }
        }
      }
      return { rows, required, photos, files, chasing };
    },
    { role: ctx.role },
  );

  const { rows, required } = data;
  const canRecord = allowsWrite(ctx.role, "member");
  const canPhoto = canRecord && roleMayWrite(ctx.role);
  const symbol = ctx.tenant.currencySymbol;
  const notGood = rows.filter((r) => !r.good).length;
  const expiring = rows.filter((r) => r.good && r.required.some((q) => q.state === "expiring")).length;
  const form = (party: (typeof rows)[number], existing?: NonNullable<(typeof rows)[number]["required"][number]["document"]>) => (
    <PartyDocumentForm
      partyId={party.partyId}
      partyName={party.partyName}
      requiredKinds={required}
      documentsOn={documentsOn}
      tenantId={ctx.tenant.id}
      canPhoto={canPhoto}
      photos={existing ? (data.photos.get(existing.id) ?? []) : []}
      files={existing ? (data.files.get(existing.id) ?? []) : []}
      existing={
        existing
          ? {
              id: existing.id,
              version: existing.version,
              kind: existing.kind,
              title: existing.title,
              reference: existing.reference,
              issuer: existing.issuer,
              issuedOn: existing.issuedOn,
              expiresOn: existing.expiresOn,
              limitCents: existing.limitCents,
              status: existing.status,
              requestedOn: existing.requestedOn,
              receivedOn: existing.receivedOn,
              notes: existing.notes,
            }
          : undefined
      }
      trigger={
        existing ? (
          <Button variant="ghost" size="icon">
            <Pencil className="size-4" />
            <span className="sr-only">Edit {partyDocumentKindLabel(existing.kind)} from {party.partyName}</span>
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> All projects
      </Link>
      <PageHeader
        title="Subcontractors"
        description={
          rows.length === 0
            ? "Nobody with an order on a live job yet."
            : `${rows.length} with orders on live jobs · ${notGood === 0 ? "everybody in good standing" : `${notGood} not in good standing`}${
                expiring > 0 ? ` · ${expiring} expiring within a month` : ""
              }`
        }
      />

      <Panel className="p-5">
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            PER PARTY, NOT PER JOB (ADR 0068): a framer's certificate covers
            every job he is on. Required here: the tenant's list, or the pack's
            default of a certificate of insurance and a W-9.
          */}
          Required before a subcontractor or supplier is in good standing:{" "}
          {required.map((k) => partyDocumentKindLabel(k)).join(", ")}. A certificate past its date is as good as
          missing; one within a month is flagged. Anything else on file is listed beside them.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Subcontractors appear here once an issued order names them on a job that is not complete or cancelled.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[12rem]">Subcontractor</TableHead>
                  {required.map((k) => (
                    <TableHead key={k}>{partyDocumentKindLabel(k)}</TableHead>
                  ))}
                  <TableHead>Other documents</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((party) => (
                  <TableRow key={party.partyId}>
                    <TableCell className="font-medium">
                      {party.partyName}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {party.projects.map((p) => p.number).join(", ")}
                      </span>
                      {(data.chasing.get(party.partyId) ?? []).length > 0 && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Being chased in Work: {(data.chasing.get(party.partyId) ?? []).join(" · ")}
                        </span>
                      )}
                    </TableCell>
                    {party.required.map((q) => {
                      const word = stateWord(q.state, q.document?.expiresOn ?? null);
                      return (
                        <TableCell key={q.kind} className="text-sm">
                          <div className="flex items-center gap-2">
                            <div>
                              <span className={word.gap ? "text-destructive" : word.warn ? "font-medium" : ""}>
                                {word.text}
                              </span>
                              {q.document && (
                                <span className="block text-xs text-muted-foreground">
                                  {[
                                    q.document.title || null,
                                    q.document.issuer || null,
                                    q.document.limitCents !== null ? formatMoney(q.document.limitCents, symbol) : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              )}
                            </div>
                            {q.document && canRecord && form(party, q.document)}
                            {word.gap && canRecord && <AskForDocumentButton partyId={party.partyId} kind={q.kind} />}
                          </div>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-sm">
                      {party.others.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {party.others.map((d) => (
                            <li key={d.id} className="flex items-center gap-2">
                              <span>
                                {partyDocumentKindLabel(d.kind)}
                                {d.title ? ` · ${d.title}` : ""}
                                {d.expiresOn && (
                                  <span className={`block text-xs ${d.expiresOn < asOf ? "text-destructive" : "text-muted-foreground"}`}>
                                    {d.expiresOn < asOf ? "Expired" : "Expires"} {d.expiresOn}
                                  </span>
                                )}
                                {!d.expiresOn && (
                                  <span className="block text-xs text-muted-foreground">
                                    {isPartyDocumentStatus(d.status) ? PARTY_DOCUMENT_STATUS_LABELS[d.status] : d.status}
                                  </span>
                                )}
                              </span>
                              {canRecord && form(party, d)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Badge variant={party.good ? "default" : "secondary"}>
                          {party.good ? "Good standing" : "Not in good standing"}
                        </Badge>
                        {canRecord && form(party)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          A document is on file once it is received with its date; a requested
          one is not yet. <em>Ask for it</em>{" "}
          puts the chase in Work, linked to
          the subcontractor. The certificate attaches to the document once it is
          recorded — a photo, a file, or one already in Documents. Which kinds are required is the business&apos;s own list.
        </p>
      </Panel>
    </div>
  );
}
