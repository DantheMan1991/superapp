import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
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
import { getProject, listCommitments, listCostCodes } from "@/packs/jobs/ops";
import {
  commitmentBilling,
  getCommitment,
  listSubApplications,
} from "@/packs/jobs/sub-billing-ops";
import { percentComplete, ppmToPercentString } from "@/packs/jobs/billing-math";
import {
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUS_LABELS,
  PACK,
  SUB_APPLICATION_STATUS_LABELS,
  isCommitmentKind,
  isCommitmentStatus,
  isSubApplicationStatus,
} from "@/packs/jobs/vocabulary";
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

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const commitment = await getCommitment(tx, ctx.tenant.id, commitmentId);
      if (!commitment || commitment.projectId !== project.id) return null;
      const [rows, apps, codes, billing, pack] = await Promise.all([
        listCommitments(tx, ctx.tenant.id, project.id),
        listSubApplications(tx, ctx.tenant.id, commitment.id),
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        commitmentBilling(tx, ctx.tenant.id, project.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      const row = rows.find((r) => r.commitment.id === commitment.id) ?? null;
      return {
        project,
        commitment,
        vendorName: row?.vendorName ?? "—",
        lines: row?.lines ?? [],
        totalCents: row?.totalCents ?? 0,
        apps,
        codes,
        billing: billing.get(commitment.id) ?? null,
        labels: pack.labels,
      };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, commitment, lines, apps } = data;
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
                [`${kindWord} value`, formatMoney(data.totalCents, symbol), `${lines.length} ${lines.length === 1 ? "line" : "lines"}`],
                ["Billed to date", formatMoney(billedCents, symbol), `${billed.length} ${billed.length === 1 ? "application" : "applications"}`],
                ["Retainage held", formatMoney(retainageHeld, symbol), "what the business holds back"],
                ["Balance to finish", formatMoneySign(balanceToFinish, symbol), null],
              ] as const)
            : ([[`${kindWord} value`, formatMoney(data.totalCents, symbol), `${lines.length} ${lines.length === 1 ? "line" : "lines"}`]] as const)
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
            ? "The subcontract's lines are what its applications bill against — the schedule of values, written when the order was placed. Edited from the job's page."
            : "What was ordered. A purchase order is billed with an ordinary bill in Accounting, coded to the job and the line's cost code."}
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
                      <TableCell>{l.description || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.amountCents, symbol)}
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
                        </TableCell>
                        <TableCell className="text-right">
                          {isOwner && row.app.status === "draft" && (
                            <PayApplicationEditor
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
                                  description:
                                    l.description ||
                                    (l.costCodeId ? (codeLabel.get(l.costCodeId) ?? "Line") : "Line"),
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
    </div>
  );
}
