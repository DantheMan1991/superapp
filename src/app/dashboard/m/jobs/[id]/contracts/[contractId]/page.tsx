import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, Pencil } from "lucide-react";
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
  actualByCode,
  contractBilling,
  costPlusTerms,
  getContract,
  getProject,
  jobCostReport,
  laborOnJob,
  listChangeOrders,
  listCostCodes,
  listPayApplications,
  listSovLines,
  timeEnabled,
} from "@/packs/jobs/ops";
import {
  minutesToHoursString,
  percentComplete,
  ppmToPercentString,
} from "@/packs/jobs/billing-math";
import {
  APPROVED_CHANGE_STATUSES,
  BILLING_METHOD_LABELS,
  CONTRACT_STATUS_LABELS,
  PACK,
  PAY_APPLICATION_STATUS_LABELS,
  isBillingMethod,
  isContractStatus,
  billsTheLedger,
  isCostPlusMethod,
  isFixedValueMethod,
  isTimeAndMaterialsMethod,
  isPayApplicationStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";
import { CostPlusApplicationEditor } from "@/packs/jobs/components/cost-plus-editor";
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
      const costPlus = isCostPlusMethod(contract.billingMethod);
      const tm = isTimeAndMaterialsMethod(contract.billingMethod);
      const [sov, apps, changeOrders, codes, billing, party, pack, costReport, tmCost, hours, timeOn] =
        await Promise.all([
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
        costPlus ? jobCostReport(tx, ctx.tenant.id, project.id) : Promise.resolve(null),
        // Time and materials: the books' cost with the wages accounts left out, and
        // the hours Time has approved on the job so far — counted here, priced on
        // the draft, where the reader is an owner (ADR 0062).
        tm
          ? actualByCode(tx, ctx.tenant.id, project, undefined, { withoutLabor: true })
          : Promise.resolve(null),
        tm ? laborOnJob(tx, ctx.tenant.id, project, "9999-12-31", contract.laborRateCents) : Promise.resolve(null),
        tm ? timeEnabled(tx, ctx.tenant.id) : Promise.resolve(true),
      ]);
      let approvedMinutes = 0;
      for (const byRate of hours?.byWorker.values() ?? []) {
        for (const minutes of byRate.values()) approvedMinutes += minutes;
      }
      return {
        project,
        contract,
        sov,
        apps,
        costReport,
        tmCost,
        hours: hours ? { approvedMinutes, awaitingMinutes: hours.awaitingMinutes } : null,
        timeOn,
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
  const costPlus = isCostPlusMethod(contract.billingMethod);
  const tm = isTimeAndMaterialsMethod(contract.billingMethod);
  const ledgerBilled = billsTheLedger(contract.billingMethod);
  const fixedValue = isFixedValueMethod(contract.billingMethod);
  const terms = costPlusTerms(contract);
  const feeWords = [
    terms.feePpm ? `${ppmToPercentString(terms.feePpm)}% ${tm ? "markup on" : "of"} cost` : null,
    terms.feeCents ? `a fixed ${formatMoney(terms.feeCents, symbol)}` : null,
  ]
    .filter(Boolean)
    .join(" plus ");
  const tmCostRows = data.tmCost
    ? [
        ...data.codes
          .filter((c) => (data.tmCost!.byCode.get(c.id) ?? 0) !== 0)
          .map((c) => ({ key: c.id, label: `${c.code} · ${c.name}`, cents: data.tmCost!.byCode.get(c.id) ?? 0 })),
        ...(data.tmCost.uncodedCents !== 0
          ? [{ key: "none", label: "No cost code", cents: data.tmCost.uncodedCents }]
          : []),
      ]
    : [];
  const costToDate = tm
    ? tmCostRows.reduce((sum, r) => sum + r.cents, 0)
    : (data.costReport?.actualCents ?? 0);
  const laborWords =
    contract.laborRateCents === null
      ? "each person's charged-out rate from Time"
      : `${formatMoney(contract.laborRateCents, symbol)}/h for everybody`;
  // The tile has room for four words; the panel's sentence has room for the rest.
  const laborTile =
    contract.laborRateCents === null
      ? "Per person, from Time"
      : `${formatMoney(contract.laborRateCents, symbol)}/h, everybody`;
  const latestCostPlus = latestIssued?.costPlus ?? null;
  const codeLabel = new Map(data.codes.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const changeLabel = new Map(
    data.changeOrders.map((r) => [r.changeOrder.id, `${r.changeOrder.number} · ${r.changeOrder.title}`]),
  );
  const newDisabled = draft
    ? "Finish the open draft first"
    : ledgerBilled
      ? null
      : fixedValue
        ? sov.length === 0
          ? "Set up the schedule of values first"
          : null
        : "This billing method is not billed here yet";

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
        {(tm
          ? ([
              ["Labour", laborTile, feeWords ? `plus ${feeWords}` : "no markup on cost"],
              ["Cost to date", formatMoney(costToDate, symbol), "in the books, wages aside"],
              ["Billed to date", formatMoney(billedCents, symbol), `${issued.length} issued`],
              ["Retainage held", formatMoney(retainageHeld, symbol), null],
              [
                "Not to exceed",
                terms.gmaxCents === null ? "None" : formatMoney(terms.gmaxCents, symbol),
                terms.gmaxCents === null
                  ? null
                  : `${formatMoneySign(terms.gmaxCents - (latestCostPlus?.completedToDateCents ?? 0), symbol)} left to bill`,
              ],
            ] as const)
          : costPlus
          ? ([
              ["Fee", feeWords || "None — cost only", null],
              ["Cost to date", formatMoney(costToDate, symbol), "in the books, tagged to the job"],
              ["Billed to date", formatMoney(billedCents, symbol), `${issued.length} issued`],
              ["Retainage held", formatMoney(retainageHeld, symbol), null],
              [
                "Guaranteed maximum",
                terms.gmaxCents === null ? "None" : formatMoney(terms.gmaxCents, symbol),
                terms.gmaxCents === null
                  ? null
                  : `${formatMoneySign(terms.gmaxCents - (latestCostPlus?.completedToDateCents ?? 0), symbol)} left to bill`,
              ],
            ] as const)
          : ([
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
          ] as const)
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

      {costPlus && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">
            Cost plus a fee
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {/*
              THE LEDGER IS THE SCHEDULE OF VALUES (ADR 0060). Nothing to set up:
              every bill, timecard and journal line tagged with the job is what
              the next application bills, by cost code, plus the fee.
            */}
            This contract bills what the job has cost — every line in the books
            tagged with it, by cost code — plus {feeWords || "no fee"}
            {terms.gmaxCents !== null
              ? `, never more than ${formatMoney(terms.gmaxCents, symbol)} in all`
              : ""}
            . The terms are edited on the contract itself, from the {projectWord.toLowerCase()}&apos;s page.
          </p>
          {data.costReport && data.costReport.rows.length + (data.costReport.uncodedActualCents !== 0 ? 1 : 0) > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cost code</TableHead>
                    <TableHead className="text-right">In the books to date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.costReport.rows
                    .filter((r) => r.actualCents !== 0)
                    .map((r) => (
                      <TableRow key={r.costCodeId}>
                        <TableCell>
                          <span className="font-mono text-xs">{r.code}</span> · {r.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoneySign(r.actualCents, symbol)}
                        </TableCell>
                      </TableRow>
                    ))}
                  {data.costReport.uncodedActualCents !== 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">No cost code</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoneySign(data.costReport.uncodedActualCents, symbol)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing in the books is tagged to this {projectWord.toLowerCase()} yet. Code a bill to it
              in Accounting and it appears here and on the next application.
            </p>
          )}
        </Panel>
      )}

      {tm && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">
            Time and materials
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {/*
              COST PLUS WITH A RATE CARD IN PLACE OF LABOUR COST (ADR 0062). The
              hours are Time's, approved and tagged with the job; the rest of the
              cost is the books', with the wages accounts left out because the
              hours already cover them.
            */}
            This contract bills the hours Time has approved on this {projectWord.toLowerCase()} at{" "}
            {laborWords}, plus the rest of what the job has cost — every other line in the books
            tagged with it, by cost code — {feeWords ? `with ${feeWords}` : "with no markup"}
            {terms.gmaxCents !== null
              ? `, never more than ${formatMoney(terms.gmaxCents, symbol)} in all`
              : ""}
            . Wages in the books are not marked up; the hours are billed instead. The terms are
            edited on the contract itself, from the {projectWord.toLowerCase()}&apos;s page.
          </p>
          <dl className="mb-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <dt className="text-xs text-muted-foreground">Approved hours on the job</dt>
              <dd className="text-base font-medium tabular-nums">
                {minutesToHoursString(data.hours?.approvedMinutes ?? 0)} h
              </dd>
              {(data.hours?.awaitingMinutes ?? 0) > 0 && (
                <dd className="text-xs text-muted-foreground">
                  {minutesToHoursString(data.hours!.awaitingMinutes)} h more await approval in Time
                </dd>
              )}
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <dt className="text-xs text-muted-foreground">In the books, wages aside</dt>
              <dd className="text-base font-medium tabular-nums">{formatMoney(costToDate, symbol)}</dd>
              <dd className="text-xs text-muted-foreground">by cost code below</dd>
            </div>
          </dl>
          {!data.timeOn && (
            <p className="mb-3 text-sm text-destructive">
              Time is not switched on for this workspace, so no hours can reach an application.
              Switch it on under Modules; hours logged there and tagged with the {projectWord.toLowerCase()}{" "}
              appear here once a timesheet is approved.
            </p>
          )}
          {tmCostRows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cost code</TableHead>
                    <TableHead className="text-right">In the books to date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tmCostRows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className={r.key === "none" ? "text-muted-foreground" : undefined}>
                        {r.label}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoneySign(r.cents, symbol)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing in the books is tagged to this {projectWord.toLowerCase()} yet, wages aside. Code a
              bill to it in Accounting and it appears here and on the next application.
            </p>
          )}
        </Panel>
      )}

      {!ledgerBilled && !fixedValue && (
        <Panel className="p-5">
          <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">
            {isBillingMethod(contract.billingMethod)
              ? BILLING_METHOD_LABELS[contract.billingMethod]
              : contract.billingMethod}
          </h2>
          <p className="text-sm text-muted-foreground">
            Recorded on the contract and not billed here yet. Unit-price billing
            is a different sum and is still to come; a schedule of values, cost
            plus a fee or time and materials can be chosen on the contract
            meanwhile.
          </p>
        </Panel>
      )}

      {fixedValue && (
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
      )}

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
            ? tm
              ? "Each application bills the hours Time has approved on the job to date at their rates, plus what the books carry on it with the markup, less what earlier applications billed; what is due is that, less retainage, less what was already certified. Issuing one posts it as an invoice."
              : costPlus
              ? "Each application bills what the books carry on the job to date, less what earlier applications billed, plus the fee; what is due is that, less retainage, less what was already certified. Issuing one posts it as an invoice."
              : "Each application says how much of each schedule line is complete to date; what is due is that, less retainage, less what earlier applications already certified. Issuing one posts it as an invoice."
            : `${issued.length} issued for ${formatMoney(billedCents, symbol)}${draft ? ", with a draft open" : ""}.`}
        </p>
        {apps.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Period to</TableHead>
                  <TableHead className="text-right">
                    {tm ? "Labour, cost and markup to date" : costPlus ? "Cost plus fee to date" : "Completed to date"}
                  </TableHead>
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
                          {row.costPlus
                            ? `${tm ? `${formatMoney(row.costPlus.laborToDateCents, symbol)} labour + ` : ""}${formatMoney(row.costPlus.costToDateCents, symbol)} cost + ${formatMoney(row.costPlus.feeToDateCents, symbol)} ${tm ? "markup" : "fee"}${row.costPlus.capped ? ", capped" : ""} · `
                            : ""}
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
                        {/* The printout: the certificate page and the continuation sheet, drafts watermarked. */}
                        <Button variant="ghost" size="sm" asChild>
                          <a
                            href={`/api/jobs/applications/${row.app.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileText className="mr-1.5 size-4" /> PDF
                          </a>
                        </Button>
                        {isOwner && row.app.status === "draft" && ledgerBilled && (
                          <CostPlusApplicationEditor
                            key={`${row.app.id}:${row.app.version}`}
                            projectId={project.id}
                            contractId={contract.id}
                            symbol={symbol}
                            terms={terms}
                            mode={tm ? "time_and_materials" : "cost_plus"}
                            timeEnabled={data.timeOn}
                            app={{
                              id: row.app.id,
                              version: row.app.version,
                              number: row.app.number,
                              periodTo: row.app.periodTo,
                              retainagePpm: row.app.retainagePpm,
                              notes: row.app.notes,
                              feeToDateCents: row.app.feeToDateCents,
                              previousCertificatesCents: row.totals.previousCertificatesCents,
                              costs: row.costs.map((c) => ({
                                costCodeId: c.costCodeId,
                                label: c.code ? `${c.code} · ${c.name}` : "No cost code",
                                ledgerToDateCents: c.ledgerToDateCents,
                                previousCents: c.previousCents,
                                thisPeriodCents: c.thisPeriodCents,
                              })),
                              labor: row.labor.map((l) => ({
                                workerId: l.workerId,
                                rateCents: l.rateCents,
                                name: l.name,
                                minutesToDate: l.minutesToDate,
                                previousMinutes: l.previousMinutes,
                                previousCents: l.previousCents,
                                thisPeriodMinutes: l.thisPeriodMinutes,
                              })),
                              laborAwaitingMinutes: row.laborAwaitingMinutes,
                            }}
                            trigger={
                              <Button variant="outline" size="sm">
                                <Pencil className="mr-1.5 size-4" /> Open
                              </Button>
                            }
                          />
                        )}
                        {isOwner && row.app.status === "draft" && !ledgerBilled && (
                          <PayApplicationEditor
                            key={`${row.app.id}:${row.app.version}`}
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
          {ledgerBilled
            ? `A bill dated inside an earlier period and posted late${tm ? ", or a timesheet approved late," : ""} is billed by the next application — each one bills to date, never by window. `
            : ""}
          Retainage is held on everything {ledgerBilled ? "billed" : "completed"} to date and released when a
          later application lowers the rate — the final application at 0% releases
          it all. Only the latest issued application can be voided.
        </p>
      </Panel>
    </div>
  );
}
