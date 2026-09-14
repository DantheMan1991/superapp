import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
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
import {
  contractBilling,
  getContract,
  getProject,
  listChangeOrders,
  listCostCodes,
  listPayApplications,
  listSovLines,
} from "@/packs/jobs/ops";
import { percentComplete, ppmToPercentString } from "@/packs/jobs/billing-math";
import {
  APPROVED_CHANGE_STATUSES,
  BILLING_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  PACK,
  PAY_APPLICATION_STATUS_LABELS,
  isBillingMethod,
  isContractStatus,
  isPayApplicationStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";
import { SovEditor } from "@/packs/jobs/components/sov-editor";
import {
  NewPayApplication,
  PayApplicationEditor,
  VoidPayApplicationButton,
} from "@/packs/jobs/components/pay-application-editor";

const INVOICE_BASE = "/dashboard/m/accounting/sales/invoices";

/** What Accounting says about the invoice, in the words a builder reads. */
function invoiceWord(status: string): string {
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
 * One contract: its schedule of values, and the applications drawn against it.
 *
 * THE FIRST PAGE IN THIS PACK THAT BILLS. Everything above it — the project,
 * its contracts, the change orders that revise them — exists so that the
 * number at the bottom of this page, CURRENT PAYMENT DUE, is right; and when
 * it is issued it becomes an ordinary Accounting invoice (ADR 0058), which is
 * why the table links to one rather than showing a second payment status.
 */
export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string; contractId: string }>;
}) {
  const { id, contractId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const contract = await getContract(tx, ctx.tenant.id, contractId);
      if (!contract || contract.projectId !== project.id) return null;
      const [sov, apps, changeOrders, codes, billing, party, pack] = await Promise.all([
        listSovLines(tx, ctx.tenant.id, contract.id),
        listPayApplications(tx, ctx.tenant.id, contract.id),
        listChangeOrders(tx, ctx.tenant.id, project.id),
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        contractBilling(tx, ctx.tenant.id, project.id),
        contract.counterpartyPartyId
          ? tx
              .select({ name: schema.parties.displayName })
              .from(schema.parties)
              .where(
                and(
                  eq(schema.parties.tenantId, ctx.tenant.id),
                  eq(schema.parties.id, contract.counterpartyPartyId),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      ]);
      return {
        project,
        contract,
        sov,
        apps,
        changeOrders: changeOrders.filter((r) => r.contract.id === contract.id),
        codes,
        billing: billing.get(contract.id) ?? null,
        partyName: party[0]?.name ?? null,
        labels: pack.labels,
      };
    },
    { role: ctx.role },
  );
  if (!data) notFound();

  const { project, contract, sov, apps } = data;
  const isOwner = allowsWrite(ctx.role, "owner");
  const symbol = ctx.tenant.currencySymbol;
  const projectWord = labelFor(data.labels, "project", "Project");
  const clientWord = labelFor(data.labels, "customer", "Customer");
  const title = `${slugLabel(contract.kind)}${contract.name ? ` · ${contract.name}` : ""}`;

  const approved = data.changeOrders.filter((r) =>
    (APPROVED_CHANGE_STATUSES as readonly string[]).includes(r.changeOrder.status),
  );
  const changesCents = approved.reduce((sum, r) => sum + r.changeOrder.valueCents, 0);
  const revisedCents = contract.valueCents === null ? null : contract.valueCents + changesCents;
  const scheduledCents = sov.reduce((sum, l) => sum + l.scheduledCents, 0);
  const gap = revisedCents === null ? null : revisedCents - scheduledCents;
  const issued = apps.filter((a) => a.app.status === "issued");
  const latestIssued = issued.length > 0 ? issued[issued.length - 1] : null;
  const draft = apps.find((a) => a.app.status === "draft") ?? null;
  const billedCents = data.billing?.billedCents ?? 0;
  const retainageHeld = data.billing?.retainageHeldCents ?? 0;
  const balanceToFinish = scheduledCents - (latestIssued?.totals.completedToDateCents ?? 0);
  const billedSov = new Set(apps.flatMap((a) => a.lines.map((l) => l.sovLineId)));
  const codeLabel = new Map(data.codes.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const changeLabel = new Map(
    data.changeOrders.map((r) => [r.changeOrder.id, `${r.changeOrder.number} · ${r.changeOrder.title}`]),
  );
  const newDisabled =
    sov.length === 0
      ? "Set up the schedule of values first"
      : draft
        ? "Finish the open draft first"
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
        title={title}
        description={`${projectWord} ${project.number}${data.partyName ? ` · with ${data.partyName}` : ` · no ${clientWord.toLowerCase()} named yet`}${
          isBillingMethod(contract.billingMethod)
            ? ` · ${BILLING_METHOD_LABELS[contract.billingMethod]}`
            : ""
        }`}
        actions={
          <Badge variant={contract.status === "signed" ? "default" : "secondary"}>
            {isContractStatus(contract.status)
              ? CONTRACT_STATUS_LABELS[contract.status]
              : contract.status}
          </Badge>
        }
      />

      {/*
        THE FIVE NUMBERS OF A CONTRACT'S BILLING, side by side. Value is the
        REVISED sum (original + approved changes); Scheduled is what the
        schedule of values adds up to and says out loud when the two differ,
        because value that is not on the schedule is value nobody can bill.
      */}
      <dl className="grid gap-3 sm:grid-cols-5">
        {(
          [
            ["Contract value", revisedCents === null ? "—" : formatMoneySign(revisedCents, symbol), changesCents !== 0 ? `incl. ${formatMoneySign(changesCents, symbol)} in changes` : null],
            [
              "Scheduled",
              formatMoney(scheduledCents, symbol),
              gap === null || gap === 0
                ? null
                : gap > 0
                  ? `${formatMoney(gap, symbol)} not on the schedule`
                  : `${formatMoney(-gap, symbol)} over the contract`,
            ],
            ["Billed to date", formatMoney(billedCents, symbol), `${issued.length} issued`],
            ["Retainage held", formatMoney(retainageHeld, symbol), null],
            ["Balance to finish", formatMoneySign(balanceToFinish, symbol), null],
          ] as const
        ).map(([label, value, note]) => (
          <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-base font-medium tabular-nums">{value}</dd>
            {note && (
              <dd
                className={
                  "text-xs " +
                  (label === "Scheduled" ? "text-destructive" : "text-muted-foreground")
                }
              >
                {note}
              </dd>
            )}
          </div>
        ))}
      </dl>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Schedule of values
          </h2>
          {isOwner && (
            <SovEditor
              projectId={project.id}
              contractId={contract.id}
              contractValueCents={revisedCents}
              existing={sov.map((l) => ({
                id: l.id,
                description: l.description,
                scheduledCents: l.scheduledCents,
                costCodeId: l.costCodeId,
                changeOrderId: l.changeOrderId,
                billed: billedSov.has(l.id),
              }))}
              costCodes={data.codes
                .filter((c) => c.isActive || sov.some((l) => l.costCodeId === c.id))
                .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
              changeOrders={approved.map((r) => ({
                id: r.changeOrder.id,
                label: `${r.changeOrder.number} · ${r.changeOrder.title}`,
              }))}
              symbol={symbol}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {sov.length === 0
            ? "How the contract sum breaks down — by trade, by phase, or as milestones. Every application bills against these lines, so the schedule comes first."
            : `${sov.length} ${sov.length === 1 ? "line" : "lines"}, scheduled at ${formatMoney(scheduledCents, symbol)}.`}
        </p>
        {sov.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Cost code</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Complete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sov.map((l, i) => {
                  const latestLine = latestIssued?.lines.find((x) => x.sovLineId === l.id);
                  const completed = latestLine
                    ? latestLine.previousCents + latestLine.thisPeriodCents + latestLine.storedCents
                    : 0;
                  const pct = percentComplete(completed, l.scheduledCents);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{l.description}</TableCell>
                      <TableCell className="text-xs">
                        {l.costCodeId ? (codeLabel.get(l.costCodeId) ?? "—") : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.changeOrderId
                          ? (changeLabel.get(l.changeOrderId) ?? "Change order")
                          : "Original contract"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(l.scheduledCents, symbol)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {pct === null ? "—" : `${pct}%`}
                      </TableCell>
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
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Pay applications
          </h2>
          {isOwner && (
            <NewPayApplication
              projectId={project.id}
              contractId={contract.id}
              lastRetainagePpm={latestIssued?.app.retainagePpm ?? null}
              disabledReason={newDisabled}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE LINE EVERY CERTIFICATE IS BUILT AROUND, in words: what has been
            completed, less what is held back, less what was already
            certified, is what is due — and issuing it makes it an invoice.
          */}
          {apps.length === 0
            ? "Each application says how much of each schedule line is complete to date; what is due is that, less retainage, less what earlier applications already certified. Issuing one posts it as an invoice."
            : `${issued.length} issued for ${formatMoney(billedCents, symbol)}${draft ? ", with a draft open" : ""}.`}
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
                  const isLatestIssued = latestIssued?.app.id === row.app.id;
                  return (
                    <TableRow key={row.app.id}>
                      <TableCell className="text-xs text-muted-foreground">{row.app.number}</TableCell>
                      <TableCell>
                        {row.app.periodTo}
                        {row.app.issuedOn && (
                          <span className="block text-xs text-muted-foreground">
                            Issued {row.app.issuedOn}
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
                        <Badge variant={row.app.status === "issued" ? "default" : "secondary"}>
                          {isPayApplicationStatus(row.app.status)
                            ? PAY_APPLICATION_STATUS_LABELS[row.app.status]
                            : row.app.status}
                        </Badge>
                        {row.invoice && (
                          <span className="block text-xs text-muted-foreground">
                            <Link
                              href={`${INVOICE_BASE}/${row.invoice.id}`}
                              className="underline-offset-2 hover:underline"
                            >
                              {row.invoice.invoiceNumber}
                            </Link>{" "}
                            · {invoiceWord(row.invoice.status)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isOwner && row.app.status === "draft" && (
                          <PayApplicationEditor
                            projectId={project.id}
                            contractId={contract.id}
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
                                sovLineId: l.sovLineId,
                                description: l.description,
                                scheduledCents: l.sovScheduledCents,
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
                        {isOwner && row.app.status === "issued" && isLatestIssued && (
                          <VoidPayApplicationButton
                            projectId={project.id}
                            contractId={contract.id}
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
          later application lowers the rate — the final application at 0% releases
          it all. Only the latest issued application can be voided.
        </p>
      </Panel>
    </div>
  );
}
