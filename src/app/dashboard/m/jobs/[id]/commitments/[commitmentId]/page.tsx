import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { attachmentsForRecord, splitAttachments } from "@/modules/documents/attachments";
import { roleMayWrite } from "@/modules/documents/core/errors";
import type { RecordFile, RecordPhoto } from "@/modules/documents/components/record-photos";
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
import {
  getProject,
  listChangeOrders,
  listCommitmentChangeOrders,
  listCommitments,
  listCostCodes,
} from "@/packs/jobs/ops";
import {
  commitmentBilling,
  getCommitment,
  listSubApplications,
} from "@/packs/jobs/sub-billing-ops";
import { percentComplete, ppmToPercentString } from "@/packs/jobs/billing-math";
import {
  CHANGE_ORDER_STATUS_LABELS,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUS_LABELS,
  LIEN_WAIVER_ENTITY,
  LIEN_WAIVER_KIND_LABELS,
  LIEN_WAIVER_STATUS_LABELS,
  PACK,
  SUB_APPLICATION_STATUS_LABELS,
  isChangeOrderStatus,
  isCommitmentKind,
  isCommitmentStatus,
  isFinalWaiver,
  isLienWaiverKind,
  isLienWaiverStatus,
  isSubApplicationStatus,
  isUnconditionalWaiver,
} from "@/packs/jobs/vocabulary";
import { CommitmentChangeForm } from "@/packs/jobs/components/commitment-change-form";
import {
  listLienWaivers,
  listWaiverWork,
  waiverCoverage,
  waiverGaps,
} from "@/packs/jobs/compliance-ops";
import { AskForWaiverButton, LienWaiverForm } from "@/packs/jobs/components/lien-waiver-form";
import {
  NewPayApplication,
  PayApplicationEditor,
  VoidPayApplicationButton,
} from "@/packs/jobs/components/pay-application-editor";

const BILL_BASE = "/dashboard/m/accounting/purchases/bills";

/** What Accounting says about the bill, in the words a builder reads. */
function billWord(status: string): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "partial":
      return "Partly paid";
    case "void":
      return "Void";
    default:
      return "Open";
  }
}

/**
 * One commitment: its lines, and — on a subcontract — the applications the
 * subcontractor has sent against it, with the retainage held from each.
 *
 * THE OTHER SIDE OF THE TABLE. The contract page bills the client; this page
 * records what a subcontractor bills the business, through the same
 * certificate and the same editor, and approving one makes it an ordinary
 * bill (ADR 0061). A purchase order has no applications: it is billed with a
 * bill in Accounting, because retainage attaches to bought labour.
 */
export default async function CommitmentPage({
  params,
}: {
  params: Promise<{ id: string; commitmentId: string }>;
}) {
  const { id, commitmentId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const documentsOn = await isModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const commitment = await getCommitment(tx, ctx.tenant.id, commitmentId);
      if (!commitment || commitment.projectId !== project.id) return null;
      const [rows, apps, codes, billing, changes, clientChanges, allWaivers, coverage, gaps, chasing, parties, pack] =
        await Promise.all([
          listCommitments(tx, ctx.tenant.id, project.id),
          listSubApplications(tx, ctx.tenant.id, commitment.id),
          project.costCodeSetId
            ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
            : Promise.resolve([]),
          commitmentBilling(tx, ctx.tenant.id, project.id),
          listCommitmentChangeOrders(tx, ctx.tenant.id, project.id),
          listChangeOrders(tx, ctx.tenant.id, project.id),
          listLienWaivers(tx, ctx.tenant.id, project.id),
          waiverCoverage(tx, ctx.tenant.id, project.id),
          waiverGaps(tx, ctx.tenant.id, project.id),
          listWaiverWork(tx, ctx.tenant.id, commitment.id),
          tx
            .select({ id: schema.parties.id, name: schema.parties.displayName })
            .from(schema.parties)
            .where(eq(schema.parties.tenantId, ctx.tenant.id))
            .limit(500),
          packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        ]);
      const row = rows.find((r) => r.commitment.id === commitment.id) ?? null;
      const waivers = allWaivers.filter((w) => w.waiver.commitmentId === commitment.id);
      // The signed copies, Documents' rows: the same gallery a daily log's photos use.
      const photos = new Map<string, RecordPhoto[]>();
      const files = new Map<string, RecordFile[]>();
      if (documentsOn) {
        for (const w of waivers) {
          const attachments = await attachmentsForRecord(tx, ctx.tenant.id, {
            extensionSlug: PACK,
            entityType: LIEN_WAIVER_ENTITY,
            entityId: w.waiver.id,
          });
          const split = splitAttachments(attachments);
          photos.set(w.waiver.id, split.photos);
          files.set(w.waiver.id, split.files);
        }
      }
      return {
        project,
        commitment,
        vendorName: row?.vendorName ?? "—",
        lines: row?.lines ?? [],
        originalCents: row?.originalCents ?? 0,
        changesCents: row?.changesCents ?? 0,
        totalCents: row?.totalCents ?? 0,
        apps,
        codes,
        billing: billing.get(commitment.id) ?? null,
        /** This order's change orders, and the job's client-side ones a change may pass down. */
        changes: changes.filter((c) => c.commitment.id === commitment.id),
        clientChanges,
        waivers,
        coverage: coverage.get(commitment.id) ?? null,
        gaps: gaps.filter((g) => g.commitmentId === commitment.id),
        chasing,
        parties,
        photos,
        files,
        labels: pack.labels,
      };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, commitment, apps, changes } = data;
  /** The schedule: the lines the order was placed with and its approved changes' — a proposed change's wait in the panel below. */
  const lines = data.lines.filter((l) => l.counted);
  const approvedChanges = changes.filter((c) => c.changeOrder.status === "approved").length;
  const proposedChanges = changes.filter((c) => c.changeOrder.status === "proposed").length;
  const isOwner = allowsWrite(ctx.role, "owner");
  const symbol = ctx.tenant.currencySymbol;
  const projectWord = labelFor(data.labels, "project", "Project");
  const subcontract = commitment.kind === "subcontract";
  const kindWord = isCommitmentKind(commitment.kind)
    ? COMMITMENT_KIND_LABELS[commitment.kind]
    : commitment.kind;
  const billed = apps.filter((a) => a.app.status === "billed");
  const latestBilled = billed.length > 0 ? billed[billed.length - 1] : null;
  const draft = apps.find((a) => a.app.status === "draft") ?? null;
  const billedCents = data.billing?.billedCents ?? 0;
  const retainageHeld = data.billing?.retainageHeldCents ?? 0;
  const balanceToFinish = data.totalCents - (latestBilled?.totals.completedToDateCents ?? 0);
  const codeLabel = new Map(data.codes.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const newDisabled = draft
    ? "Finish the open draft first"
    : lines.length === 0
      ? "The subcontract has no lines yet"
      : null;
  const linesWord = `${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
  /** Original + approved changes, said under the value when a change has moved it. */
  const valueNote =
    data.changesCents === 0
      ? linesWord
      : `orig. ${formatMoney(data.originalCents, symbol)} · ${formatMoneySign(data.changesCents, symbol)} in approved changes · ${linesWord}`;
  const commitmentLabel = `${commitment.number}${commitment.description ? ` · ${commitment.description}` : ""}`;
  /** Recording a waiver is a chore; a photo of the signed page follows Documents' own rule. */
  const canWaiver = allowsWrite(ctx.role, "member");
  const canPhoto = canWaiver && roleMayWrite(ctx.role);
  const gapFor = new Map(data.gaps.map((g) => [g.subApplicationId, g]));
  /** Whether a RECEIVED waiver of the kind covers the application: names it, is final, or runs through its period end. */
  const onFile = (app: { id: string; periodTo: string }, unconditional: boolean) =>
    data.waivers.some(
      (w) =>
        w.waiver.status === "received" &&
        isUnconditionalWaiver(w.waiver.kind) === unconditional &&
        (w.waiver.subApplicationId === app.id ||
          isFinalWaiver(w.waiver.kind) ||
          w.waiver.throughDate >= app.periodTo),
    );
  const waiverForm = (
    existing?: Parameters<typeof LienWaiverForm>[0]["existing"],
    trigger?: ReactNode,
  ) => (
    <LienWaiverForm
      projectId={project.id}
      commitmentId={commitment.id}
      commitmentLabel={commitmentLabel}
      defaultPartyId={commitment.partyId}
      parties={data.parties}
      applications={billed.map((a) => ({
        id: a.app.id,
        label: `Application ${a.app.number} — ${a.app.periodTo} · ${formatMoneySign(a.totals.dueCents, symbol)}`,
      }))}
      documentsOn={documentsOn}
      tenantId={ctx.tenant.id}
      canPhoto={canPhoto}
      photos={existing ? (data.photos.get(existing.id) ?? []) : []}
      files={existing ? (data.files.get(existing.id) ?? []) : []}
      existing={existing}
      trigger={trigger}
    />
  );
  const cov = data.coverage;
  const coverageSentence =
    data.waivers.length === 0 && billed.length === 0
      ? "None yet. A lien waiver is the document a subcontractor or supplier signs to give up its lien right for the work paid — conditional with the application, unconditional once the money has gone out. Record each one here, and the job's page says who has been paid without one."
      : `${
          cov?.finalOnFile
            ? "A final unconditional waiver is on file"
            : cov?.unconditionalThrough
              ? `Unconditional waiver on file through ${cov.unconditionalThrough}`
              : "No unconditional waiver on file"
        }${cov?.conditionalThrough ? `; conditional through ${cov.conditionalThrough}` : ""}.`;
  const changeForm = (existing?: Parameters<typeof CommitmentChangeForm>[0]["existing"], trigger?: ReactNode) => (
    <CommitmentChangeForm
      projectId={project.id}
      commitmentId={commitment.id}
      commitmentLabel={commitmentLabel}
      changeOrders={data.clientChanges.map((c) => ({
        id: c.changeOrder.id,
        label: `${c.changeOrder.number} · ${c.changeOrder.title}`,
      }))}
      costCodes={data.codes
        .filter((c) => c.isActive || existing?.lines.some((l) => l.costCodeId === c.id))
        .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
      existing={existing}
      trigger={trigger}
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
        title={`${commitment.number}${commitment.description ? ` · ${commitment.description}` : ""}`}
        description={`${kindWord} · ${data.vendorName} · ${projectWord} ${project.number}`}
        actions={
          <Badge variant={commitment.status === "issued" ? "default" : "secondary"}>
            {isCommitmentStatus(commitment.status)
              ? COMMITMENT_STATUS_LABELS[commitment.status]
              : commitment.status}
          </Badge>
        }
      />

      {/*
        THE FOUR NUMBERS OF WHAT A SUBCONTRACTOR IS OWED: the subcontract's
        sum, what has been billed against it, what the business is holding
        back, and what is left to bill. A purchase order shows the first alone.
      */}
      <dl className={`grid gap-3 ${subcontract ? "sm:grid-cols-4" : "sm:grid-cols-1"}`}>
        {(
          subcontract
            ? ([
                [`${kindWord} value`, formatMoneySign(data.totalCents, symbol), valueNote],
                ["Billed to date", formatMoney(billedCents, symbol), `${billed.length} ${billed.length === 1 ? "application" : "applications"}`],
                ["Retainage held", formatMoney(retainageHeld, symbol), "what the business holds back"],
                ["Balance to finish", formatMoneySign(balanceToFinish, symbol), null],
              ] as const)
            : ([[`${kindWord} value`, formatMoneySign(data.totalCents, symbol), valueNote]] as const)
        ).map(([label, value, note]) => (
          <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-base font-medium tabular-nums">{value}</dd>
            {note && <dd className="text-xs text-muted-foreground">{note}</dd>}
          </div>
        ))}
      </dl>

      <Panel className="p-5">
        <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">Lines</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {subcontract
            ? "The subcontract's lines are what its applications bill against — the schedule of values: the lines it was placed with, and the lines of every approved change order below. The original lines are edited from the job's page while the order is a draft; once it is issued, the order moves by change order."
            : "What was ordered, and what approved change orders have added. A purchase order is billed with an ordinary bill in Accounting, coded to the job and the line's cost code."}
        </p>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lines yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Cost code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  {subcontract && <TableHead className="text-right">Complete</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l, i) => {
                  const latestLine = latestBilled?.lines.find((x) => x.commitmentLineId === l.id);
                  const completed = latestLine
                    ? latestLine.previousCents + latestLine.thisPeriodCents + latestLine.storedCents
                    : 0;
                  const pct = percentComplete(completed, l.amountCents);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="text-xs">
                        {l.costCodeId ? (codeLabel.get(l.costCodeId) ?? "—") : "—"}
                      </TableCell>
                      <TableCell>
                        {l.description || "—"}
                        {l.change && (
                          <span className="block text-xs text-muted-foreground">
                            Added by {l.change.number}
                          </span>
                        )}
                      </TableCell>
                      {/* Signed: a change order's line may be a deduction. */}
                      <TableCell className="text-right tabular-nums">
                        {formatMoneySign(l.amountCents, symbol)}
                      </TableCell>
                      {subcontract && (
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {pct === null ? "—" : `${pct}%`}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Change orders</h2>
          {isOwner && changeForm()}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE PAYABLE SIDE OF original + approved changes = revised. A change
            adds lines to this order; only an approved one moves what the job
            has committed and reaches the subcontractor's next application.
          */}
          {changes.length === 0
            ? `None yet. When the scope of this ${kindWord.toLowerCase()} moves — more work, less work, a price agreed after the fact — a change order records it as lines of its own, and only an approved one moves the numbers.`
            : `${approvedChanges} approved, worth ${formatMoneySign(data.changesCents, symbol)} on the ${kindWord.toLowerCase()}${
                proposedChanges > 0 ? `, with ${proposedChanges} still proposed` : ""
              }.`}
        </p>
        {changes.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((row) => (
                  <TableRow key={row.changeOrder.id}>
                    <TableCell className="font-mono text-xs">{row.changeOrder.number}</TableCell>
                    <TableCell className="font-medium">
                      {row.changeOrder.title}
                      {row.changeOrder.approvedOn && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Approved {row.changeOrder.approvedOn}
                        </span>
                      )}
                      {row.passesDown && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Passes down {row.passesDown.number} · {row.passesDown.title}
                        </span>
                      )}
                    </TableCell>
                    {/* Signed: scope taken back is a negative number. */}
                    <TableCell className="text-right tabular-nums">
                      {row.lines.length === 0 ? "—" : formatMoneySign(row.amountCents, symbol)}
                      {row.lines.length > 1 && (
                        <span className="block text-xs text-muted-foreground">
                          {row.lines.length} lines
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.changeOrder.status === "approved" ? "default" : "secondary"}>
                        {isChangeOrderStatus(row.changeOrder.status)
                          ? CHANGE_ORDER_STATUS_LABELS[row.changeOrder.status]
                          : row.changeOrder.status}
                      </Badge>
                      {row.billed && (
                        <span className="block text-xs text-muted-foreground">Billed against</span>
                      )}
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {isOwner &&
                        changeForm(
                          {
                            id: row.changeOrder.id,
                            version: row.changeOrder.version,
                            number: row.changeOrder.number,
                            title: row.changeOrder.title,
                            description: row.changeOrder.description,
                            status: row.changeOrder.status,
                            requestedOn: row.changeOrder.requestedOn,
                            approvedOn: row.changeOrder.approvedOn,
                            notes: row.changeOrder.notes,
                            changeOrderId: row.changeOrder.changeOrderId,
                            lines: row.lines.map((l) => ({
                              costCodeId: l.costCodeId,
                              description: l.description,
                              amountCents: l.amountCents,
                            })),
                            billed: row.billed,
                          },
                          <Button variant="ghost" size="icon">
                            <Pencil className="size-4" />
                            <span className="sr-only">Edit {row.changeOrder.number}</span>
                          </Button>,
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          An approved change&apos;s lines join the lines above and count on the
          job at once. A line may be negative — scope taken back — and a change
          with no lines is a change to the words or the dates. Once the
          subcontractor has billed against a change, it stays approved and its
          lines stay as they are.
        </p>
      </Panel>

      {subcontract && (
        <Panel className="p-5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-sm font-medium tracking-heading">
              Subcontractor applications
            </h2>
            {isOwner && (
              <NewPayApplication
                projectId={project.id}
                contractId={commitment.id}
                mode="commitment"
                lastRetainagePpm={latestBilled?.app.retainagePpm ?? null}
                disabledReason={newDisabled}
              />
            )}
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {apps.length === 0
              ? "When the subcontractor sends an application, record how much of each line is complete to date; what is due is that, less the retainage held back, less what earlier applications already certified. Approving one posts it as a bill."
              : `${billed.length} billed for ${formatMoney(billedCents, symbol)}${draft ? ", with a draft open" : ""}.`}
          </p>
          {apps.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Period to</TableHead>
                    <TableHead className="text-right">Completed to date</TableHead>
                    <TableHead className="text-right">Retainage</TableHead>
                    <TableHead className="text-right">Payment due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.map((row) => {
                    const isLatestBilled = latestBilled?.app.id === row.app.id;
                    return (
                      <TableRow key={row.app.id}>
                        <TableCell className="text-xs text-muted-foreground">{row.app.number}</TableCell>
                        <TableCell>
                          {row.app.periodTo}
                          {row.app.reference && (
                            <span className="block text-xs text-muted-foreground">
                              Their ref. {row.app.reference}
                            </span>
                          )}
                          {row.app.billedOn && (
                            <span className="block text-xs text-muted-foreground">
                              Billed {row.app.billedOn}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoneySign(row.totals.completedToDateCents, symbol)}
                          <span className="block text-xs text-muted-foreground">
                            {ppmToPercentString(row.app.retainagePpm)}% held
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(row.totals.retainageCents, symbol)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatMoneySign(row.totals.dueCents, symbol)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.app.status === "billed" ? "default" : "secondary"}>
                            {isSubApplicationStatus(row.app.status)
                              ? SUB_APPLICATION_STATUS_LABELS[row.app.status]
                              : row.app.status}
                          </Badge>
                          {row.bill && (
                            <span className="block text-xs text-muted-foreground">
                              <Link
                                href={`${BILL_BASE}/${row.bill.id}`}
                                className="underline-offset-2 hover:underline"
                              >
                                {row.bill.billNumber || "Bill"}
                              </Link>{" "}
                              · {billWord(row.bill.status)}
                            </span>
                          )}
                          {row.app.status === "billed" &&
                            (() => {
                              const gap = gapFor.get(row.app.id);
                              const text = gap
                                ? gap.paid
                                  ? "Paid · no unconditional waiver"
                                  : "No waiver yet"
                                : onFile(row.app, true)
                                  ? "Unconditional waiver on file"
                                  : "Conditional waiver on file";
                              return (
                                <span
                                  className={`block text-xs ${gap?.paid ? "text-destructive" : "text-muted-foreground"}`}
                                >
                                  {text}
                                </span>
                              );
                            })()}
                        </TableCell>
                        <TableCell className="text-right">
                          {isOwner && row.app.status === "draft" && (
                            <PayApplicationEditor
                            key={`${row.app.id}:${row.app.version}`}
                              projectId={project.id}
                              contractId={commitment.id}
                              mode="commitment"
                              symbol={symbol}
                              app={{
                                id: row.app.id,
                                version: row.app.version,
                                number: row.app.number,
                                periodTo: row.app.periodTo,
                                retainagePpm: row.app.retainagePpm,
                                notes: row.app.notes,
                                previousCertificatesCents: row.totals.previousCertificatesCents,
                                lines: row.lines.map((l) => ({
                                  sovLineId: l.commitmentLineId,
                                  description: `${l.changeNumber ? `${l.changeNumber} · ` : ""}${
                                    l.description ||
                                    (l.costCodeId ? (codeLabel.get(l.costCodeId) ?? "Line") : "Line")
                                  }`,
                                  scheduledCents: l.commitmentAmountCents,
                                  previousCents: l.previousCents,
                                  thisPeriodCents: l.thisPeriodCents,
                                  storedCents: l.storedCents,
                                })),
                              }}
                              trigger={
                                <Button variant="outline" size="sm">
                                  <Pencil className="mr-1.5 size-4" /> Open
                                </Button>
                              }
                            />
                          )}
                          {isOwner && row.app.status === "billed" && isLatestBilled && (
                            <VoidPayApplicationButton
                              projectId={project.id}
                              contractId={commitment.id}
                              mode="commitment"
                              id={row.app.id}
                              number={row.app.number}
                              version={row.app.version}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Retainage is held on everything completed to date and released when a
            later application lowers the rate — the final one at 0% releases it
            all. Approving posts the bill to the job and each line&apos;s cost
            code, so it lands on the job cost report. Only the latest billed
            application can be voided.
          </p>
        </Panel>
      )}

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Lien waivers</h2>
          {canWaiver && waiverForm()}
        </div>
        {/*
          A RECORD, NEVER A FORM (ADR 0066): who gave it, of which kind, through
          which date, whether it arrived. The gap — paid, and nothing
          unconditional on file — is derived from the applications and their
          bills, never stored, so a waiver that arrives closes it by existing.
        */}
        <p className="mb-3 text-sm text-muted-foreground">{coverageSentence}</p>
        {data.gaps.length > 0 && (
          <ul className="mb-3 space-y-2 text-sm">
            {data.gaps.map((g) => (
              <li key={g.subApplicationId} className="flex flex-wrap items-center justify-between gap-2">
                <span className={g.paid ? "text-destructive" : ""}>
                  {g.paid
                    ? `Application ${g.applicationNumber} (${g.periodTo}, ${formatMoneySign(g.dueCents, symbol)}) has been paid and no unconditional waiver covers it.`
                    : `Application ${g.applicationNumber} (${g.periodTo}) is billed and no waiver covers it yet.`}
                </span>
                {canWaiver && (
                  <AskForWaiverButton
                    projectId={project.id}
                    commitmentId={commitment.id}
                    missing={g.missing}
                    throughDate={g.periodTo}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {data.chasing.length > 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            Being chased in Work: {data.chasing.map((w) => w.title).join(" · ")}
          </p>
        )}
        {data.waivers.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Through</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Covers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed copy</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.waivers.map((w) => (
                  <TableRow key={w.waiver.id}>
                    <TableCell className="font-medium">
                      {isLienWaiverKind(w.waiver.kind) ? LIEN_WAIVER_KIND_LABELS[w.waiver.kind] : w.waiver.kind}
                      {w.waiver.reference && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Their ref. {w.waiver.reference}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {w.partyName}
                      {w.waiver.signedBy && (
                        <span className="block text-muted-foreground">Signed by {w.waiver.signedBy}</span>
                      )}
                    </TableCell>
                    <TableCell>{w.waiver.throughDate}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {w.waiver.amountCents === 0 ? "—" : formatMoney(w.waiver.amountCents, symbol)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {w.applicationNumber !== null ? `Application ${w.applicationNumber}` : "Work through the date"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={w.waiver.status === "received" ? "default" : "secondary"}>
                        {isLienWaiverStatus(w.waiver.status)
                          ? LIEN_WAIVER_STATUS_LABELS[w.waiver.status]
                          : w.waiver.status}
                      </Badge>
                      {w.waiver.receivedOn && (
                        <span className="block text-xs text-muted-foreground">{w.waiver.receivedOn}</span>
                      )}
                      {w.waiver.status === "requested" && w.waiver.requestedOn && (
                        <span className="block text-xs text-muted-foreground">Asked {w.waiver.requestedOn}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {w.attachmentCount === 0
                        ? "—"
                        : `${w.attachmentCount} ${w.attachmentCount === 1 ? "file" : "files"}`}
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {canWaiver &&
                        waiverForm(
                          {
                            id: w.waiver.id,
                            version: w.waiver.version,
                            partyId: w.waiver.partyId,
                            subApplicationId: w.waiver.subApplicationId,
                            kind: w.waiver.kind,
                            throughDate: w.waiver.throughDate,
                            amountCents: w.waiver.amountCents,
                            status: w.waiver.status,
                            requestedOn: w.waiver.requestedOn,
                            receivedOn: w.waiver.receivedOn,
                            signedBy: w.waiver.signedBy,
                            reference: w.waiver.reference,
                            notes: w.waiver.notes,
                          },
                          <Button variant="ghost" size="icon">
                            <Pencil className="size-4" />
                            <span className="sr-only">Edit waiver through {w.waiver.throughDate}</span>
                          </Button>,
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          A waiver covers an application when it names it, when it is a final
          one, or when its through date is on or after the application&apos;s
          period end. Only a received waiver counts. The words on the form are
          your state&apos;s or your lawyer&apos;s; what is kept here is who signed,
          for what, through when — and a photo of the signed page.
        </p>
      </Panel>
    </div>
  );
}
