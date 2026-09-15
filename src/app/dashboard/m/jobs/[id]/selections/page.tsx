import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney, formatMoneySign } from "@/lib/money";
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
import { attachmentsForRecord } from "@/modules/documents/attachments";
import { isDisplayableImage } from "@/modules/documents/allowlist";
import { roleMayWrite } from "@/modules/documents/core/errors";
import type { RecordPhoto } from "@/modules/documents/components/record-photos";
import { listOpenWork } from "@/lib/work/entity-work";
import { getProject, listContracts, listCostCodes } from "@/packs/jobs/ops";
import { listSelections, summarise } from "@/packs/jobs/selections-ops";
import {
  RaiseSelectionChangeOrder,
  RemindSelectionButton,
  SelectionForm,
} from "@/packs/jobs/components/selection-form";
import { formatQuantity } from "@/packs/jobs/billing-math";
import {
  CHANGE_ORDER_STATUS_LABELS,
  PACK,
  SELECTION_ENTITY,
  SELECTION_STATUS_LABELS,
  isChangeOrderStatus,
  isSelectionStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";

/** Today as the date column wants it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Every selection on a job: what the client still owes, what the contract
 * set aside, what was chosen and what it costs, and the difference — raised
 * as a change order from here (ADR 0067).
 *
 * THE PHOTOS ARE DOCUMENTS' and the reminders are Work's, through the seams
 * every pack uses; this page names the entity type and nothing else about
 * either.
 */
export default async function SelectionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");
  const asOf = today();

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [rows, contracts, codes, parties, openWork, pack] = await Promise.all([
        listSelections(tx, ctx.tenant.id, project.id, asOf),
        listContracts(tx, ctx.tenant.id, project.id),
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        listOpenWork(tx, { tenantId: ctx.tenant.id }),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      const photos = new Map<string, RecordPhoto[]>();
      if (documentsOn) {
        for (const r of rows) {
          const attachments = await attachmentsForRecord(tx, ctx.tenant.id, {
            extensionSlug: PACK,
            entityType: SELECTION_ENTITY,
            entityId: r.selection.id,
          });
          photos.set(
            r.selection.id,
            attachments
              .filter((a) => isDisplayableImage(a.document.mimeType))
              .map((a) => ({
                documentId: a.document.id,
                fileName: a.document.fileName,
                title: a.document.title ?? "",
                mimeType: a.document.mimeType,
                isPrimary: a.isPrimary,
              })),
          );
        }
      }
      /** Reminders open per selection, from Work's own read, filtered to this pack's links. */
      const reminders = new Map<string, number>();
      for (const item of openWork) {
        for (const link of item.links) {
          if (link.entityType === SELECTION_ENTITY) {
            reminders.set(link.entityId, (reminders.get(link.entityId) ?? 0) + 1);
          }
        }
      }
      return { project, rows, contracts, codes, parties, photos, reminders, labels: pack.labels };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, rows } = data;
  const summary = summarise(rows);
  const isOwner = allowsWrite(ctx.role, "owner");
  const canSelect = allowsWrite(ctx.role, "member");
  const canPhoto = canSelect && roleMayWrite(ctx.role);
  const symbol = ctx.tenant.currencySymbol;
  const projectWord = labelFor(data.labels, "project", "Project");
  const contractOptions = data.contracts.map((c) => ({
    id: c.id,
    label: `${slugLabel(c.kind)}${c.name ? ` · ${c.name}` : ""}`,
  }));
  const codeOptions = (row?: (typeof rows)[number]) =>
    data.codes
      .filter((c) => c.isActive || row?.selection.costCodeId === c.id)
      .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }));
  const form = (row?: (typeof rows)[number]) => (
    <SelectionForm
      projectId={project.id}
      contracts={contractOptions}
      costCodes={codeOptions(row)}
      parties={data.parties}
      documentsOn={documentsOn}
      tenantId={ctx.tenant.id}
      canPhoto={canPhoto}
      photos={row ? (data.photos.get(row.selection.id) ?? []) : []}
      existing={
        row
          ? {
              id: row.selection.id,
              version: row.selection.version,
              contractId: row.selection.contractId,
              costCodeId: row.selection.costCodeId,
              name: row.selection.name,
              location: row.selection.location,
              description: row.selection.description,
              allowanceCents: row.selection.allowanceCents,
              neededBy: row.selection.neededBy,
              status: row.selection.status,
              decidedOn: row.selection.decidedOn,
              notes: row.selection.notes,
              choices: row.choices.map((c) => ({
                id: c.id,
                description: c.description,
                partyId: c.partyId,
                reference: c.reference,
                unit: c.unit,
                quantityThousandths: c.quantityThousandths,
                unitPriceCents: c.unitPriceCents,
                priceCents: c.priceCents,
                isSelected: c.isSelected,
              })),
              raisedNumber: row.changeOrder?.number ?? null,
            }
          : undefined
      }
      trigger={
        row ? (
          <Button variant="ghost" size="icon">
            <Pencil className="size-4" />
            <span className="sr-only">Edit {row.selection.name}</span>
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/m/jobs/${project.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> {project.number} · {project.name}
      </Link>
      <PageHeader
        title="Selections"
        description={`${projectWord} ${project.number} · ${summary.count} ${summary.count === 1 ? "selection" : "selections"}, ${summary.pending} pending${summary.overdue > 0 ? `, ${summary.overdue} overdue` : ""}`}
        actions={canSelect ? form() : null}
      />

      {/*
        THE FIVE NUMBERS A CUSTOM BUILDER WATCHES: what the contract set aside,
        what has been chosen, the difference, what of it is approved and not
        yet raised, and what has been raised. Computed from the rows; nothing
        here is stored (ADR 0067).
      */}
      <dl className="grid gap-3 sm:grid-cols-5">
        {(
          [
            ["Allowances", formatMoney(summary.allowancesCents, symbol), `${summary.count} ${summary.count === 1 ? "selection" : "selections"}`],
            ["Chosen", formatMoney(summary.chosenCents, symbol), `${summary.count - summary.pending} decided`],
            [
              summary.differenceCents >= 0 ? "Over" : "Under",
              formatMoney(Math.abs(summary.differenceCents), symbol),
              "chosen less allowances",
            ],
            ["To raise", formatMoneySign(summary.toRaiseCents, symbol), "approved, not yet a change order"],
            ["Raised", formatMoneySign(summary.raisedCents, symbol), "as change orders"],
          ] as const
        ).map(([label, value, note]) => (
          <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-base font-medium tabular-nums">{value}</dd>
            <dd className="text-xs text-muted-foreground">{note}</dd>
          </div>
        ))}
      </dl>

      <Panel className="p-5">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to choose yet. A selection is a decision the client owes — the
            tile, the countertops, the front door — with what the contract set
            aside for it and the date it is needed by. List what is on offer under
            it, mark what they pick, and raise the difference as a change order.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Selection</TableHead>
                  <TableHead>Needed by</TableHead>
                  <TableHead className="text-right">Allowance</TableHead>
                  <TableHead>Chosen</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Over / under</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const s = row.selection;
                  const reminders = data.reminders.get(s.id) ?? 0;
                  const canRaise =
                    isOwner &&
                    s.status === "approved" &&
                    row.differenceCents !== null &&
                    row.differenceCents !== 0 &&
                    !row.changeOrder &&
                    s.contractId !== null;
                  return (
                    <TableRow key={s.id} className={s.status === "cancelled" ? "opacity-60" : undefined}>
                      <TableCell className="font-medium">
                        {s.name}
                        {(s.location || row.codeLabel || row.contract) && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {[
                              s.location || null,
                              row.codeLabel,
                              row.contract
                                ? `${slugLabel(row.contract.kind)}${row.contract.name ? ` · ${row.contract.name}` : ""}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className={row.overdue ? "text-destructive" : undefined}>
                        {s.neededBy ?? "—"}
                        {row.overdue && <span className="block text-xs">overdue</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.allowanceCents === 0 ? "—" : formatMoney(s.allowanceCents, symbol)}
                      </TableCell>
                      <TableCell>
                        {row.chosen ? (
                          <>
                            {row.chosen.description}
                            <span className="block text-xs text-muted-foreground">
                              {[
                                row.chosen.reference || null,
                                row.chosen.quantityThousandths !== null && row.chosen.unitPriceCents !== null
                                  ? `${formatQuantity(row.chosen.quantityThousandths)} ${row.chosen.unit} at ${formatMoney(row.chosen.unitPriceCents, symbol)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">
                            {row.choices.length === 0
                              ? "Nothing on offer yet"
                              : `${row.choices.length} on offer`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.chosen ? formatMoney(row.chosen.priceCents, symbol) : "—"}
                      </TableCell>
                      {/* Signed: an underage is a credit, and reads as a minus. */}
                      <TableCell
                        className={`text-right tabular-nums ${
                          row.differenceCents !== null && row.differenceCents > 0 ? "text-destructive" : ""
                        }`}
                      >
                        {row.differenceCents === null ? "—" : formatMoneySign(row.differenceCents, symbol)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.status === "approved" ? "default" : "secondary"}>
                          {isSelectionStatus(s.status) ? SELECTION_STATUS_LABELS[s.status] : s.status}
                        </Badge>
                        {s.decidedOn && (
                          <span className="block text-xs text-muted-foreground">Decided {s.decidedOn}</span>
                        )}
                        {row.changeOrder && (
                          <span className="block text-xs text-muted-foreground">
                            {row.changeOrder.number} ·{" "}
                            {isChangeOrderStatus(row.changeOrder.status)
                              ? CHANGE_ORDER_STATUS_LABELS[row.changeOrder.status]
                              : row.changeOrder.status}
                          </span>
                        )}
                        {reminders > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {reminders === 1 ? "Reminder open in Work" : `${reminders} reminders open in Work`}
                          </span>
                        )}
                        {row.attachmentCount > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {row.attachmentCount} {row.attachmentCount === 1 ? "photo" : "photos"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canRaise && row.differenceCents !== null && (
                            <RaiseSelectionChangeOrder
                              projectId={project.id}
                              selectionId={s.id}
                              selectionName={s.name}
                              differenceCents={row.differenceCents}
                              symbol={symbol}
                            />
                          )}
                          {canSelect && s.status === "pending" && (
                            <RemindSelectionButton projectId={project.id} selectionId={s.id} />
                          )}
                          {canSelect && form(row)}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          The difference is the chosen price less the allowance, and only a
          selected or approved selection counts. Once a selection is approved,
          the difference is raised as a change order on its contract — the
          overage as the price, an underage as a credit — and the selection
          remembers which, so it cannot be raised twice. A pending selection
          past its date is overdue; <em>Remind</em> puts it in Work.
        </p>
      </Panel>
    </div>
  );
}
