import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  actualByProject,
  committedTotals,
  contractBilling,
  jobCostReport,
  getProject,
  listChangeOrders,
  listCommitments,
  listContracts,
  listCostCodes,
} from "@/packs/jobs/ops";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney, formatMoneySign } from "@/lib/money";
import { ContractForm } from "@/packs/jobs/components/contract-form";
import { CommitmentForm } from "@/packs/jobs/components/commitment-form";
import { ChangeOrderForm } from "@/packs/jobs/components/change-order-form";
import { DailyLogForm } from "@/packs/jobs/components/daily-log-form";
import { PunchList } from "@/packs/jobs/components/punch-list";
import { listDailyLogs, listPunchItems } from "@/packs/jobs/field-ops";
import { BudgetEditor } from "@/packs/jobs/components/budget-editor";
import { ProjectForm } from "@/packs/jobs/components/project-form";
import { Button } from "@/components/ui/button";
import { listCostCodeSets } from "@/packs/jobs/ops";
import {
  APPROVED_CHANGE_STATUSES,
  BILLING_METHOD_LABELS,
  CHANGE_ORDER_STATUS_LABELS,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  PACK,
  PROJECT_DIMENSION,
  VALUED_CONTRACT_STATUSES,
  STATUS_LABELS,
  isBillingMethod,
  isChangeOrderStatus,
  isCommitmentKind,
  isCommitmentStatus,
  isContractStatus,
  isProjectStatus,
  slugLabel,
} from "@/packs/jobs/vocabulary";
import {
  contractKindsFrom,
  deliveryMethodsFrom,
} from "@/packs/jobs/vocabulary";

/**
 * One project: its three coordinates, its cost code list, and proof that it is
 * a cost object.
 *
 * **THE COST OBJECT ROW IS ON THE PAGE ON PURPOSE.** A project whose
 * `dimension_members` row failed to write is an entity no report can group by,
 * and nothing else in the product would show it — so the page says out loud
 * whether the sync happened rather than leaving it to be discovered from a
 * report that is quietly missing a column.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const project = await getProject(tx, ctx.tenant.id, id);
      if (!project) return null;
      const [
        entity,
        party,
        enterprise,
        set,
        codes,
        contracts,
        commitments,
        changeOrders,
        billing,
        committed,
        costReport,
        actual,
        allEntities,
        allEnterprises,
        allSets,
        parties,
        member,
        pack,
        days,
        punch,
      ] = await Promise.all([
        tx
          .select({ name: schema.entities.name })
          .from(schema.entities)
          .where(
            and(
              eq(schema.entities.tenantId, ctx.tenant.id),
              eq(schema.entities.id, project.entityId),
            ),
          )
          .limit(1),
        project.partyId
          ? tx
              .select({ name: schema.parties.displayName })
              .from(schema.parties)
              .where(
                and(
                  eq(schema.parties.tenantId, ctx.tenant.id),
                  eq(schema.parties.id, project.partyId),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        project.enterpriseId
          ? tx
              .select({ name: schema.enterprises.name })
              .from(schema.enterprises)
              .where(
                and(
                  eq(schema.enterprises.tenantId, ctx.tenant.id),
                  eq(schema.enterprises.id, project.enterpriseId),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        project.costCodeSetId
          ? tx
              .select({ name: schema.jobCostCodeSets.name })
              .from(schema.jobCostCodeSets)
              .where(
                and(
                  eq(schema.jobCostCodeSets.tenantId, ctx.tenant.id),
                  eq(schema.jobCostCodeSets.id, project.costCodeSetId),
                ),
              )
              .limit(1)
          : Promise.resolve([]),
        project.costCodeSetId
          ? listCostCodes(tx, ctx.tenant.id, project.costCodeSetId)
          : Promise.resolve([]),
        listContracts(tx, ctx.tenant.id, project.id),
        listCommitments(tx, ctx.tenant.id, project.id),
        listChangeOrders(tx, ctx.tenant.id, project.id),
        contractBilling(tx, ctx.tenant.id, project.id),
        committedTotals(tx, ctx.tenant.id),
        jobCostReport(tx, ctx.tenant.id, project.id),
        /*
         * ACTUAL COST COMES FROM THE LEDGER through a CORE export, never from a
         * query of accounting's tables. `getBalances` already applies the basis
         * lens and the entity scope, so a job cost figure that disagreed with
         * the P&L is not possible. Scoped to the project's own company.
         */
        actualByProject(tx, ctx.tenant.id, { kind: "one", entityId: project.entityId }),
        tx
          .select({ id: schema.entities.id, name: schema.entities.name })
          .from(schema.entities)
          .where(
            and(
              eq(schema.entities.tenantId, ctx.tenant.id),
              eq(schema.entities.isActive, true),
            ),
          ),
        tx
          .select({ id: schema.enterprises.id, name: schema.enterprises.name })
          .from(schema.enterprises)
          .where(eq(schema.enterprises.tenantId, ctx.tenant.id)),
        listCostCodeSets(tx, ctx.tenant.id),
        tx
          .select({ id: schema.parties.id, name: schema.parties.displayName })
          .from(schema.parties)
          .where(eq(schema.parties.tenantId, ctx.tenant.id))
          .limit(500),
        tx
          .select({
            displayName: schema.dimensionMembers.displayName,
            isActive: schema.dimensionMembers.isActive,
          })
          .from(schema.dimensionMembers)
          .where(
            and(
              eq(schema.dimensionMembers.tenantId, ctx.tenant.id),
              eq(schema.dimensionMembers.dimensionType, PROJECT_DIMENSION),
              eq(schema.dimensionMembers.packEntityId, project.id),
            ),
          )
          .limit(1),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
        // The field: the last few days, and what is open on the walk-through.
        listDailyLogs(tx, ctx.tenant.id, project.id, { limit: 5 }),
        listPunchItems(tx, ctx.tenant.id, project.id),
      ]);
      return {
        project,
        entityName: entity[0]?.name ?? "—",
        clientName: party[0]?.name ?? null,
        enterpriseName: enterprise[0]?.name ?? null,
        setName: set[0]?.name ?? null,
        codes,
        contracts,
        commitments,
        changeOrders,
        billing,
        committed,
        costRows: costReport.rows,
        uncodedActualCents: costReport.uncodedActualCents,
        actual,
        allEntities,
        allEnterprises,
        allSets,
        parties,
        member: member[0] ?? null,
        labels: pack.labels,
        config: pack.config,
        days,
        punch,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project, codes, contracts, commitments, changeOrders, member } = data;
  const committedCents = data.committed.byProject.get(project.id) ?? 0;
  const actualCents = data.actual.get(project.id) ?? 0;
  const budgetTotal = data.costRows.reduce((sum, r) => sum + r.budgetCents, 0);
  /**
   * Ordered against BUDGETED codes only, so the headline compares like with
   * like. A code somebody ordered against and never budgeted still shows as its
   * own row — flagged — rather than silently inflating the comparison.
   */
  const committedOfBudgeted = data.costRows
    .filter((r) => r.hasBudget)
    .reduce((sum, r) => sum + r.committedCents, 0);
  const spentOfBudgeted = data.costRows
    .filter((r) => r.hasBudget)
    .reduce((sum, r) => sum + r.actualCents, 0);
  const isOwner = allowsWrite(ctx.role, "owner");
  /** The field is a chore: whoever is on the site logs the day and ticks the list. */
  const canLog = allowsWrite(ctx.role, "member");
  const symbol = ctx.tenant.currencySymbol;
  /**
   * Only signed and complete agreements count. See `VALUED_CONTRACT_STATUSES` —
   * the same rule `projectValues` applies in SQL for the list, kept as one
   * exported constant so the two cannot drift into disagreeing about what a job
   * is worth.
   */
  const valued = contracts.filter((c) =>
    VALUED_CONTRACT_STATUSES.includes(c.status as (typeof VALUED_CONTRACT_STATUSES)[number]),
  );
  /**
   * APPROVED CHANGES BY CONTRACT, from the rows already loaded — the same rule
   * `projectValues` applies in SQL for the list (`countedChange`), through the
   * same exported constant, so the list and this page cannot disagree about
   * what a job is worth. A change on a contract that does not count is summed
   * here and then never read, because only `valued` contracts are added up.
   */
  const approvedByContract = new Map<string, number>();
  for (const row of changeOrders) {
    if (!(APPROVED_CHANGE_STATUSES as readonly string[]).includes(row.changeOrder.status)) {
      continue;
    }
    approvedByContract.set(
      row.contract.id,
      (approvedByContract.get(row.contract.id) ?? 0) + row.changeOrder.valueCents,
    );
  }
  /** Original + approved changes: what the agreement is worth NOW. */
  const revisedOf = (c: { id: string; valueCents: number | null }) =>
    (c.valueCents ?? 0) + (approvedByContract.get(c.id) ?? 0);
  const signedValue = valued.reduce((sum, c) => sum + revisedOf(c), 0);
  const changesValue = valued.reduce(
    (sum, c) => sum + (approvedByContract.get(c.id) ?? 0),
    0,
  );
  const signedCount = valued.length;
  const approvedCount = changeOrders.filter((r) =>
    (APPROVED_CHANGE_STATUSES as readonly string[]).includes(r.changeOrder.status),
  ).length;
  const proposedChangeCount = changeOrders.filter(
    (r) => r.changeOrder.status === "proposed",
  ).length;
  /** How much of the revised budget is approved changes. */
  const budgetChanges = data.costRows.reduce((sum, r) => sum + r.changesCents, 0);
  const proposedCount = contracts.filter((c) => c.status === "proposed").length;
  const projectWord = labelFor(data.labels, "project", "Project");
  const clientWord = labelFor(data.labels, "customer", "Customer");
  const partyName = new Map(data.parties.map((p) => [p.id, p.name]));
  const editProject = isOwner ? (
    <ProjectForm
      entities={data.allEntities}
      parties={data.parties}
      enterprises={data.allEnterprises}
      costCodeSets={data.allSets.map((x) => ({
        id: x.id,
        name: x.name,
        isDefault: x.isDefault,
      }))}
      deliveryMethods={deliveryMethodsFrom(data.config)}
      projectWord={projectWord}
      clientWord={clientWord}
      existing={{
        id: project.id,
        version: project.version,
        number: project.number,
        name: project.name,
        status: project.status,
        deliveryMethod: project.deliveryMethod,
        partyId: project.partyId,
        enterpriseId: project.enterpriseId,
        costCodeSetId: project.costCodeSetId,
        address: project.address,
        startsOn: project.startsOn,
        endsOn: project.endsOn,
        notes: project.notes,
      }}
      trigger={
        <Button variant="outline" size="sm">
          <Pencil className="mr-1.5 size-4" /> Edit
        </Button>
      }
    />
  ) : null;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> All {projectWord.toLowerCase()}s
      </Link>

      <PageHeader
        title={project.name}
        description={`${project.number}${project.address ? ` · ${project.address}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {editProject}
            <Badge variant={project.status === "active" ? "default" : "secondary"}>
            {isProjectStatus(project.status)
              ? STATUS_LABELS[project.status]
              : project.status}
            </Badge>
          </div>
        }
      />

      <Panel className="p-5">
        <h2 className="mb-3 font-heading text-sm font-medium tracking-heading">
          Details
        </h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {(
            [
              [clientWord, data.clientName ?? "—"],
              ["Company", data.entityName],
              ["Division", data.enterpriseName ?? "Whole business"],
              [
                "Kind of work",
                project.deliveryMethod
                  ? slugLabel(project.deliveryMethod)
                  : "Not decided yet",
              ],
              ["Cost codes", data.setName ?? "No list"],
              ["Starts", project.startsOn ?? "—"],
              ["Ends", project.endsOn ?? "—"],
              /*
               * SAID OUT LOUD, because nothing else would say it. A project
               * whose `dimension_members` row failed to write is an entity no
               * report can group by, and the only other way to notice is a
               * report quietly missing a column.
               */
              [
                "Charged to",
                member
                  ? `${member.displayName}${member.isActive ? "" : " (archived)"}`
                  : "Not a cost object — this should not happen; tell us",
              ],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-border/50 py-1.5">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        {project.notes && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {project.notes}
          </p>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Contracts
          </h2>
          {isOwner && (
            <ContractForm
              projectId={project.id}
              parties={data.parties}
              contractKinds={contractKindsFrom(data.config)}
              clientWord={clientWord}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
           * THE SENTENCE THAT STOPS A PROPOSAL BEING READ AS MONEY. A concept
           * the client has not signed is not revenue, and a total that quietly
           * included it would be the number an owner takes to a bank.
           */}
          {contracts.length === 0
            ? "No agreements yet. A job can have several — a design agreement, then drawings, then the build."
            : `Worth ${formatMoneySign(signedValue, symbol)} across ${signedCount} signed ${
                signedCount === 1 ? "agreement" : "agreements"
              }${
                changesValue !== 0
                  ? `, including ${formatMoneySign(changesValue, symbol)} in approved changes`
                  : ""
              }${proposedCount > 0 ? `, with ${proposedCount} still proposed` : ""}.`}
        </p>
        {contracts.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>With</TableHead>
                  <TableHead>Billed by</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {/* The kind is the way in to the contract's own page: its schedule and its draws. */}
                      <Link
                        href={`/dashboard/m/jobs/${project.id}/contracts/${c.id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {slugLabel(c.kind)}
                      </Link>
                      {c.name && (
                        <span className="block text-xs text-muted-foreground">
                          {c.name}
                        </span>
                      )}
                      {c.role === "subcontract" && (
                        <span className="block text-xs text-muted-foreground">
                          We are a subcontractor
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {partyName.get(c.counterpartyPartyId ?? "") ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isBillingMethod(c.billingMethod)
                        ? BILLING_METHOD_LABELS[c.billingMethod]
                        : c.billingMethod}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        REVISED — original + approved changes — with the
                        original underneath only when they differ. The number
                        in the column is the one the next pay application is
                        against; signed renderer because a deduction can take
                        it below the original.
                      */}
                      {c.valueCents === null && !approvedByContract.has(c.id)
                        ? "—"
                        : formatMoneySign(revisedOf(c), symbol)}
                      {(approvedByContract.get(c.id) ?? 0) !== 0 && (
                        <span className="block text-xs text-muted-foreground">
                          orig.{" "}
                          {c.valueCents === null ? "—" : formatMoney(c.valueCents, symbol)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        What has been certified for payment so far, from the
                        contract's own page. A dash until the first
                        application is issued: nothing has been billed, which
                        is not the same as zero owed.
                      */}
                      {(() => {
                        const b = data.billing.get(c.id);
                        if (!b || b.issuedCount === 0) return "—";
                        return (
                          <>
                            {formatMoney(b.billedCents, symbol)}
                            {b.retainageHeldCents > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {formatMoney(b.retainageHeldCents, symbol)} held
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={c.status === "signed" ? "default" : "secondary"}
                      >
                        {isContractStatus(c.status)
                          ? CONTRACT_STATUS_LABELS[c.status]
                          : c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {isOwner && (
                        <ContractForm
                          projectId={project.id}
                          parties={data.parties}
                          contractKinds={contractKindsFrom(data.config)}
                          clientWord={clientWord}
                          existing={{
                            id: c.id,
                            version: c.version,
                            kind: c.kind,
                            name: c.name,
                            counterpartyPartyId: c.counterpartyPartyId,
                            role: c.role,
                            billingMethod: c.billingMethod,
                            valueCents: c.valueCents,
                            feePpm: c.feePpm,
                            feeCents: c.feeCents,
                            gmaxCents: c.gmaxCents,
                            status: c.status,
                            signedOn: c.signedOn,
                            notes: c.notes,
                          }}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="size-4" />
                              <span className="sr-only">
                                Edit {slugLabel(c.kind)}
                              </span>
                            </Button>
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Change orders
          </h2>
          {isOwner && contracts.length > 0 && (
            <ChangeOrderForm
              projectId={project.id}
              contracts={contracts.map((c) => ({
                id: c.id,
                label: `${slugLabel(c.kind)}${c.name ? ` · ${c.name}` : ""}`,
                status: c.status,
              }))}
              costCodes={data.codes
                .filter((c) => c.isActive)
                .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE LINE EVERY OWNER AND SURETY READS: original + approved changes
            = revised. Said in words here, and only APPROVED ones are in the
            number — a proposed change is a price somebody has been shown.
          */}
          {contracts.length === 0
            ? "A change order changes an agreement, so add a contract first."
            : changeOrders.length === 0
              ? "None yet. When the scope moves, a change order records what it costs the client and what it costs you, and only an approved one moves the numbers."
              : `${approvedCount} approved, worth ${formatMoneySign(changesValue, symbol)} on the contract value${
                  proposedChangeCount > 0
                    ? `, with ${proposedChangeCount} still proposed`
                    : ""
                }.`}
        </p>
        {changeOrders.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Against</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeOrders.map((row) => (
                  <TableRow key={row.changeOrder.id}>
                    <TableCell className="font-mono text-xs">
                      {row.changeOrder.number}
                    </TableCell>
                    <TableCell className="font-medium">
                      {row.changeOrder.title}
                      {row.changeOrder.approvedOn && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Approved {row.changeOrder.approvedOn}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {slugLabel(row.contract.kind)}
                      {row.contract.name && (
                        <span className="block text-muted-foreground">
                          {row.contract.name}
                        </span>
                      )}
                    </TableCell>
                    {/*
                      SIGNED RENDERERS ON PURPOSE. A deduction is a negative
                      number here, and `formatMoney` would print it as its own
                      opposite.
                    */}
                    <TableCell className="text-right tabular-nums">
                      {formatMoneySign(row.changeOrder.valueCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.lines.length === 0
                        ? "—"
                        : formatMoneySign(row.costCents, symbol)}
                      {row.lines.length > 1 && (
                        <span className="block text-xs text-muted-foreground">
                          {row.lines.length} codes
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.changeOrder.status === "approved" ? "default" : "secondary"
                        }
                      >
                        {isChangeOrderStatus(row.changeOrder.status)
                          ? CHANGE_ORDER_STATUS_LABELS[row.changeOrder.status]
                          : row.changeOrder.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {isOwner && (
                        <ChangeOrderForm
                          projectId={project.id}
                          contracts={contracts.map((c) => ({
                            id: c.id,
                            label: `${slugLabel(c.kind)}${c.name ? ` · ${c.name}` : ""}`,
                            status: c.status,
                          }))}
                          /*
                            Active codes plus any this change already names, so
                            retiring a code cannot strand a line nobody can
                            reopen — the budget editor's rule, one table over.
                          */
                          costCodes={data.codes
                            .filter(
                              (c) =>
                                c.isActive ||
                                row.lines.some((l) => l.costCodeId === c.id),
                            )
                            .map((c) => ({ id: c.id, label: `${c.code} · ${c.name}` }))}
                          existing={{
                            id: row.changeOrder.id,
                            version: row.changeOrder.version,
                            contractId: row.changeOrder.contractId,
                            number: row.changeOrder.number,
                            title: row.changeOrder.title,
                            description: row.changeOrder.description,
                            status: row.changeOrder.status,
                            valueCents: row.changeOrder.valueCents,
                            requestedOn: row.changeOrder.requestedOn,
                            approvedOn: row.changeOrder.approvedOn,
                            notes: row.changeOrder.notes,
                            lines: row.lines.map((l) => ({
                              costCodeId: l.costCodeId,
                              description: l.description,
                              amountCents: l.amountCents,
                            })),
                          }}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="size-4" />
                              <span className="sr-only">
                                Edit {row.changeOrder.number}
                              </span>
                            </Button>
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Job cost
          </h2>
          {isOwner && (
            <BudgetEditor
              projectId={project.id}
              /*
                ACTIVE CODES, PLUS ANY THAT ALREADY CARRY A BUDGET. A retired
                code is one the business has stopped using, so offering it for a
                NEW budget is the same mistake as offering it on a bill — which
                `updateCostCode` already prevents by archiving its cost object.
                But a figure already set against one has to stay visible and
                editable, or retiring a code would strand money nobody can reach.
                Same shape as the cost-code-set picker rule above.
              */
              codes={data.codes
                .filter(
                  (c) =>
                    c.isActive ||
                    data.costRows.some(
                      (r) => r.costCodeId === c.id && r.originalCents !== null,
                    ),
                )
                .map((c) => ({ id: c.id, code: c.code, name: c.name }))}
              /*
                THE ORIGINAL, never the revised. The editor writes
                `original_cents`; handing it the revised figure would save the
                approved changes into the original and count them twice.
              */
              existing={Object.fromEntries(
                data.costRows
                  .filter((r) => r.originalCents !== null)
                  .map((r) => [r.costCodeId, r.originalCents as number]),
              )}
            />
          )}
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE QUESTION THIS PANEL ANSWERS, said in words. "The job is $40k
            over" is a fact; "the framing is $40k over" is a decision, and only
            the per-code view gets you the second one.
          */}
          {data.costRows.length === 0
            ? "No budget set. Until there is one, committed and actual say what has happened but not whether it was the plan."
            : `Budget ${formatMoneySign(budgetTotal, symbol)} against ${formatMoney(
                committedOfBudgeted,
                symbol,
              )} ordered and ${formatMoney(spentOfBudgeted, symbol)} spent${
                budgetChanges !== 0
                  ? `, after ${formatMoneySign(budgetChanges, symbol)} in approved changes`
                  : ""
              }.`}
        </p>

        {data.costRows.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costRows.map((r) => (
                  <TableRow key={r.costCodeId}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell>
                      {r.name}
                      {!r.hasBudget && (
                        /*
                         * THE MOST INTERESTING ROW ON THE PAGE: something was
                         * ordered against a code nobody budgeted. Easy to leave
                         * out of the query and the one a builder most wants to
                         * see.
                         */
                        <Badge variant="secondary" className="ml-2">
                          Not budgeted
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        REVISED, with the original underneath only when a
                        change moved it — the same shape as the contract's
                        value one panel up, because it is the same line:
                        original + approved changes = revised.
                      */}
                      {r.hasBudget ? formatMoneySign(r.budgetCents, symbol) : "—"}
                      {r.changesCents !== 0 && (
                        <span className="block text-xs text-muted-foreground">
                          orig.{" "}
                          {r.originalCents === null
                            ? "—"
                            : formatMoney(r.originalCents, symbol)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(r.committedCents, symbol)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        THIS JOB'S SPEND ON THIS CODE, and nobody else's: the
                        ledger sliced to the job's cost object, then split by
                        code. The column slices 3 to 6 said out loud they could
                        not show.
                      */}
                      {formatMoney(r.actualCents, symbol)}
                    </TableCell>
                    <TableCell
                      className={
                        "text-right tabular-nums " +
                        (r.varianceCents < 0 ? "text-destructive font-medium" : "")
                      }
                    >
                      {r.hasBudget ? formatMoneySign(r.varianceCents, symbol) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Ordered is what has been committed on this job; spent is what the
          books have been billed for it, by code. Left is the budget less the
          greater of the two — what the code will cost at least.
          {data.uncodedActualCents !== 0 && (
            <>
              {" "}
              <span className="font-medium text-foreground">
                {formatMoney(data.uncodedActualCents, symbol)}
              </span>{" "}
              has been spent on this job with no cost code on the line; it is in
              the job&apos;s total below and in no row here. Add the code on the
              bill in Accounting.
            </>
          )}
        </p>
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            Ordered
          </h2>
          {isOwner && (
            <CommitmentForm
              projectId={project.id}
              parties={data.parties}
              costCodes={data.codes.map((c) => ({
                id: c.id,
                label: `${c.code} · ${c.name}`,
              }))}
            />
          )}
        </div>
        {/*
          THE THREE NUMBERS A BUILDER ACTUALLY LOOKS AT, side by side. Committed
          is what has been ordered whether or not the invoice has arrived; actual
          is what the ledger has been billed. A job can look healthy on actual
          alone right up until you notice what it has already promised, which is
          the mistake this panel exists to make impossible.
        */}
        <dl className="mb-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Contract value</dt>
            <dd className="text-base font-medium tabular-nums">
              {formatMoney(signedValue, symbol)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Committed</dt>
            <dd className="text-base font-medium tabular-nums">
              {formatMoney(committedCents, symbol)}
            </dd>
          </div>
          <div className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Actual cost</dt>
            <dd className="text-base font-medium tabular-nums">
              {formatMoney(actualCents, symbol)}
            </dd>
          </div>
        </dl>
        <p className="mb-3 text-xs text-muted-foreground">
          What this job has EARNED against what it has billed is on the{" "}
          <Link href="/dashboard/m/jobs/wip" className="underline">
            work in progress schedule
          </Link>
          , per period end.
        </p>

        {commitments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing ordered yet. Purchase orders and subcontracts recorded here
            are what the job already owes, before any bill arrives.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {commitments.map((row) => (
                  <TableRow key={row.commitment.id}>
                    <TableCell className="font-mono text-xs">
                      {row.commitment.number}
                      <span className="block font-sans text-xs text-muted-foreground">
                        {isCommitmentKind(row.commitment.kind)
                          ? COMMITMENT_KIND_LABELS[row.commitment.kind]
                          : row.commitment.kind}
                      </span>
                    </TableCell>
                    <TableCell>{row.vendorName}</TableCell>
                    <TableCell>
                      {row.commitment.description || "—"}
                      {row.lines.length > 1 && (
                        <span className="block text-xs text-muted-foreground">
                          {row.lines.length} lines
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.totalCents, symbol)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.commitment.status === "issued" ? "default" : "secondary"
                        }
                      >
                        {isCommitmentStatus(row.commitment.status)
                          ? COMMITMENT_STATUS_LABELS[row.commitment.status]
                          : row.commitment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      {isOwner && (
                        <CommitmentForm
                          projectId={project.id}
                          parties={data.parties}
                          costCodes={data.codes.map((c) => ({
                            id: c.id,
                            label: `${c.code} · ${c.name}`,
                          }))}
                          existing={{
                            id: row.commitment.id,
                            version: row.commitment.version,
                            partyId: row.commitment.partyId,
                            kind: row.commitment.kind,
                            number: row.commitment.number,
                            description: row.commitment.description,
                            status: row.commitment.status,
                            issuedOn: row.commitment.issuedOn,
                            notes: row.commitment.notes,
                            lines: row.lines.map((l) => ({
                              costCodeId: l.costCodeId,
                              description: l.description,
                              amountCents: l.amountCents,
                            })),
                          }}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="size-4" />
                              <span className="sr-only">
                                Edit {row.commitment.number}
                              </span>
                            </Button>
                          }
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel className="p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">
            On site
          </h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/m/jobs/${project.id}/log`}>All days</Link>
            </Button>
            {canLog && <DailyLogForm projectId={project.id} parties={data.parties} />}
          </div>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            THE DAILY REPORT, said in its own terms: one per day, who was
            there, what happened. The tell box writes the same rows —
            "poured the garage slab at Oak Row, four guys, six hours".
          */}
          {data.days.length === 0
            ? "No days logged yet. One report per day: the weather, what happened, who was on site, the photos."
            : `${data.days.length} ${data.days.length === 1 ? "day" : "days"} logged, latest ${data.days[0].log.logDate}.`}
        </p>
        {data.days.length > 0 && (
          <ul className="divide-y divide-border/50">
            {data.days.map((day) => (
              <li key={day.log.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{day.log.logDate}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      day.crews.length > 0
                        ? `${day.crews.reduce((n, c) => n + c.workers, 0)} on site`
                        : null,
                      day.photoCount > 0
                        ? `${day.photoCount} ${day.photoCount === 1 ? "photo" : "photos"}`
                        : null,
                      day.log.weather || null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {day.log.notes && (
                  <p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                    {day.log.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-5">
        <h2 className="mb-1 font-heading text-sm font-medium tracking-heading">
          Punch list
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {/*
            WORK ITEMS, linked to this job — never a second task engine. What
            is open here is open in Work too, with whoever it is on.
          */}
          {data.punch.filter((p) => p.completedAt === null).length === 0
            ? "Nothing open."
            : `${data.punch.filter((p) => p.completedAt === null).length} open.`}
        </p>
        <PunchList
          projectId={project.id}
          canEdit={canLog}
          items={data.punch.map((p) => ({
            id: p.id,
            title: p.title,
            notes: p.notes,
            dueOn: p.dueOn,
            done: p.completedAt !== null,
          }))}
        />
      </Panel>

      <Panel className="p-5">
        <h2 className="font-heading text-sm font-medium tracking-heading">
          Cost codes
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {data.setName
            ? `This ${projectWord.toLowerCase()} is budgeted against ${data.setName}.`
            : "No cost code list is attached, so there is nothing to charge against yet."}
        </p>
        {codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No codes in this list yet.{" "}
            <Link href="/dashboard/m/jobs/cost-codes" className="underline">
              Add some
            </Link>
            .
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
