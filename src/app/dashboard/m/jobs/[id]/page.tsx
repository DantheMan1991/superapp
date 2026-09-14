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
  getProject,
  listCommitments,
  listContracts,
  listCostCodes,
} from "@/packs/jobs/ops";
import { allowsWrite } from "@/lib/packs/authorize";
import { formatMoney } from "@/lib/money";
import { ContractForm } from "@/packs/jobs/components/contract-form";
import { CommitmentForm } from "@/packs/jobs/components/commitment-form";
import { ProjectForm } from "@/packs/jobs/components/project-form";
import { Button } from "@/components/ui/button";
import { listCostCodeSets } from "@/packs/jobs/ops";
import {
  BILLING_METHOD_LABELS,
  COMMITMENT_KIND_LABELS,
  COMMITMENT_STATUS_LABELS,
  CONTRACT_STATUS_LABELS,
  PACK,
  PROJECT_DIMENSION,
  VALUED_CONTRACT_STATUSES,
  STATUS_LABELS,
  isBillingMethod,
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
        committed,
        actual,
        allEntities,
        allEnterprises,
        allSets,
        parties,
        member,
        pack,
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
        committedTotals(tx, ctx.tenant.id),
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
        committed,
        actual,
        allEntities,
        allEnterprises,
        allSets,
        parties,
        member: member[0] ?? null,
        labels: pack.labels,
        config: pack.config,
      };
    },
    { role: ctx.role },
  );

  if (!data) notFound();
  const { project, codes, contracts, commitments, member } = data;
  const committedCents = data.committed.byProject.get(project.id) ?? 0;
  const actualCents = data.actual.get(project.id) ?? 0;
  const isOwner = allowsWrite(ctx.role, "owner");
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
  const signedValue = valued.reduce((sum, c) => sum + (c.valueCents ?? 0), 0);
  const signedCount = valued.length;
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

      <Panel>
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

      <Panel>
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
            : `Worth ${formatMoney(signedValue, symbol)} across ${signedCount} signed ${
                signedCount === 1 ? "agreement" : "agreements"
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
                      {slugLabel(c.kind)}
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
                      {c.valueCents === null
                        ? "—"
                        : formatMoney(c.valueCents, symbol)}
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

      <Panel>
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

      <Panel>
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
